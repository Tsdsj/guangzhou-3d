// 实例化构件：补全街区的建筑体量、骑楼廊道（真实临街面与补全地块）、屋顶设备、坡屋面、塔楼冠顶、
// 陈家祠 / 花塔等地标的构件。每个构件 = 单位几何体 + 变换 + 立面参数，由 facade 着色器统一渲染。

import { clamp, RNG, hash32, lin, mixCol, scaleCol } from '../core/rng.js';
import { BLD, FILL } from './schema.js';

export const ST = {
  PLAIN: 0, CURTAIN: 1, PUNCHED: 2, RESI: 3, WALKUP: 4, QILOU: 5, BRICK: 6, VILLAGE: 7, PODIUM: 8, SHOP: 9,
  FINS: 10, DIAGRID: 11, COLONIAL: 12, WOKEAR: 13, STONE: 14, SIGN: 15, METAL: 16, GREENROOF: 17, LANTERN: 18,
  RIDGE: 19, TILE: 20, ARCADE: 21, SIGNAL: 22,
};
export const GEOS = ['box', 'octo', 'cyl', 'rrect', 'taper', 'wedge', 'gable', 'hip', 'wokear', 'arcade', 'crestArc', 'crestStep', 'crestTri', 'crestScroll', 'cone', 'eave8'];
export const ROOF = { FLAT: 0, PLAIN: 1, GABLE: 2, HIP: 3, GREEN: 4, CANOPY: 5, WAVE: 6 };

const P_ = (arr) => arr.map(lin);
export const PAL = {
  glass: P_(['#6f8b96', '#5b7a86', '#8ea4ac', '#7b9090', '#4c6975', '#9aabb2', '#6c807c', '#8a8472', '#a4b8c0', '#56707e', '#7f98a6', '#667a86']),
  mull: P_(['#c7ccd0', '#8b9195', '#e4e6e7', '#50565b', '#b7b1a3', '#d6d2c8']),
  stone: P_(['#cfc9bd', '#b9b6ae', '#d8d3c8', '#a9a8a3', '#c2b8a6', '#bdb6aa']),
  qTrim: P_(['#3f5a47', '#5b3d2c', '#f1ece2', '#6b7f86', '#7a4a36', '#2f4a44']),
  brick: P_(['#7d8584', '#868c8a', '#737b7c', '#8e9290', '#7a8180']),
  sign: P_(['#c8322a', '#e0b22e', '#2f6db3', '#2f9a57', '#ece6d8', '#b8292e', '#f0c419', '#1d6fa5', '#d8452f']),
  tileGrey: P_(['#5d6263', '#666b6b', '#555a5c', '#6a6e6c']),
  tileGreen: P_(['#3f6f4f', '#4b7a55', '#3e6a5a']),
  tileRed: P_(['#9a4b36', '#a4553c', '#8e4431']),
  metalBlue: P_(['#3f6f9f', '#4a7fae', '#3d8a8a', '#6d7f8a']),
  roofTop: P_(['#8e8e8a', '#9a9993', '#7f807c']),
  shopIn: P_(['#6d5a48', '#5a5a5e', '#7a6a58', '#4f5357']),
};
export const WHITE = lin('#f2efe8');
export const DARK = lin('#3a3d40');
const RED = lin('#c3281e');
const GOLD = lin('#d4a64a');
export const linInt = (v) => lin(`#${(v >>> 0).toString(16).padStart(6, '0')}`);

class PartBuf {
  constructor() {
    this.n = 0;
    this.cap = 1024;
    this.M = new Float32Array(this.cap * 16);
    this.CA = new Float32Array(this.cap * 3);
    this.CB = new Float32Array(this.cap * 3);
    this.FA = new Float32Array(this.cap * 4);
    this.FB = new Float32Array(this.cap * 4);
  }
  grow() {
    this.cap *= 2;
    const g = (a, k) => {
      const b = new Float32Array(this.cap * k);
      b.set(a);
      return b;
    };
    this.M = g(this.M, 16);
    this.CA = g(this.CA, 3);
    this.CB = g(this.CB, 3);
    this.FA = g(this.FA, 4);
    this.FB = g(this.FB, 4);
  }
}

