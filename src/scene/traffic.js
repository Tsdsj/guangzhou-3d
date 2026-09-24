// 车流（CPU 逐帧沿整条车道折线推进，转角处平滑转向；夜间白色车头灯 / 红色尾灯形成光轨）
// 与珠江游船（珠江夜游的灯光游船 + 白天的货运驳船）。

import * as THREE from 'three';
import { patchMaterial } from './atmosphere.js';
import { makeVehicleGeometries, makePersonGeometries, GB } from './geometries.js';
import { WATER_Y } from '../world/geo.js';
import { RNG } from '../core/rng.js';

// far = true：远景盒体车（单位立方体按车型拉伸，前脸 / 车尾整面作车灯），每辆 12 个三角形
function carMaterial(far = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.5 });
  return patchMaterial(m, {
    key: far ? 'vehicle-far' : 'vehicle',
    vPars: `attribute vec3 aPos; attribute vec4 aDir; attribute float aCol; varying float vPart; varying float vCarC;
      ${far ? 'attribute float aKind;' : 'attribute float aPart;'}`,
    vReplace: [
      [
        'beginnormal_vertex',
        `vec3 cF = normalize(vec3(aDir.x, 0.0, aDir.z) + vec3(1e-5, 0.0, 0.0));
         vec3 cR = vec3(-cF.z, 0.0, cF.x);
         vec3 objectNormal = cF * normal.x + vec3(0.0, 1.0, 0.0) * normal.y + cR * normal.z;`,
        'replace',
      ],
      [
        'begin_vertex',
        far
          ? `int gzKind = int(aKind + 0.5);
         vec3 gzDim = gzKind == 2 ? vec3(11.8, 3.2, 2.5) : gzKind == 3 ? vec3(6.1, 3.0, 2.2) : gzKind == 1 ? vec3(4.7, 1.75, 1.9) : vec3(4.5, 1.4, 1.8);
         vec3 lp = position * gzDim * aDir.w;
         vec3 transformed = aPos + cF * lp.x + vec3(0.0, 1.0, 0.0) * (lp.y + lp.x * aDir.y) + cR * lp.z;
         vPart = normal.x > 0.5 ? 3.0 : normal.x < -0.5 ? 4.0 : 0.0; vCarC = aCol;`
          : `vec3 lp = position * aDir.w;
         vec3 transformed = aPos + cF * lp.x + vec3(0.0, 1.0, 0.0) * (lp.y + lp.x * aDir.y) + cR * lp.z;
         vPart = aPart; vCarC = aCol;`,
        'replace',
      ],
    ],
    fPars: 'varying float vPart; varying float vCarC; uniform float uNight; uniform float uLights; uniform float uStreetOn; uniform float uWet;',
    replace: [
      [
        'color_fragment',
        `int gzPart = int(vPart + 0.5);
        float gzRough = 0.32 - uWet * 0.15; float gzMetal = 0.55;
        {
          int ci = int(vCarC + 0.5);
          vec3 pal[10];
          pal[0] = vec3(0.82); pal[1] = vec3(0.5, 0.51, 0.53); pal[2] = vec3(0.03); pal[3] = vec3(0.16, 0.17, 0.18); pal[4] = vec3(0.55, 0.05, 0.04);
          pal[5] = vec3(0.07, 0.18, 0.42); pal[6] = vec3(0.6, 0.53, 0.4); pal[7] = vec3(0.1, 0.42, 0.7); pal[8] = vec3(0.88, 0.88, 0.86); pal[9] = vec3(0.33, 0.34, 0.36);
          vec3 c = pal[ci];
          if (gzPart == 1) { c = vec3(0.02, 0.025, 0.03); gzRough = 0.06; gzMetal = 0.9; }
          else if (gzPart == 2) { c = vec3(0.025); gzRough = 0.85; gzMetal = 0.0; }
          else if (gzPart == 3) { c = vec3(0.9, 0.9, 0.85); gzRough = 0.1; gzMetal = 0.2; }
          else if (gzPart == 4) { c = vec3(0.5, 0.03, 0.02); gzRough = 0.15; gzMetal = 0.1; }
          else if (gzPart == 5) { c = vec3(0.86, 0.87, 0.85); }
          else if (gzPart == 6) { c = ci < 5 ? vec3(0.85, 0.85, 0.83) : vec3(0.12, 0.3, 0.55); gzRough = 0.6; gzMetal = 0.1; }
          diffuseColor.rgb = c;
        }`,
        'after',
      ],
      ['roughnessmap_fragment', 'roughnessFactor = clamp(gzRough, 0.04, 1.0);', 'after'],
      ['metalnessmap_fragment', 'metalnessFactor = gzMetal;', 'after'],
      [
        'emissivemap_fragment',
        `{
          float on = max(uStreetOn, 0.0) * uLights;
          if (gzPart == 3) totalEmissiveRadiance += vec3(1.0, 0.93, 0.8) * 4.5 * on;
          if (gzPart == 4) totalEmissiveRadiance += vec3(1.0, 0.06, 0.02) * (0.3 + 2.4 * on);
          if (gzPart == 1) totalEmissiveRadiance += vec3(1.0, 0.85, 0.6) * 0.05 * on;
        }`,
        'after',
      ],
    ],
  });
}

