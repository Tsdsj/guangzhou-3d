// 真实建筑轮廓 → 合并网格（按 600 m 分块，便于视锥剔除）。
// 每栋建筑：外墙（沿周长连续的立面坐标）、屋面（含内院洞口）、平屋顶女儿墙、悬空构件底面；
// 骑楼临街面：首层墙体退后形成廊道，廊下天花朝下（夜间暖光），上部楼层悬挑至临街线。
// 建筑参数（风格、层高、开间、亮灯率、颜色、高度）写入数据纹理，顶点只存编号，显著节省显存。

import * as THREE from 'three';
import { linInt, ST, ROOF } from './parts.js';
import { BLD } from './schema.js';

const TILE = 1000;
const TEXW = 2048;

class MB {
  constructor() {
    this.cap = 4096;
    this.n = 0;
    this.pos = new Float32Array(this.cap * 3);
    this.nor = new Int8Array(this.cap * 3);
    this.wall = new Float32Array(this.cap * 3);
    this.bid = new Float32Array(this.cap);
    this.idx = [];
  }
  grow() {
    this.cap *= 2;
    const g = (a, k, T) => {
      const b = new T(this.cap * k);
      b.set(a);
      return b;
    };
    this.pos = g(this.pos, 3, Float32Array);
    this.nor = g(this.nor, 3, Int8Array);
    this.wall = g(this.wall, 3, Float32Array);
    this.bid = g(this.bid, 1, Float32Array);
  }
  v(x, y, z, nx, ny, nz, u, t, L, bid) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.nor[i * 3] = Math.round(nx * 127);
    this.nor[i * 3 + 1] = Math.round(ny * 127);
    this.nor[i * 3 + 2] = Math.round(nz * 127);
    this.wall[i * 3] = u;
    this.wall[i * 3 + 1] = t;
    this.wall[i * 3 + 2] = L;
    this.bid[i] = bid;
    return i;
  }
  // 竖直墙面四边形：A→B，外法线 (-dz, dx)
  wall4(A, B, y0, y1, u0, bid, flip = false) {
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 0.05 || y1 - y0 < 0.02) return;
    let nx = -(B[1] - A[1]) / L;
    let nz = (B[0] - A[0]) / L;
    if (flip) {
      nx = -nx;
      nz = -nz;
    }
    const a = this.v(A[0], y0, A[1], nx, 0, nz, u0, 0, L, bid);
    const b = this.v(B[0], y0, B[1], nx, 0, nz, u0 + L, 1, L, bid);
    const c = this.v(B[0], y1, B[1], nx, 0, nz, u0 + L, 1, L, bid);
    const d = this.v(A[0], y1, A[1], nx, 0, nz, u0, 0, L, bid);
    if (flip) this.idx.push(a, c, b, a, d, c);
    else this.idx.push(a, b, c, a, c, d);
  }
  // 水平多边形（屋面 / 底面 / 廊下天花），up = +1 朝上
  flat(rings, y, bid, up = 1) {
    const contour = rings[0].map((p) => new THREE.Vector2(p[0], p[1]));
    const holes = rings.slice(1).map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
    let tris;
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    } catch {
      return;
    }
    const all = rings.flat();
    const base = this.n;
    for (const p of all) this.v(p[0], y, p[1], 0, up, 0, 0, 0.5, 1e4, bid);
    for (const t of tris) {
      const a = all[t[0]];
      const b = all[t[1]];
      const c = all[t[2]];
      // 叉积 y 分量：(b - a) × (c - a)
      const cy = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (cy * up > 0) this.idx.push(base + t[0], base + t[1], base + t[2]);
      else this.idx.push(base + t[0], base + t[2], base + t[1]);
    }
  }
  // 水平四边形（直接出两个三角形，避免逐个三角化的开销）
  quadH(q, y, bid, up = 1) {
    const base = this.n;
    for (const p of q) this.v(p[0], y, p[1], 0, up, 0, 0, 0.5, 1e4, bid);
    const a = q[0];
    const b = q[1];
    const c = q[2];
    const cy = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (cy * up > 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  build() {
    const g = new THREE.BufferGeometry();
    const n = this.n;
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n * 3), 3, true));
    g.setAttribute('aWall', new THREE.BufferAttribute(this.wall.slice(0, n * 3), 3));
    g.setAttribute('aBid', new THREE.BufferAttribute(this.bid.slice(0, n), 1));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// 顶点沿角平分线内缩（女儿墙内侧），限制斜接长度