export class Parts {
  constructor() {
    this.parts = {};
    for (const k of GEOS) this.parts[k] = new PartBuf();
    this.pools = []; // 夜间灯光投影（骑楼廊下）
    this.qfront = []; // 骑楼开间位置（街景机位选择用）
    this.stats = { qilou: 0, lingnan: 0 };
    this.seedCounter = 1;
    this.y0 = 0; // 当前地面高度：补全地块与地标构件的 y 均相对它（山地上抬升）
  }
  // 与原程序化生成器相同的构件写入接口：rot 为绕 y 轴角度，局部 x 轴 = (cos, -sin)，局部 z 轴 = (sin, cos)
  add(geo, x, y, z, rot, sx, sy, sz, style, ca, cb, floorH = 3.2, cellW = 3, lit = 0.5, p1 = 0, p2 = 0, led = 0) {
    const b = this.parts[geo];
    if (b.n >= b.cap) b.grow();
    const i = b.n++;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const m = b.M;
    const o = i * 16;
    m[o] = c * sx; m[o + 1] = 0; m[o + 2] = -s * sx; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = s * sz; m[o + 9] = 0; m[o + 10] = c * sz; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y + this.y0; m[o + 14] = z; m[o + 15] = 1;
    b.CA[i * 3] = ca[0]; b.CA[i * 3 + 1] = ca[1]; b.CA[i * 3 + 2] = ca[2];
    b.CB[i * 3] = cb[0]; b.CB[i * 3 + 1] = cb[1]; b.CB[i * 3 + 2] = cb[2];
    const sd = (hash32(this.seedCounter++, 77) % 9973) / 10;
    b.FA[i * 4] = style; b.FA[i * 4 + 1] = floorH; b.FA[i * 4 + 2] = sd; b.FA[i * 4 + 3] = lit;
    b.FB[i * 4] = cellW; b.FB[i * 4 + 1] = p1; b.FB[i * 4 + 2] = p2; b.FB[i * 4 + 3] = led;
  }
}

// 局部框架：中心 c、沿 u 宽 w、沿 v 深 d；v = (-uz, ux)
const rotOf = (ux, uz) => Math.atan2(-uz, ux);
const offF = (F, a, b) => [F.x + F.ux * a - F.uz * b, F.z + F.uz * a + F.ux * b];

// ====================================================================================
// 骑楼单元：一个开间（宽 W）的廊柱拱券 + 退后铺面 + 上部楼层 + 女儿墙山花 + 招牌灯笼
// front：临街面位置（中心线上的点）、n：指向建筑内部的单位法线、t：沿街方向
// ====================================================================================
export function qilouUnit(P, r, front, t, n, W, D, Ht, opt = {}) {
  const Aw = opt.Aw ?? r.float(3.2, 3.8);
  const Hg = opt.Hg ?? r.float(4.7, 5.3);
  let rot = Math.atan2(-t[1], t[0]);
  if (Math.sin(rot) * n[0] + Math.cos(rot) * n[1] < 0) rot += Math.PI;
  const facade = opt.facade || scaleCol(r.pick(PAL.qTrim), 1);
  const trim = opt.trim || r.pick(PAL.qTrim);
  const [fx, fz] = front;
  if (opt.body) {
    // 补全地块：自建楼体（上部楼层悬挑至临街线，首层铺面退后 Aw）
    P.add('box', fx + n[0] * D * 0.5, Hg, fz + n[1] * D * 0.5, rot, W - 0.05, Ht - Hg, D, ST.QILOU, facade, trim, opt.floorH || 3.6, W / (W > 4.7 ? 3 : 2), r.float(0.28, 0.5), opt.arch ?? r.int(0, 2), r.next(), 0);
    P.add('box', fx + n[0] * (Aw + (D - Aw) * 0.5), 0, fz + n[1] * (Aw + (D - Aw) * 0.5), rot, W, Hg, D - Aw, ST.SHOP, r.pick(PAL.shopIn), trim, Hg, W / 2, 0.92, 1, 0, 0);
    // 廊下天花（夜间暖光）
    P.add('box', fx + n[0] * Aw * 0.5, Hg - 0.25, fz + n[1] * Aw * 0.5, rot, W, 0.25, Aw, ST.QILOU, facade, trim, 3, 3, 0);
  }
  P.add('arcade', fx + n[0] * 0.3, 0, fz + n[1] * 0.3, rot, W, Hg, 0.6, ST.ARCADE, facade, trim, Hg, W, 0);
  const ph = r.float(0.9, 1.5);
  P.add('box', fx + n[0] * 0.25, Ht, fz + n[1] * 0.25, rot, W, ph, 0.45, ST.PLAIN, facade, trim, 3, 3, 0);
  if (r.chance(0.58)) {
    const crest = r.pickW(['crestArc', 'crestStep', 'crestTri', 'crestScroll'], [3, 2, 1.5, 2.5]);
    P.add(crest, fx + n[0] * 0.25, Ht + ph, fz + n[1] * 0.25, rot, W * r.float(0.5, 0.86), r.float(1.1, 2.3), 0.4, ST.PLAIN, facade, trim, 3, 3, 0);
  }
  if (r.chance(0.5)) {
    const sh = r.float(2.4, Math.max(2.5, Math.min(6.5, Ht - Hg - 0.6)));
    P.add('box', fx + t[0] * (W / 2 - 0.4) - n[0] * 0.55, Hg + 0.5, fz + t[1] * (W / 2 - 0.4) - n[1] * 0.55, rot, 0.16, sh, 1.0, ST.SIGN, r.pick(PAL.sign), WHITE, 1, 1, 1, 1);
  }
  if (r.chance(0.38)) P.add('box', fx - n[0] * 0.03, Hg - 1.02, fz - n[1] * 0.03, rot, W * 0.8, 0.6, 0.1, ST.SIGN, r.pick(PAL.sign), WHITE, 1, 1, 1, 0);
  if (r.chance(0.2)) P.add('cyl', fx + n[0] * Aw * 0.5, Hg - 1.3, fz + n[1] * Aw * 0.5, 0, 0.6, 0.75, 0.6, ST.LANTERN, RED, GOLD, 1, 1, 1);
  if (opt.body) {
    const rr = r.next();
    if (rr < 0.36) P.add('gable', fx + n[0] * D * 0.72, Ht, fz + n[1] * D * 0.72, rot, W + 0.1, 1.9, D * 0.56, ST.TILE, r.pick(PAL.tileGrey), DARK, 3, 1, 0);
    else if (rr < 0.6) P.add('box', fx + n[0] * D * 0.7, Ht, fz + n[1] * D * 0.7, rot, W * 0.6, 2.6, D * 0.3, ST.PLAIN, facade, facade, 3, 3, 0);
    else if (rr < 0.7) P.add('gable', fx + n[0] * D * 0.62, Ht, fz + n[1] * D * 0.62, rot, W * 0.8, 1.5, D * 0.4, ST.TILE, r.pick(PAL.metalBlue), DARK, 3, 1, 0, 1);
  }
  P.qfront.push(fx, fz);
  P.pools.push(fx + n[0] * Aw * 0.5, 0.2, fz + n[1] * Aw * 0.5, 3.2, 3);
  if (r.chance(0.5)) P.pools.push(fx - n[0] * 2.6, 0.19, fz - n[1] * 2.6, 5.2, 3);
  P.stats.qilou++;
}