// 行人：上衣按调色板着色，裤子深色，皮肤与头发固定色
function personMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
  return patchMaterial(m, {
    key: 'person',
    vPars: 'attribute vec3 aPos; attribute vec4 aDir; attribute float aCol; attribute float aPart; varying float vPart; varying float vCarC;',
    vReplace: [
      [
        'beginnormal_vertex',
        `vec3 cF = normalize(vec3(aDir.x, 0.0, aDir.z) + vec3(1e-5, 0.0, 0.0));
         vec3 cR = vec3(-cF.z, 0.0, cF.x);
         vec3 objectNormal = cF * normal.x + vec3(0.0, 1.0, 0.0) * normal.y + cR * normal.z;`,
        'replace',
      ],
      [
        'begin_vertex',
        `vec3 lp = position * aDir.w;
         vec3 transformed = aPos + cF * lp.x + vec3(0.0, 1.0, 0.0) * lp.y + cR * lp.z;
         vPart = aPart; vCarC = aCol;`,
        'replace',
      ],
    ],
    fPars: 'varying float vPart; varying float vCarC;',
    replace: [
      [
        'color_fragment',
        `{
          int ci = int(vCarC + 0.5);
          vec3 pal[10];
          pal[0] = vec3(0.85); pal[1] = vec3(0.05); pal[2] = vec3(0.6, 0.08, 0.06); pal[3] = vec3(0.1, 0.22, 0.5); pal[4] = vec3(0.75, 0.62, 0.35);
          pal[5] = vec3(0.3, 0.45, 0.3); pal[6] = vec3(0.8, 0.45, 0.55); pal[7] = vec3(0.45); pal[8] = vec3(0.9, 0.8, 0.2); pal[9] = vec3(0.35, 0.55, 0.75);
          int part = int(vPart + 0.5);
          vec3 c = pal[ci];
          if (part == 1) c = ci < 5 ? vec3(0.06, 0.07, 0.09) : vec3(0.18, 0.22, 0.32);
          else if (part == 2) c = vec3(0.72, 0.52, 0.4);
          else if (part == 3) c = vec3(0.03);
          diffuseColor.rgb = c;
        }`,
        'after',
      ],
    ],
  });
}

// 每帧由 CPU 沿车道折线推进全部车辆，只把相机附近的写入实例属性：近处按车型画精细模型，
// 远处（车辆）统一画盒体车，再远不画。行人复用同一机制，只有近景一级。
const NEAR_CAR = 420;
const FAR_CAR = 7000;
const NEAR_PERSON = 320;

