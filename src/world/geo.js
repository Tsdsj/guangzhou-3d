// 真实珠江水系：两级有符号距离场（内圈 6 m、外圈 24 m），供 CPU 查询与着色器共用。
// R 通道 = 到任意水体（珠江、涌、湖）的距离，G 通道 = 到珠江主航道的距离；陆地为正、水为负（米）。
// 地形：30 m 节点高度场（越秀山与北部远山，城区其余地面为 0），取值规则与 tools/terrain.mjs 一致。

import * as THREE from 'three';

export const WATER_Y = -2.4; // 水面高度（陆地为 0，江堤高出水面约 2.4 m）
export const PROM = 16; // 滨江步道宽度（米）

function makeTex(data, nx, nz) {
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RGFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export class Geography {
  constructor(D) {
    const m = D.meta;
    this.gIn = m.sdfIn;
    this.gOut = m.sdfOut;
    this.dIn = D.S.sdfIn;
    this.dOut = D.S.sdfOut;
    this.city = m.city;
    this.texIn = makeTex(this.dIn, this.gIn.nx, this.gIn.nz);
    this.texOut = makeTex(this.dOut, this.gOut.nx, this.gOut.nz);
    this.PROM = PROM;
    this.T = m.terrain && D.S.terrain ? { ...m.terrain, data: D.S.terrain } : null;
  }
  // 地面高度（米）：每格沿 (i, j)–(i+1, j+1) 对角线分成两个三角形线性插值，与地形网格重合
  height(x, z) {
    const G = this.T;
    if (!G) return 0;
    let fx = (x - G.x0) / G.cs;
    let fz = (z - G.z0) / G.cs;
    if (fx < 0 || fz < 0 || fx >= G.nx - 1 || fz >= G.nz - 1) return 0;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    fx -= i;
    fz -= j;
    const k = j * G.nx + i;
    const d = G.data;
    const h00 = d[k];
    const h11 = d[k + G.nx + 1];
    return (fx > fz ? h00 + fx * (d[k + 1] - h00) + fz * (h11 - d[k + 1]) : h00 + fz * (d[k + G.nx] - h00) + fx * (h11 - d[k + G.nx])) / 10;
  }
  // 着色器 uniforms：uv = (p - box.xy) * box.zw
  boxOf(g) {
    return new THREE.Vector4(g.x0, g.z0, 1 / (g.nx * g.cs), 1 / (g.nz * g.cs));
  }
  _sample(d, g, x, z, ch) {
    let fx = (x - g.x0) / g.cs - 0.5;
    let fz = (z - g.z0) / g.cs - 0.5;
    fx = Math.max(0, Math.min(g.nx - 1.001, fx));
    fz = Math.max(0, Math.min(g.nz - 1.001, fz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = (j * g.nx + i) * 2 + ch;
    const r = g.nx * 2;
    const v = (d[k] * (1 - tx) + d[k + 2] * tx) * (1 - tz) + (d[k + r] * (1 - tx) + d[k + r + 2] * tx) * tz;
    return (v - 128) / 1.5;
  }
  inInner(x, z) {
    const g = this.gIn;
    return x > g.x0 + 12 && z > g.z0 + 12 && x < g.x0 + g.nx * g.cs - 12 && z < g.z0 + g.nz * g.cs - 12;
  }
  sdAll(x, z) {
    return this.inInner(x, z) ? this._sample(this.dIn, this.gIn, x, z, 0) : this._sample(this.dOut, this.gOut, x, z, 0);
  }
  sdMain(x, z) {
    return this.inInner(x, z) ? this._sample(this.dIn, this.gIn, x, z, 1) : this._sample(this.dOut, this.gOut, x, z, 1);
  }
  gradMain(x, z) {
    const e = 6;
    const gx = this.sdMain(x + e, z) - this.sdMain(x - e, z);
    const gz = this.sdMain(x, z + e) - this.sdMain(x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    return [gx / l, gz / l];
  }
  inCity(x, z, m = 0) {
    const c = this.city;
    return x > c.x0 - m && x < c.x1 + m && z > c.z0 - m && z < c.z1 + m;
  }
}