// 真实建筑轮廓的骑楼临街面：沿该边按 4–5.5 m 开间布置廊柱拱券、山花与招牌（墙体退后与廊下天花由合并网格生成）
export function qilouEdge(P, r, A, B, top, facade, trim, Hg, archType) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const t = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
  // 内法线（环为正面积方向时外法线 = (-dz, dx)）
  const n = [t[1], -t[0]];
  const nb = Math.max(1, Math.round(L / 4.6));
  const W = L / nb;
  for (let k = 0; k < nb; k++) {
    const s = (k + 0.5) * W;
    const f = [A[0] + t[0] * s, A[1] + t[1] * s];
    qilouUnit(P, r, f, t, n, W, 0, top, { Hg, facade, trim, arch: archType });
  }
}

// ====================================================================================
// 补全地块（FILL 记录）：x, z, ux, uz, w, d, h, style, colA, colB, floorH, cellW, lit, p1, p2, led, roof, flags
// ====================================================================================
export function emitFillLot(P, f, k) {
  const o = k * FILL.N;
  P.y0 = f[o + FILL.Y];
  const F = { x: f[o + FILL.X], z: f[o + FILL.Z], ux: f[o + FILL.UX], uz: f[o + FILL.UZ] };
  const w = f[o + FILL.W];
  const d = f[o + FILL.D];
  const h = f[o + FILL.H];
  const style = f[o + FILL.STYLE];
  const colA = linInt(f[o + FILL.COL_A]);
  const colB = linInt(f[o + FILL.COL_B]);
  const floorH = f[o + FILL.FLOOR_H];
  const cellW = f[o + FILL.CELL_W];
  const lit = f[o + FILL.LIT];
  const p1 = f[o + FILL.P1];
  const p2 = f[o + FILL.P2];
  const roof = f[o + FILL.ROOF];
  const flags = f[o + FILL.FLAGS];
  const rot = rotOf(F.ux, F.uz);
  const r = new RNG(hash32(Math.round(F.x * 10), Math.round(F.z * 10), 31));
  if (flags & 64) {
    // 骑楼：临街面为 -v 侧
    const front = offF(F, 0, -d / 2);
    const n = [-F.uz, F.ux];
    qilouUnit(P, r, front, [F.ux, F.uz], n, w, d, h, { body: true, facade: colA, trim: colB, floorH });
    return;
  }
  if (style === ST.BRICK) {
    // 竹筒屋 / 西关大屋：青砖墙 + 灰瓦双坡顶（屋脊沿进深方向）+ 部分镬耳山墙
    P.add('box', F.x, 0, F.z, rot, w, h, d, ST.BRICK, colA, colB, floorH, cellW, lit, p1);
    if (roof === ROOF.GABLE) {
      const rh = Math.min(w, d) * r.float(0.22, 0.28);
      const roofCol = r.chance(0.12) ? r.pick(PAL.tileGreen) : r.pick(PAL.tileGrey);
      P.add('gable', F.x, h, F.z, rot + Math.PI / 2, d + 0.6, rh, w + 0.35, ST.TILE, roofCol, DARK, 3, 1, 0);
      P.add('box', F.x, h + rh - 0.12, F.z, rot + Math.PI / 2, d + 0.5, 0.42, 0.42, ST.PLAIN, lin('#3e4244'), DARK, 3, 3, 0);
      if (h < 11 && r.chance(0.12)) {
        const sy = (h + 0.1) / 0.6;
        for (const sg of [-1, 1]) {
          const p = offF(F, sg * (w / 2 + 0.05), 0);
          P.add('wokear', p[0], 0, p[1], rot + Math.PI / 2, d + 0.5, sy, 0.45, ST.WOKEAR, scaleCol(r.pick(PAL.brick), r.float(0.95, 1.05)), lin('#34383a'), 3, 3, 0);
        }
        P.stats.lingnan++;
      }
    } else rooftop(P, r, F, rot, w, d, h, 'low');
    return;
  }
  P.add('box', F.x, 0, F.z, rot, w, h, d, style, colA, colB, floorH, cellW, lit, p1, p2, 0);
  if (style === ST.RESI && h > 30) towerCrownRes(P, r, F, rot, w, d, h, colA, colB);
  else rooftop(P, r, F, rot, w, d, h, h > 22 ? 'mid' : 'low');
}