function lodMesh(base, attrs, cap, mat, group) {
  const g = new THREE.InstancedBufferGeometry();
  for (const a of attrs) g.setAttribute(a, base.getAttribute(a));
  const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
  const L = { pos: mk(3), dir: mk(4), col: mk(1), kind: mk(1), n: 0 };
  g.setAttribute('aPos', L.pos);
  g.setAttribute('aDir', L.dir);
  g.setAttribute('aCol', L.col);
  g.setAttribute('aKind', L.kind);
  g.instanceCount = 0;
  L.mesh = new THREE.Mesh(g, mat);
  L.mesh.frustumCulled = false;
  L.mesh.layers.set(1);
  group.add(L.mesh);
  return L;
}

export class Traffic {
  constructor(T, opts = {}) {
    this.T = T;
    this.group = new THREE.Group();
    const n = T.count;
    const people = !!opts.people;
    const geos = people ? makePersonGeometries() : makeVehicleGeometries();
    const mat = people ? personMaterial() : carMaterial();
    this.B = people ? 0.8 : 3.5;
    this.nearR = people ? NEAR_PERSON : NEAR_CAR;
    this.farR = people ? 0 : FAR_CAR;
    this.kind = new Uint8Array(n);
    this.col = new Uint8Array(n);
    this.lane = new Int32Array(n);
    this.s = new Float32Array(n);
    this.v = new Float32Array(n);
    this.seg = new Int32Array(n);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      this.lane[i] = T.cars[o];
      this.s[i] = T.cars[o + 1];
      this.v[i] = T.cars[o + 2];
      this.col[i] = T.cars[o + 3];
      this.kind[i] = T.cars[o + 4];
      counts[this.kind[i]]++;
    }
    this.near = geos.map((base, k) => (counts[k] ? lodMesh(base, ['position', 'normal', 'aPart'], counts[k], mat, this.group) : null));
    if (this.farR) {
      const b = new GB();
      b.box(0, 0.5, 0, 1, 1, 1);
      this.far = lodMesh(b.build(), ['position', 'normal'], n, carMaterial(true), this.group);
    }
    this.cam = new THREE.Vector3(0, 1e9, 0);
    this.update(0);
  }

  update(dt, cam) {
    if (cam) this.cam.copy(cam.position);
    const T = this.T;
    const P = T.pts;
    const C = T.cum;
    const B = this.B; // 转角处的转向过渡长度（米）
    const { x: cx, y: cy, z: cz } = this.cam;
    const nr2 = this.nearR * this.nearR;
    const fr2 = this.farR * this.farR;
    for (const L of this.near) if (L) L.n = 0;
    if (this.far) this.far.n = 0;
    for (let i = 0; i < T.count; i++) {
      const l = this.lane[i];
      const off = T.laneOff[l];
      const nP = T.laneN[l];
      const len = T.laneLen[l];
      let s = this.s[i] + this.v[i] * dt;
      let seg = this.seg[i];
      if (s >= len) {
        s -= len;
        seg = 0;
      }
      while (seg < nP - 2 && C[off + seg + 1] < s) seg++;
      while (seg > 0 && C[off + seg] > s) seg--;
      this.s[i] = s;
      this.seg[i] = seg;
      const a = off + seg;
      const L = Math.max(1e-3, C[a + 1] - C[a]);
      const f = (s - C[a]) / L;
      const ax = P[a * 3];
      const ay = P[a * 3 + 1];
      const az = P[a * 3 + 2];
      let dx = P[a * 3 + 3] - ax;
      let dy = P[a * 3 + 4] - ay;
      let dz = P[a * 3 + 5] - az;
      const x = ax + dx * f;
      const y = ay + dy * f;
      const z = az + dz * f;
      // 靠近折线顶点时与相邻线段的方向混合，避免转角处车头突变
      const d0 = s - C[a];
      const d1 = C[a + 1] - s;
      if (d0 < B && seg > 0) {
        const w = 0.5 - 0.5 * (d0 / B);
        const L0 = Math.max(1e-3, C[a] - C[a - 1]);
        dx = dx / L * (1 - w) + (ax - P[a * 3 - 3]) / L0 * w;
        dy = dy / L * (1 - w) + (ay - P[a * 3 - 2]) / L0 * w;
        dz = dz / L * (1 - w) + (az - P[a * 3 - 1]) / L0 * w;
      } else if (d1 < B && seg < nP - 2) {
        const w = 0.5 - 0.5 * (d1 / B);
        const L1 = Math.max(1e-3, C[a + 2] - C[a + 1]);
        dx = dx / L * (1 - w) + (P[a * 3 + 6] - P[a * 3 + 3]) / L1 * w;
        dy = dy / L * (1 - w) + (P[a * 3 + 7] - P[a * 3 + 4]) / L1 * w;
        dz = dz / L * (1 - w) + (P[a * 3 + 8] - P[a * 3 + 5]) / L1 * w;
      }
      const d2 = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      const Q = d2 < nr2 ? this.near[this.kind[i]] : d2 < fr2 ? this.far : null;
      if (!Q) continue;
      const h = Math.hypot(dx, dz) || 1;
      // 车道两端（断头路 / 城市边缘）淡入淡出
      const fade = Math.min(1, s / 4, (len - s) / 4);
      const k = Q.n++;
      Q.pos.array[k * 3] = x;
      Q.pos.array[k * 3 + 1] = y;
      Q.pos.array[k * 3 + 2] = z;
      Q.dir.array[k * 4] = dx / h;
      Q.dir.array[k * 4 + 1] = dy / h;
      Q.dir.array[k * 4 + 2] = dz / h;
      Q.dir.array[k * 4 + 3] = Math.max(0, fade);
      Q.col.array[k] = this.col[i];
      Q.kind.array[k] = this.kind[i];
    }
    for (const L of [...this.near, this.far]) {
      if (!L) continue;
      L.mesh.geometry.instanceCount = L.n;
      L.mesh.visible = L.n > 0;
      if (!L.n) continue;
      for (const [a, w] of [[L.pos, 3], [L.dir, 4], [L.col, 1], [L.kind, 1]]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, L.n * w);
        a.needsUpdate = true;
      }
    }
  }
}