function inset(ring, d) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i + n - 1) % n];
    const c = ring[i];
    const q = ring[(i + 1) % n];
    const l0 = Math.hypot(c[0] - p[0], c[1] - p[1]) || 1;
    const l1 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
    // 各边内法线 = (dz, -dx)
    const n0 = [(c[1] - p[1]) / l0, -(c[0] - p[0]) / l0];
    const n1 = [(q[1] - c[1]) / l1, -(q[0] - c[0]) / l1];
    let bx = n0[0] + n1[0];
    let bz = n0[1] + n1[1];
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-3) {
      bx = n0[0];
      bz = n0[1];
    } else {
      bx /= bl;
      bz /= bl;
    }
    const cosH = Math.max(0.35, bx * n0[0] + bz * n0[1]);
    out.push([c[0] + (bx * d) / cosH, c[1] + (bz * d) / cosH]);
  }
  return out;
}

export function buildFootprints(D) {
  const S = D.S;
  const bm = S.bldMeta;
  const nB = D.nBuildings;
  // ---- 建筑参数纹理 ----
  const rows = Math.ceil((nB * 4) / TEXW);
  const tex = new Float32Array(TEXW * rows * 4);
  for (let i = 0; i < nB; i++) {
    const o = i * BLD.N;
    const ca = linInt(bm[o + BLD.COL_A]);
    const cb = linInt(bm[o + BLD.COL_B]);
    tex.set([bm[o + BLD.STYLE], bm[o + BLD.FLOOR_H], bm[o + BLD.SEED], bm[o + BLD.LIT]], i * 16);
    tex.set([bm[o + BLD.CELL_W], bm[o + BLD.P1], bm[o + BLD.P2], bm[o + BLD.LED]], i * 16 + 4);
    tex.set([ca[0], ca[1], ca[2], bm[o + BLD.BASE]], i * 16 + 8);
    tex.set([cb[0], cb[1], cb[2], bm[o + BLD.TOP]], i * 16 + 12);
  }
  const btex = new THREE.DataTexture(tex, TEXW, rows, THREE.RGBAFormat, THREE.FloatType);
  btex.minFilter = btex.magFilter = THREE.NearestFilter;
  btex.needsUpdate = true;

  // ---- 骑楼临街边 ----
  const qmap = new Map();
  const qe = S.qilouEdges;
  for (let k = 0; k < qe.length; k += 2) {
    if (!qmap.has(qe[k])) qmap.set(qe[k], []);
    qmap.get(qe[k]).push(qe[k + 1]);
  }
  const ringOf = (ri) => {
    const p0 = S.bldRings[ri * 2];
    const n = S.bldRings[ri * 2 + 1];
    const out = [];
    for (let k = 0; k < n; k++) out.push([S.bldPts[(p0 + k) * 2], S.bldPts[(p0 + k) * 2 + 1]]);
    return out;
  };
  const outerOf = (i) => ringOf(bm[i * BLD.N + BLD.RING0]);

  // ---- 按分块生成网格 ----
  const tiles = new Map();
  const tileOf = (x, z) => {
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = new MB()));
    return t;
  };
  for (let i = 0; i < nB; i++) {
    const o = i * BLD.N;
    const r0 = bm[o + BLD.RING0];
    const nr = bm[o + BLD.NRINGS];
    const base = bm[o + BLD.BASE];
    const top = bm[o + BLD.TOP];
    const style = bm[o + BLD.STYLE];
    const roof = bm[o + BLD.ROOF];
    const hgt = top - base;
    const detailTile=D.detailGroups?.sourceTiles.get(D.buildingSourceIds[i]);
    let M;
    if(detailTile){const key=`detail:${detailTile}`;if(!tiles.has(key)){const mesh=new MB();mesh.detailTile=detailTile;tiles.set(key,mesh);}M=tiles.get(key);}
    else M=tileOf(bm[o + BLD.CX], bm[o + BLD.CZ]);
    const rings = [];
    for (let k = 0; k < nr; k++) rings.push(ringOf(r0 + k));
    const outer = rings[0];
    const q = qmap.get(i);
    // 女儿墙：平屋顶、有一定高度的建筑
    const parapet = roof === ROOF.FLAT && hgt >= 6 && outer.length <= 64 && style !== ST.BRICK ? (hgt > 80 ? 1.6 : hgt > 25 ? 1.1 : 0.9) : 0;
    if (q && q.length) {
      // 骑楼：首层（0..Hg）用退后的环，上部（Hg..top）用原始环
      const Hg = Math.min(5.2, hgt * 0.4);
      const Dq = 3.2;
      const lower = outer.map((p) => p.slice());
      const n = outer.length;
      const isFront = new Set(q);
      for (const e of q) {
        const A = outer[e];
        const B = outer[(e + 1) % n];
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
        const inx = (B[1] - A[1]) / L;
        const inz = -(B[0] - A[0]) / L;
        for (const vi of [e, (e + 1) % n]) {
          lower[vi][0] += inx * Dq;
          lower[vi][1] += inz * Dq;
        }
      }
      let u = 0;
      for (let e = 0; e < n; e++) {
        const A = outer[e];
        const B = outer[(e + 1) % n];
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        M.wall4(lower[e], lower[(e + 1) % n], base, base + Hg, u, isFront.has(e) ? i + ST.SHOP * 32768 : i);
        M.wall4(A, B, base + Hg, top + parapet, u, i);
        if (isFront.has(e)) {
          // 廊下天花（朝下）
          M.quadH([A, B, lower[(e + 1) % n], lower[e]], base + Hg, i, -1);
        }
        u += L;
      }
      M.flat([outer], top, i, 1);
      if (parapet) addParapet(M, outer, top, parapet, i);
      continue;
    }
    for (const ring of rings) {
      let u = 0;
      const n = ring.length;
      for (let e = 0; e < n; e++) {
        const A = ring[e];
        const B = ring[(e + 1) % n];
        M.wall4(A, B, base, top + (ring === outer ? parapet : 0), u, i);
        u += Math.hypot(B[0] - A[0], B[1] - A[1]);
      }
    }
    M.flat(rings, top, roof === ROOF.GREEN ? i + ST.GREENROOF * 32768 : i, 1);
    if (parapet) addParapet(M, outer, top, parapet, i);
    if (base > 0.5) M.flat(rings, base, i, -1);
  }
  const meshes = [],detailTiles=[];
  for (const [, M] of tiles) if (M.n) {meshes.push(M.build());detailTiles.push(M.detailTile||null);}
  return { geos: meshes, detailTiles, btex, qEdgesOf: (i) => qmap.get(i), outerOf };
}

// 女儿墙：外墙已加高，这里补内侧墙面与压顶
function addParapet(M, outer, top, ph, bid) {
  const inner = inset(outer, 0.35);
  const n = outer.length;
  let u = 0;
  for (let e = 0; e < n; e++) {
    const A = inner[e];
    const B = inner[(e + 1) % n];
    M.wall4(A, B, top, top + ph, u, bid, true);
    u += Math.hypot(B[0] - A[0], B[1] - A[1]);
    // 压顶（朝上）：外边 → 内边
    const oa = outer[e];
    const ob = outer[(e + 1) % n];
    M.quadH([oa, ob, B, A], top + ph, bid, 1);
  }
}