// 住宅塔楼冠顶：坡屋面小楼、装饰构架、四坡顶或水箱间
function towerCrownRes(P, r, F, rot, w, d, h, col, trim) {
  const cr = r.next();
  if (cr < 0.3) {
    P.add('box', F.x, h, F.z, rot, w * 0.55, 4.2, d * 0.5, ST.RESI, col, trim, 3.0, 3.5, 0.3);
    P.add('gable', F.x, h + 4.2, F.z, rot, w * 0.6, 2.6, d * 0.56, ST.TILE, r.pick([...PAL.tileRed, ...PAL.tileGrey]), DARK, 3, 1, 0);
  } else if (cr < 0.55) {
    for (const [a, b] of [[-0.42, -0.4], [0.42, -0.4], [-0.42, 0.4], [0.42, 0.4]]) {
      const p = offF(F, a * w, b * d);
      P.add('box', p[0], h, p[1], rot, 0.8, 6, 0.8, ST.PLAIN, trim, trim, 3, 3, 0);
    }
    P.add('box', F.x, h + 6, F.z, rot, w * 0.92, 0.7, d * 0.9, ST.PLAIN, trim, trim, 3, 3, 0);
    P.add('box', F.x, h, F.z, rot, w * 0.3, 3.5, d * 0.3, ST.RESI, col, trim, 3, 3.5, 0.2);
  } else if (cr < 0.75) {
    P.add('hip', F.x, h, F.z, rot, w * 0.8, 4.5, d * 0.75, ST.TILE, r.pick([...PAL.tileRed, ...PAL.tileGreen, ...PAL.tileGrey]), DARK, 3, 1, 0);
  } else {
    P.add('box', F.x, h, F.z, rot, w * 0.35, 3.2, d * 0.35, ST.RESI, col, trim, 3, 3.5, 0.2);
    const tk = offF(F, w * 0.25, 0);
    P.add('cyl', tk[0], h, tk[1], rot, 3, 2.6, 3, ST.METAL, PAL.roofTop[1], WHITE, 3, 1, 0);
  }
}

// 通用屋顶设备：楼梯间、水箱、空调外机、蓝色铁皮加建、屋顶广告牌
export function rooftop(P, r, F, rot, w, d, h, kind) {
  const k = r.next();
  if (k < 0.4 && w > 6 && d > 6) {
    const p = offF(F, r.float(-0.3, 0.3) * w, r.float(-0.2, 0.2) * d);
    P.add('cyl', p[0], h, p[1], 0, 2.4, 2.2, 2.4, ST.METAL, lin('#9aa3a8'), WHITE, 3, 1, 0);
  }
  if (k > 0.25 && w > 7 && d > 7) {
    const p = offF(F, r.float(-0.3, 0.3) * w, r.float(-0.2, 0.2) * d);
    P.add('box', p[0], h, p[1], rot, r.float(3, 5), 2.8, r.float(3, 4.5), ST.PLAIN, PAL.roofTop[0], PAL.roofTop[1], 3, 3, 0);
  }
  if (kind !== 'low' && w > 12 && d > 10) {
    // 空调外机阵列
    const n = r.int(2, 5);
    const b0 = r.float(-0.3, 0.3) * d;
    for (let i = 0; i < n; i++) {
      const p = offF(F, (i - (n - 1) / 2) * 1.6, b0);
      P.add('box', p[0], h, p[1], rot, 1.2, 1.0, 0.8, ST.METAL, lin('#b9bdbf'), WHITE, 3, 1, 0);
    }
  }
  if (r.chance(kind === 'low' ? 0.22 : 0.1) && w > 8) {
    const sw = Math.min(w * 0.5, r.float(6, 12));
    const p = offF(F, r.float(-0.25, 0.25) * w, 0);
    P.add('gable', p[0], h, p[1], rot, sw, 1.6, d * 0.7, ST.TILE, r.pick(PAL.metalBlue), DARK, 3, 1, 0, 1);
  }
}