// ---------- 珠江游船 ----------
function boatMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 });
  return patchMaterial(m, {
    key: 'boat',
    vPars: 'attribute float aLit; varying float vLit; varying vec3 vBL;',
    vMain: 'vLit = aLit; vBL = position;',
    fPars: 'varying float vLit; varying vec3 vBL; uniform float uNight; uniform float uLights; uniform float uTime;',
    replace: [
      [
        'emissivemap_fragment',
        `{
          float win = step(0.35, fract(vBL.x / 2.2)) * step(fract(vBL.y / 2.6), 0.62) * step(2.2, vBL.y);
          vec3 led = gzHsv(fract(vBL.x * 0.01 - uTime * 0.1), 0.7, 1.0);
          float rim = step(0.9, fract(vBL.y / 2.6 + 0.05));
          totalEmissiveRadiance += (vec3(1.0, 0.78, 0.45) * win * 2.6 + led * rim * 4.0) * vLit * uNight * uLights;
        }`,
        'after',
      ],
    ],
  });
}

function boatGeometry(lit) {
  const b = new GB();
  const hull = lit ? [0.92, 0.92, 0.9] : [0.25, 0.22, 0.2];
  const ex = { aLit: lit ? 1 : 0 };
  // 船体（尖艏）
  const L = lit ? 46 : 58;
  const W = lit ? 11 : 10;
  // 顶视需为负面积方向，侧面法线才朝外
  const pts = [[-L / 2, W / 2], [L / 2 - 8, W / 2], [L / 2, 0], [L / 2 - 8, -W / 2], [-L / 2, -W / 2]];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    b.quad([a[0], 0, a[1]], [c[0], 0, c[1]], [c[0], 2.2, c[1]], [a[0], 2.2, a[1]], hull, ex);
  }
  b.quad([-L / 2, 2.2, W / 2], [L / 2 - 8, 2.2, W / 2], [L / 2 - 8, 2.2, -W / 2], [-L / 2, 2.2, -W / 2], lit ? [0.6, 0.35, 0.2] : [0.3, 0.26, 0.22], ex);
  b.tri([L / 2 - 8, 2.2, W / 2], [L / 2, 2.2, 0], [L / 2 - 8, 2.2, -W / 2], lit ? [0.6, 0.35, 0.2] : [0.3, 0.26, 0.22], ex);
  if (lit) {
    b.box(-3, 2.2 + 1.3, 0, L - 16, 2.6, W - 1.2, 0, [0.95, 0.95, 0.93], ex);
    b.box(-5, 4.8 + 1.2, 0, L - 24, 2.4, W - 2.4, 0, [0.95, 0.9, 0.82], ex);
    b.box(-6, 7.2 + 0.4, 0, L - 28, 0.8, W - 2, 0, [0.7, 0.2, 0.15], ex);
  } else {
    b.box(-L / 2 + 6, 2.2 + 2.2, 0, 8, 4.4, W - 2, 0, [0.85, 0.85, 0.82], ex);
    b.box(6, 2.2 + 0.9, 0, L - 26, 1.8, W - 1.5, 0, [0.35, 0.3, 0.26], ex);
  }
  return b.build();
}