// ====================================================================================
// 真实建筑的屋顶细节（依据最小外接矩形与风格）
// ====================================================================================
export function osmRoofDetails(P, bm, i, qEdgesOf, getRing) {
  const o = i * BLD.N;
  const base = bm[o + BLD.BASE];
  const top = bm[o + BLD.TOP];
  const style = bm[o + BLD.STYLE];
  const roof = bm[o + BLD.ROOF];
  const flags = bm[o + BLD.FLAGS];
  const F = { x: bm[o + BLD.CX], z: bm[o + BLD.CZ], ux: bm[o + BLD.UX], uz: bm[o + BLD.UZ] };
  const w = bm[o + BLD.W];
  const d = bm[o + BLD.D];
  const areaF = bm[o + BLD.AREA];
  const rot = rotOf(F.ux, F.uz);
  const r = new RNG(hash32(i, 4242));
  const colA = linInt(bm[o + BLD.COL_A]);
  const colB = linInt(bm[o + BLD.COL_B]);
  const hgt = top - base;
  if (roof === ROOF.GABLE || roof === ROOF.HIP) {
    const rh = Math.min(w, d) * (roof === ROOF.GABLE ? r.float(0.22, 0.3) : r.float(0.2, 0.28));
    const tile = style === ST.COLONIAL ? r.pick([...PAL.tileRed, ...PAL.tileGrey]) : r.chance(0.12) ? r.pick(PAL.tileGreen) : r.pick(PAL.tileGrey);
    // 屋脊沿长边
    const long = w >= d;
    const rr = long ? rot : rot + Math.PI / 2;
    const L = long ? w : d;
    const S = long ? d : w;
    P.add(roof === ROOF.GABLE ? 'gable' : 'hip', F.x, top, F.z, rr, L + 0.6, rh, S + 0.7, ST.TILE, tile, DARK, 3, 1, 0);
    if (roof === ROOF.GABLE && style === ST.BRICK) P.add('box', F.x, top + rh - 0.12, F.z, rr, L + 0.5, 0.42, 0.42, ST.PLAIN, lin('#3e4244'), DARK, 3, 3, 0);
    return;
  }
  if (roof === ROOF.CANOPY || roof === ROOF.PLAIN || roof === ROOF.WAVE) return;
  // 骑楼临街面
  const qe = qEdgesOf(i);
  if (qe && qe.length) {
    const ring = getRing(i);
    const Hg = Math.min(5.2, hgt * 0.4);
    for (const e of qe) {
      const A = ring[e];
      const B = ring[(e + 1) % ring.length];
      qilouEdge(P, r, A, B, top, colA, colB, Hg, bm[o + BLD.P1]);
    }
  }
  if (w < 5 || d < 5 || areaF < 40) return;
  const rect = areaF / Math.max(1, w * d);
  const sw = Math.min(w, d);
  if (flags & 16 && hgt > 80) {
    // 超高层冠顶：机房 + 冠顶造型 / 桅杆
    const cw = Math.min(w, 60) * (rect > 0.8 ? 0.62 : 0.45);
    const cd = Math.min(d, 60) * (rect > 0.8 ? 0.62 : 0.45);
    const c = r.pickW(['box', 'spire', 'mast', 'ring', 'plant'], [3, 1, 2, rect > 0.8 ? 1.5 : 0, 3]);
    if (c === 'box') P.add('box', F.x, top, F.z, rot, cw, 5 + hgt * 0.03, cd, ST.CURTAIN, mixCol(colA, WHITE, 0.25), colB, 3.5, 1.4, 0.2, 1, 0, 3);
    else if (c === 'spire') P.add('cone', F.x, top, F.z, rot, sw * 0.3, hgt * 0.1, sw * 0.3, ST.METAL, lin('#c9ced3'), WHITE, 3, 1, 0, 0, 0, 3);
    else if (c === 'ring' && rect > 0.8) P.add('box', F.x, top, F.z, rot, w * 1.0, 6, d * 1.0, ST.METAL, colB, colB, 3, 2, 0, 0, 0, 3);
    else P.add('box', F.x, top, F.z, rot, cw, 5.5, cd, ST.PLAIN, PAL.roofTop[r.int(0, 2)], PAL.roofTop[0], 3, 3, 0);
    if (c === 'mast' || r.chance(0.2)) P.add('cyl', F.x, top, F.z, 0, 1.3, hgt * r.float(0.06, 0.12), 1.3, ST.METAL, lin('#b8bcc0'), WHITE, 3, 1, 0, 0, 0, 3);
    // 擦窗机轨道
    if (rect > 0.75) P.add('box', F.x, top + 0.2, F.z, rot, w * 0.85, 0.5, 0.6, ST.METAL, lin('#9aa0a4'), WHITE, 3, 1, 0);
    return;
  }
  if (style === ST.RESI && hgt > 30 && rect > 0.6) {
    towerCrownRes(P, r, F, rot, Math.min(w, 40), Math.min(d, 30), top, colA, colB);
    return;
  }
  if (style === ST.PODIUM || (style === ST.PLAIN && areaF > 1500)) {
    // 大屋面：成排空调外机与冷却塔
    const n = clamp(Math.floor(w / 9), 1, 6);
    for (let k = 0; k < n; k++) {
      const p = offF({ ...F }, (k - (n - 1) / 2) * 8, r.float(-0.2, 0.2) * d);
      P.add('box', p[0], top, p[1], rot, 5, 2.2, 3, ST.METAL, lin('#aeb3b5'), WHITE, 3, 1, 0);
    }
    if (r.chance(0.4)) {
      const p = offF(F, w * 0.25, d * 0.2);
      P.add('cyl', p[0], top, p[1], 0, 4.2, 3.5, 4.2, ST.METAL, lin('#c4c8ca'), WHITE, 3, 1, 0);
    }
    return;
  }
  if (flags & 2) rooftop(P, r, { ...F }, rot, Math.min(w, 30), Math.min(d, 30), top, hgt > 22 ? 'mid' : 'low');
  // 商业楼屋顶招牌
  if ((style === ST.PUNCHED || style === ST.STONE) && hgt > 20 && hgt < 90 && r.chance(0.18)) {
    const p = offF(F, 0, -d * 0.4);
    P.add('box', p[0], top, p[1], rot, Math.min(w * 0.6, 18), 3.2, 0.3, ST.SIGN, r.pick(PAL.sign), WHITE, 1, 1, 1, 0);
  }
}

// ====================================================================================
// 地标构件
// ====================================================================================
// 陈家祠：三路三进，屋脊满布彩色陶塑；F 的 v 轴指向北（t = 0 为南侧正门广场）
export function chenClan(P, spec) {
  const F = { x: spec.x, z: spec.z, ux: -spec.ux, uz: -spec.uz };
  const W = spec.w;
  const Dd = spec.d;
  const rot = rotOf(F.ux, F.uz);
  const R = (s0, s1, t0, t1) => {
    const c = offF(F, ((s0 + s1) / 2 - 0.5) * W, ((t0 + t1) / 2 - 0.5) * Dd);
    return { x: c[0], z: c[1], w: (s1 - s0) * W, d: (t1 - t0) * Dd, rot };
  };
  const col = lin('#838987');
  const roof = lin('#5a605f');
  for (const cu of [0.2, 0.5, 0.8]) {
    for (const rv of [0.36, 0.6, 0.84]) {
      const wf = cu === 0.5 ? 0.24 : 0.2;
      const Q = R(cu - wf / 2, cu + wf / 2, rv - 0.08, rv + 0.08);
      const hh = cu === 0.5 ? 9.5 : 8;
      P.add('box', Q.x, 0, Q.z, rot, Q.w, hh, Q.d, ST.BRICK, col, lin('#3b2f28'), 4, 4.2, 0.2);
      const rh = Q.d * 0.3;
      P.add('gable', Q.x, hh, Q.z, rot, Q.w + 1.2, rh, Q.d + 1.6, ST.TILE, roof, DARK, 3, 1, 0);
      P.add('box', Q.x, hh + rh - 0.2, Q.z, rot, Q.w + 0.6, cu === 0.5 ? 2.2 : 1.5, 0.7, ST.RIDGE, lin('#4e8a6a'), lin('#d9a441'), 1, 0.9, 0);
      for (const sg of [-1, 1]) {
        const p = [Q.x + F.ux * sg * (Q.w / 2 + 0.3), Q.z + F.uz * sg * (Q.w / 2 + 0.3)];
        P.add('box', p[0], hh + rh - 0.1, p[1], rot, 1.2, 1.4, 1.2, ST.RIDGE, lin('#b8472f'), lin('#e0b64a'), 1, 0.6, 0);
      }
    }
  }
  for (const cu of [0.35, 0.65]) {
    const Q = R(cu - 0.015, cu + 0.015, 0.3, 0.9);
    P.add('box', Q.x, 0, Q.z, rot, Q.w, 5, Q.d, ST.BRICK, col, DARK, 4, 4, 0.1);
  }
  for (const [t0, t1] of [[0.24, 0.26], [0.955, 0.965]]) {
    const Q = R(0.04, 0.96, t0, t1);
    P.add('box', Q.x, 0, Q.z, rot, Q.w, 5.5, 0.8, ST.BRICK, col, DARK, 4, 6, 0);
  }
  for (const cu of [0.04, 0.96]) {
    const Q = R(cu - 0.006, cu + 0.006, 0.25, 0.96);
    P.add('box', Q.x, 0, Q.z, rot, 0.8, 5.5, Q.d, ST.BRICK, col, DARK, 4, 6, 0);
  }
  P.stats.lingnan += 9;
}