export class Boats {
  // route：珠江前航道中线 [x, z, 半宽] 序列（白鹅潭 → 琶洲）
  constructor(route) {
    this.group = new THREE.Group();
    const rng = new RNG(8801);
    const n = route.length / 3;
    this.P = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const x = route[i * 3];
      const z = route[i * 3 + 1];
      if (i > 0) s += Math.hypot(x - this.P[i - 1].x, z - this.P[i - 1].z);
      this.P.push({ x, z, hw: route[i * 3 + 2], s });
    }
    this.len = s;
    this.items = [];
    const mat = boatMaterial();
    const nLit = 14;
    const nCargo = 8;
    this.lit = new THREE.InstancedMesh(boatGeometry(true), mat, nLit);
    this.cargo = new THREE.InstancedMesh(boatGeometry(false), mat, nCargo);
    for (const m of [this.lit, this.cargo]) {
      m.frustumCulled = false;
      m.castShadow = false;
      this.group.add(m);
    }
    for (let i = 0; i < nLit + nCargo; i++) {
      const dir = rng.chance(0.5) ? 1 : -1;
      this.items.push({ mesh: i < nLit ? this.lit : this.cargo, idx: i < nLit ? i : i - nLit, s: rng.next() * s, dir, speed: rng.float(3.5, 7), lane: dir * rng.float(0.18, 0.45) });
    }
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.p = new THREE.Vector3();
    this.sc = new THREE.Vector3(1, 1, 1);
    this.seg = 0;
    this.update(0);
  }
  at(s) {
    const P = this.P;
    let lo = 0;
    let hi = P.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (P[m].s <= s) lo = m;
      else hi = m;
    }
    const a = P[lo];
    const b = P[hi];
    const t = (s - a.s) / Math.max(1e-3, b.s - a.s);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: a.x + dx * t, z: a.z + dz * t, hw: a.hw + (b.hw - a.hw) * t, tx: dx / l, tz: dz / l };
  }
  update(dt) {
    if (this.P.length < 2) return;
    for (const it of this.items) {
      it.s += it.dir * it.speed * dt;
      if (it.s > this.len) it.s -= this.len;
      if (it.s < 0) it.s += this.len;
      const p = this.at(it.s);
      // 船头朝向行驶方向；靠右航行（右侧法线 = (-tz, tx)）
      const o = it.lane * p.hw;
      this.e.set(0, Math.atan2(-p.tz * it.dir, p.tx * it.dir), 0);
      this.q.setFromEuler(this.e);
      this.p.set(p.x - p.tz * o, WATER_Y - 0.6, p.z + p.tx * o);
      this.m.compose(this.p, this.q, this.sc);
      it.mesh.setMatrixAt(it.idx, this.m);
    }
    this.lit.instanceMatrix.needsUpdate = true;
    this.cargo.instanceMatrix.needsUpdate = true;
  }
}