// 八角楼阁式塔（六榕花塔 / 琶洲塔）
export function pagoda(P, x, z, H, seed) {
  const r = new RNG(seed);
  const rot = r.float(0, Math.PI);
  const levels = H > 58 ? 9 : 9;
  const s = H / 57;
  P.add('octo', x, 0, z, rot, 17 * s, 3 * s, 17 * s, ST.STONE, lin('#b9b3a6'), lin('#8d877b'), 3, 2, 0);
  let y = 3 * s;
  let rad = 12.5 * s;
  for (let i = 0; i < levels; i++) {
    const hh = (i === 0 ? 6.2 : 5.0) * s;
    P.add('octo', x, y, z, rot, rad, hh, rad, ST.COLONIAL, lin('#e3d9c4'), lin('#9b2f24'), hh, rad * 0.4, 0.12, 1, 0);
    y += hh;
    P.add('eave8', x, y - 0.6, z, rot, rad + 3.4 * s, 1.4, rad + 3.4 * s, ST.TILE, i % 2 ? lin('#3f6f4f') : lin('#9a4b36'), DARK, 3, 1, 0);
    y += 0.8;
    rad *= 0.935;
  }
  P.add('cone', x, y, z, rot, 2.2, Math.max(4, H - y), 2.2, ST.METAL, GOLD, GOLD, 3, 1, 0, 0, 0, 3);
}

// 中山纪念堂：八角形主堂 + 四面抱厦，重檐八角攒尖蓝琉璃瓦顶，宝顶鎏金
export function memorialHall(P, spec) {
  const rot = rotOf(spec.ux, spec.uz);
  const F = { x: spec.x, z: spec.z, ux: spec.ux, uz: spec.uz };
  const s = clamp(spec.w / 72, 0.75, 1.15);
  const wall = lin('#e6dcc4');
  const red = lin('#8e2a22');
  const blue = lin('#2c5f8f');
  const gold = lin('#d4a64a');
  P.add('octo', F.x, 0, F.z, rot, 50 * s, 2.2, 50 * s, ST.STONE, lin('#b8b2a4'), wall, 2.2, 3, 0);
  P.add('octo', F.x, 2.2, F.z, rot, 44 * s, 17 * s, 44 * s, ST.COLONIAL, wall, red, 5.6 * s, 3.2, 0.25);
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI * 0.5;
    const ox = Math.cos(a);
    const oz = Math.sin(a);
    const p = offF(F, ox * 27 * s, oz * 27 * s);
    const rr = rot + a;
    P.add('box', p[0], 2.2, p[1], rr + Math.PI / 2, 18 * s, 15 * s, 12 * s, ST.COLONIAL, wall, red, 5 * s, 2.6, 0.25);
    P.add('hip', p[0], 2.2 + 15 * s, p[1], rr + Math.PI / 2, 21 * s, 6 * s, 15 * s, ST.TILE, blue, DARK, 3, 1, 0);
  }
  let y = 2.2 + 17 * s;
  P.add('eave8', F.x, y - 0.6, F.z, rot, 58 * s, 5 * s, 58 * s, ST.TILE, blue, DARK, 3, 1, 0);
  y += 3.6 * s;
  P.add('octo', F.x, y, F.z, rot, 32 * s, 6 * s, 32 * s, ST.COLONIAL, wall, red, 3 * s, 2.4, 0.2);
  y += 6 * s;
  P.add('eave8', F.x, y - 0.4, F.z, rot, 40 * s, 14 * s, 40 * s, ST.TILE, blue, DARK, 3, 1, 0);
  y += 13 * s;
  P.add('cone', F.x, y, F.z, rot, 6 * s, 9 * s, 6 * s, ST.METAL, gold, gold, 3, 1, 0, 0, 0, 3);
}

// 石室圣心大教堂：花岗岩哥特式教堂，十字形平面，正立面双塔尖顶
export function cathedral(P, spec) {
  const fx = spec.fx;
  const fz = spec.fz;
  // 局部框架：u 为横向，v 指向正立面
  const F = { x: spec.x, z: spec.z, ux: fz, uz: -fx };
  const rot = rotOf(F.ux, F.uz);
  const L = Math.min(spec.L, 82);
  const W = Math.min(spec.W, 36);
  const stone = lin('#8d8a84');
  const dark = lin('#3b3f44');
  const roofC = lin('#4a4f55');
  P.add('box', F.x, 0, F.z, rot, W * 0.62, 22, L * 0.9, ST.STONE, stone, dark, 5.5, 3.2, 0.2);
  P.add('gable', F.x, 22, F.z, rot + Math.PI / 2, L * 0.9, 9, W * 0.64, ST.TILE, roofC, DARK, 3, 1, 0);
  // 侧廊
  for (const sg of [-1, 1]) {
    const p = offF(F, sg * W * 0.4, 0);
    P.add('box', p[0], 0, p[1], rot, W * 0.18, 12, L * 0.82, ST.STONE, stone, dark, 5.5, 3.2, 0.2);
  }
  // 耳堂
  const tp = offF(F, 0, -L * 0.12);
  P.add('box', tp[0], 0, tp[1], rot, W * 1.02, 21, 13, ST.STONE, stone, dark, 5.5, 3.2, 0.2);
  P.add('gable', tp[0], 21, tp[1], rot, W * 1.04, 8, 13.5, ST.TILE, roofC, DARK, 3, 1, 0);
  // 正立面双塔：方塔身 + 八角钟楼 + 尖顶（总高 58.5 m）
  for (const sg of [-1, 1]) {
    const p = offF(F, sg * W * 0.24, L * 0.44);
    P.add('box', p[0], 0, p[1], rot, 9, 30, 9, ST.STONE, stone, dark, 6, 2.4, 0.15);
    P.add('octo', p[0], 30, p[1], rot, 8, 8, 8, ST.STONE, stone, dark, 4, 1.6, 0.15);
    P.add('cone', p[0], 38, p[1], rot, 8.4, 20.5, 8.4, ST.TILE, lin('#6d6a64'), DARK, 3, 1, 0);
    P.add('cyl', p[0], 58.3, p[1], 0, 0.3, 2.4, 0.3, ST.METAL, lin('#d8dadc'), WHITE, 3, 1, 0);
  }
  const g = offF(F, 0, L * 0.44);
  P.add('box', g[0], 0, g[1], rot, W * 0.3, 27, 7, ST.STONE, stone, dark, 5.5, 3, 0.2);
  P.add('crestTri', g[0], 27, g[1], rot, W * 0.3, 7, 1.2, ST.STONE, stone, dark, 3, 3, 0);
}

// 镇海楼：五层楼阁，红墙、绿琉璃瓦重檐
export function zhenhai(P, spec) {
  const rot = rotOf(spec.ux, spec.uz);
  let w = Math.max(spec.w, 20);
  let d = Math.max(spec.d, 12);
  if (d > w) [w, d] = [d, w];
  const red = lin('#9b3a2e');
  const green = lin('#3f6f4f');
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const hh = i < 2 ? 5.6 : 4.6;
    P.add('box', spec.x, y, spec.z, rot, w, hh, d, i < 2 ? ST.BRICK : ST.COLONIAL, red, lin('#e0b64a'), hh, 3, 0.2);
    y += hh;
    P.add('hip', spec.x, y - 0.3, spec.z, rot, w + 3, i === 4 ? 5.2 : 1.6, d + 3, ST.TILE, green, DARK, 3, 1, 0);
    y += i === 4 ? 0 : 0.6;
    w *= 0.97;
    d *= 0.97;
  }
}

// 路口信号灯：立杆 + 悬臂 + 灯箱（红黄绿按周期切换）
export function trafficSignal(P, x, z, ax, az, arm) {
  const rot = Math.atan2(-az, ax);
  P.add('cyl', x, 0, z, 0, 0.34, 6.4, 0.34, ST.METAL, lin('#5a5f63'), WHITE, 3, 1, 0);
  P.add('box', x + (ax * arm) / 2, 6.1, z + (az * arm) / 2, rot, arm, 0.22, 0.22, ST.METAL, lin('#5a5f63'), WHITE, 3, 1, 0);
  P.add('box', x + ax * arm * 0.85, 5.1, z + az * arm * 0.85, rot, 0.4, 1.3, 0.36, ST.SIGNAL, lin('#1d1f21'), WHITE, 1, 1, 0);
}

// 周大福金融中心（东塔）：切角方形平面，四段收分，冠顶灯光
export function ctfTower(P, spec) {
  const rot = rotOf(spec.ux, spec.uz);
  const H = spec.h;
  const glass = lin('#56656b');
  const fin = lin('#e7e1d3');
  const base = clamp(spec.w, 50, 66);
  P.add('box', spec.x, 0, spec.z, rot, base * 1.7, 26, base * 1.5, ST.PODIUM, lin('#d8d3c8'), PAL.glass[3], 6, 8, 0.9);
  const fr = [0.36, 0.26, 0.2, 0.12];
  let y = 0;
  let wd = base;
  for (let i = 0; i < 4; i++) {
    const th = H * fr[i];
    P.add('octo', spec.x, y, spec.z, rot, wd, th, wd, ST.FINS, glass, fin, 4.2, 1.25, 0.72, 0, 0, 1);
    y += th;
    // 收分处的设备层（白色横带）
    if (i < 3) P.add('octo', spec.x, y - 3.2, spec.z, rot, wd * 1.005, 3.2, wd * 1.005, ST.PLAIN, fin, fin, 3, 3, 0);
    wd *= 0.86;
  }
  P.add('octo', spec.x, y, spec.z, rot, wd * 0.82, H * 0.035, wd * 0.82, ST.FINS, glass, fin, 4.2, 1.25, 0.3, 1, 0, 3);
  y += H * 0.035;
  P.add('octo', spec.x, y, spec.z, rot, wd * 0.5, H * 0.02, wd * 0.5, ST.METAL, fin, fin, 3, 1, 0, 0, 0, 3);
}