// ---------- 列车：干线动车组（白车身蓝腰线）、地铁（白车身红腰线）、有轨电车（绿白），沿线路往返行驶 ----------
function trainMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.3 });
  return patchMaterial(m, {
    key: 'train',
    vPars: 'attribute vec3 aPos; attribute vec4 aDir; attribute float aKind; attribute float aPart; varying float vPart; varying float vKindT; varying vec3 vTL;',
    vReplace: [
      [
        'beginnormal_vertex',
        `vec3 cF = normalize(vec3(aDir.x, 0.0, aDir.z) + vec3(1e-5, 0.0, 0.0));
         vec3 cR = vec3(-cF.z, 0.0, cF.x);
         vec3 objectNormal = cF * normal.x + vec3(0.0, 1.0, 0.0) * normal.y + cR * normal.z;`,
        'replace',
      ],
      [
        'begin_vertex',
        `vec3 lp = position * vec3(aDir.w, 1.0, 1.0);
         vec3 transformed = aPos + cF * lp.x + vec3(0.0, 1.0, 0.0) * (lp.y + lp.x * aDir.y) + cR * lp.z;
         vPart = aPart; vKindT = aKind; vTL = lp;`,
        'replace',
      ],
    ],
    fPars: 'varying float vPart; varying float vKindT; varying vec3 vTL; uniform float uNight; uniform float uLights; uniform float uStreetOn;',
    replace: [
      [
        'color_fragment',
        `int gzP = int(vPart + 0.5);
        int gzK = int(vKindT + 0.5);
        vec3 stripe = gzK == 0 ? vec3(0.08, 0.25, 0.6) : gzK == 2 ? vec3(0.62, 0.08, 0.08) : vec3(0.1, 0.45, 0.25);
        vec3 c = vec3(0.9, 0.9, 0.88);
        float gzRough = 0.35; float gzMetal = 0.35; vec3 gzE = vec3(0.0);
        if (gzP == 1) {
          // 车窗带：分格的深色玻璃，夜间透出车厢灯光
          float w = step(0.12, fract(vTL.x / 1.6));
          c = mix(vec3(0.3), vec3(0.03, 0.04, 0.05), w); gzRough = 0.08; gzMetal = 0.6;
          gzE = vec3(1.0, 0.95, 0.85) * w * 1.2 * uStreetOn * uLights;
        } else if (gzP == 2) { c = stripe; }
        else if (gzP == 3) { c = vec3(0.45, 0.46, 0.47); gzRough = 0.6; }
        else if (gzP == 4) { c = vec3(0.9); gzE = vec3(1.0, 0.95, 0.85) * 3.0 * uStreetOn * uLights; }
        diffuseColor.rgb = c;`,
        'after',
      ],
      ['roughnessmap_fragment', 'roughnessFactor = gzRough;', 'after'],
      ['metalnessmap_fragment', 'metalnessFactor = gzMetal;', 'after'],
      ['emissivemap_fragment', 'totalEmissiveRadiance += gzE;', 'after'],
    ],
  });
}

// 单节车厢（沿 +x，长度按实例缩放 aDir.w；0 车身 / 1 车窗带 / 2 腰线 / 3 车顶设备 / 4 车灯）
function trainCarGeometry() {
  const b = new GB();
  const P = (k) => ({ aPart: k });
  b.box(0, 1.9, 0, 1, 2.5, 3.1, 0, null, P(0));
  b.box(0, 2.25, 0, 0.96, 0.8, 3.14, 0, null, P(1));
  b.box(0, 1.45, 0, 0.98, 0.18, 3.13, 0, null, P(2));
  b.box(0, 3.25, 0, 0.7, 0.25, 2.2, 0, null, P(3));
  b.box(0.5, 1.2, 0, 0.02, 0.3, 2.4, 0, null, P(4));
  const g = b.build();
  g.deleteAttribute('uv');
  return g;
}

const TRAIN_SPEC = [
  { cars: 8, len: 25, gap: 0.8, speed: 26, per: 5000 },
  null,
  { cars: 6, len: 22, gap: 0.8, speed: 16, per: 2500 },
  { cars: 4, len: 9, gap: 0.5, speed: 9, per: 2500 },
];

export class Trains {
  constructor(routes) {
    this.group = new THREE.Group();
    const rng = new RNG(8803);
    this.routes = routes.map((r) => {
      const P = r.pts;
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]));
      return { P, cum, len: cum[cum.length - 1], kind: r.kind };
    });
    this.trains = [];
    let nCars = 0;
    for (const R of this.routes) {
      const S = TRAIN_SPEC[R.kind];
      if (!S) continue;
      const trainLen = S.cars * (S.len + S.gap);
      if (R.len < trainLen * 2) continue;
      const n = Math.max(1, Math.round(R.len / S.per));
      for (let k = 0; k < n; k++) {
        // lo：列车占据线路 [lo, lo + 车长] 一段，dir 为行进方向
        this.trains.push({ R, S, trainLen, lo: rng.next() * (R.len - trainLen), dir: rng.chance(0.5) ? 1 : -1, wait: 0 });
        nCars += S.cars;
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    const base = trainCarGeometry();
    for (const a of ['position', 'normal', 'aPart']) g.setAttribute(a, base.getAttribute(a));
    const mk = (k) => new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, nCars) * k), k).setUsage(THREE.DynamicDrawUsage);
    this.pos = mk(3);
    this.dir = mk(4);
    this.kind = mk(1);
    g.setAttribute('aPos', this.pos);
    g.setAttribute('aDir', this.dir);
    g.setAttribute('aKind', this.kind);
    g.instanceCount = nCars;
    this.mesh = new THREE.Mesh(g, trainMaterial());
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.layers.set(1);
    this.group.add(this.mesh);
    this._a = [0, 0, 0];
    this._b = [0, 0, 0];
    this.update(0);
  }
  at(R, s, out) {
    s = Math.max(0, Math.min(R.len, s));
    let lo = 0;
    let hi = R.cum.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (R.cum[m] <= s) lo = m;
      else hi = m;
    }
    const a = R.P[lo];
    const b = R.P[hi];
    const t = (s - R.cum[lo]) / Math.max(1e-3, R.cum[hi] - R.cum[lo]);
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
  }
  update(dt) {
    let c = 0;
    const A = this._a;
    const B = this._b;
    for (const T of this.trains) {
      const { R, S } = T;
      if (T.wait > 0) T.wait -= dt;
      else {
        T.lo += T.dir * S.speed * dt;
        // 到达线路端点：停站片刻后折返
        if (T.lo + T.trainLen > R.len || T.lo < 0) {
          T.lo = Math.max(0, Math.min(R.len - T.trainLen, T.lo));
          T.dir = -T.dir;
          T.wait = 20;
        }
      }
      // 车头在行进方向的一端，车厢依次向后排列；每节车厢的朝向取前后转向架连线
      const head = T.dir > 0 ? T.lo + T.trainLen : T.lo;
      for (let k = 0; k < S.cars; k++) {
        const f = head - T.dir * k * (S.len + S.gap);
        const r = f - T.dir * S.len;
        this.at(R, f, A);
        this.at(R, r, B);
        let dx = A[0] - B[0];
        let dy = A[1] - B[1];
        let dz = A[2] - B[2];
        const h = Math.hypot(dx, dz) || 1;
        this.pos.array.set([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 0.25, (A[2] + B[2]) / 2], c * 3);
        this.dir.array.set([dx / h, dy / h, dz / h, S.len], c * 4);
        this.kind.array[c] = R.kind;
        c++;
      }
    }
    this.pos.needsUpdate = true;
    this.dir.needsUpdate = true;
    this.kind.needsUpdate = true;
  }
}
