// 离线数据构建用的几何与栅格工具：投影、多边形、简化、环拼接、栅格填充、距离变换、PNG 输出。

import zlib from 'node:zlib';
import fs from 'node:fs';

// ---------- 投影：经纬度 → 本地米制坐标（x 向东，z 向南）----------
export const LON0 = 113.296;
export const LAT0 = 23.1185;
export const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
export const KZ = 110750;
export const proj = (lon, lat) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
export const unproj = (x, z) => [x / KX + LON0, -z / KZ + LAT0];

// ---------- 确定性随机 ----------
export function hash32(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) {
    let v = typeof x === 'number' ? Math.floor(x) : 0;
    if (typeof x === 'string') for (let i = 0; i < x.length; i++) v = (Math.imul(v, 31) + x.charCodeAt(i)) | 0;
    h ^= v & 0xffff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xffff;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}
export const rand01 = (...xs) => hash32(...xs) / 4294967296;
export class RNG {
  constructor(seed) {
    this.s = seed >>> 0 || 1;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.float(a, b + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  pickW(arr, w) {
    let s = 0;
    for (const x of w) s += x;
    let r = this.next() * s;
    for (let i = 0; i < arr.length; i++) {
      r -= w[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  }
}

// ---------- 多边形 ----------
export function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}
export function centroid(ring) {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cz += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    let x = 0;
    let z = 0;
    for (const p of ring) {
      x += p[0];
      z += p[1];
    }
    return [x / ring.length, z / ring.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}
export function bbox(ring) {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const p of ring) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1];
    if (p[1] > z1) z1 = p[1];
  }
  return [x0, z0, x1, z1];
}
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const zi = ring[i][1];
    const xj = ring[j][0];
    const zj = ring[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
export function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - ax - vx * t;
  const dz = pz - az - vz * t;
  return Math.sqrt(dx * dx + dz * dz);
}
// 去重 + 去掉闭合重复点（环以不闭合形式存储）
export function cleanRing(pts, closed = true) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) out.push(p);
  }
  if (closed && out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.05) out.pop();
  }
  return out;
}
// Ramer–Douglas–Peucker
export function simplify(pts, tol, closed = false) {
  if (pts.length < 3) return pts.slice();
  const P = closed ? [...pts, pts[0]] : pts;
  const keep = new Uint8Array(P.length);
  keep[0] = 1;
  keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0;
    let mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(P[i][0], P[i][1], P[a][0], P[a][1], P[b][0], P[b][1]);
      if (d > md) {
        md = d;
        mi = i;
      }
    }
    if (md > tol && mi > 0) {
      keep[mi] = 1;
      stack.push([a, mi], [mi, b]);
    }
  }
  const out = [];
  for (let i = 0; i < P.length; i++) if (keep[i]) out.push(P[i]);
  if (closed) out.pop();
  return out;
}
// 去掉近似共线的顶点（建筑轮廓常见的冗余节点）
export function dropCollinear(ring, tolDeg = 4) {
  if (ring.length <= 3) return ring;
  const out = [];
  const n = ring.length;
  const cosT = Math.cos((tolDeg * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const ux = b[0] - a[0];
    const uz = b[1] - a[1];
    const vx = c[0] - b[0];
    const vz = c[1] - b[1];
    const lu = Math.hypot(ux, uz);
    const lv = Math.hypot(vx, vz);
    if (lu < 1e-6 || lv < 1e-6) continue;
    if ((ux * vx + uz * vz) / (lu * lv) > cosT) continue;
    out.push(b);
  }
  return out.length >= 3 ? out : ring;
}

// 把若干折线按端点拼接成闭合环（用于多边形关系）；返回 [{pts, closed}]
export function assembleRings(lines) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const pool = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  const rings = [];
  while (pool.length) {
    let cur = pool.pop();
    let guard = 0;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 10000) {
      const endK = key(cur[cur.length - 1]);
      const startK = key(cur[0]);
      let found = -1;
      let rev = false;
      let atStart = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        if (key(l[0]) === endK) { found = i; break; }
        if (key(l[l.length - 1]) === endK) { found = i; rev = true; break; }
        if (key(l[l.length - 1]) === startK) { found = i; atStart = true; break; }
        if (key(l[0]) === startK) { found = i; atStart = true; rev = true; break; }
      }
      if (found < 0) break;
      let l = pool.splice(found, 1)[0];
      if (rev) l = l.slice().reverse();
      if (atStart) cur = [...l.slice(0, -1), ...cur];
      else cur = [...cur, ...l.slice(1)];
    }
    const closed = key(cur[0]) === key(cur[cur.length - 1]);
    rings.push({ pts: cur, closed });
  }
  return rings;
}

// 最小面积外接矩形（旋转卡壳的简化版：枚举每条边方向）
export function minRect(ring) {
  let best = null;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.5) continue;
    const ux = (b[0] - a[0]) / L;
    const uz = (b[1] - a[1]) / L;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of ring) {
      const u = p[0] * ux + p[1] * uz;
      const v = -p[0] * uz + p[1] * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { ux, uz, u0, u1, v0, v1 } = best;
  const cu = (u0 + u1) / 2;
  const cv = (v0 + v1) / 2;
  return {
    cx: cu * ux - cv * uz,
    cz: cu * uz + cv * ux,
    w: u1 - u0,
    d: v1 - v0,
    ux,
    uz,
    area: best.A,
  };
}

// ---------- 栅格 ----------
export class Grid {
  constructor(x0, z0, cs, nx, nz, Type = Uint8Array) {
    Object.assign(this, { x0, z0, cs, nx, nz });
    this.data = new Type(nx * nz);
  }
  idx(x, z) {
    const i = Math.floor((x - this.x0) / this.cs);
    const j = Math.floor((z - this.z0) / this.cs);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }
  get(x, z) {
    const k = this.idx(x, z);
    return k < 0 ? 0 : this.data[k];
  }
  // 扫描线填充（多环，奇偶规则），cell 中心采样
  fillRings(rings, value, mode = 'set') {
    let zMin = Infinity;
    let zMax = -Infinity;
    for (const r of rings) for (const p of r) {
      if (p[1] < zMin) zMin = p[1];
      if (p[1] > zMax) zMax = p[1];
    }
    const j0 = Math.max(0, Math.floor((zMin - this.z0) / this.cs));
    const j1 = Math.min(this.nz - 1, Math.ceil((zMax - this.z0) / this.cs));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.cs;
      xs.length = 0;
      for (const r of rings) {
        for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
          const za = r[a][1];
          const zb = r[b][1];
          if (za > z !== zb > z) xs.push(r[a][0] + ((z - za) / (zb - za)) * (r[b][0] - r[a][0]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) / this.cs - 0.5));
        const i1 = Math.min(this.nx - 1, Math.floor((xs[k + 1] - this.x0) / this.cs - 0.5));
        const row = j * this.nx;
        for (let i = i0; i <= i1; i++) {
          if (mode === 'max') this.data[row + i] = Math.max(this.data[row + i], value);
          else if (mode === 'or') this.data[row + i] |= value;
          else this.data[row + i] = value;
        }
      }
    }
  }
  // 粗线段（圆头），用于道路占地
  strokeLine(a, b, hw, value, mode = 'set') {
    const x0 = Math.min(a[0], b[0]) - hw;
    const x1 = Math.max(a[0], b[0]) + hw;
    const z0 = Math.min(a[1], b[1]) - hw;
    const z1 = Math.max(a[1], b[1]) + hw;
    const i0 = Math.max(0, Math.floor((x0 - this.x0) / this.cs));
    const i1 = Math.min(this.nx - 1, Math.floor((x1 - this.x0) / this.cs));
    const j0 = Math.max(0, Math.floor((z0 - this.z0) / this.cs));
    const j1 = Math.min(this.nz - 1, Math.floor((z1 - this.z0) / this.cs));
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * this.cs;
      for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * this.cs;
        if (segDist(x, z, a[0], a[1], b[0], b[1]) <= hw) {
          const k = j * this.nx + i;
          if (mode === 'or') this.data[k] |= value;
          else this.data[k] = value;
        }
      }
    }
  }
}

// 精确欧氏距离变换（Felzenszwalb & Huttenlocher），输入 f：0 表示特征点，Infinity 表示其它；原地返回平方距离
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}
export function edt(mask, nx, nz, featureValue) {
  const INF = 1e20;
  const g = new Float64Array(nx * nz);
  for (let k = 0; k < g.length; k++) g[k] = mask[k] === featureValue ? 0 : INF;
  const n = Math.max(nx, nz);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) f[j] = g[j * nx + i];
    edt1d(f, nz, d, v, z);
    for (let j = 0; j < nz; j++) g[j * nx + i] = d[j];
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) f[i] = g[j * nx + i];
    edt1d(f, nx, d, v, z);
    for (let i = 0; i < nx; i++) g[j * nx + i] = d[i];
  }
  return g;
}
// 有符号距离（米）：陆地为正、水为负
export function signedDistance(water, nx, nz, cs) {
  const toWater = edt(water, nx, nz, 1);
  const toLand = edt(water, nx, nz, 0);
  const out = new Float32Array(nx * nz);
  for (let k = 0; k < out.length; k++) out[k] = water[k] ? -(Math.sqrt(toLand[k]) - 0.5) * cs : (Math.sqrt(toWater[k]) - 0.5) * cs;
  return out;
}
// 4 邻域连通分量，返回 {labels, sizes}
export function components(mask, nx, nz, value = 1) {
  const labels = new Int32Array(nx * nz).fill(-1);
  const sizes = [];
  const stack = new Int32Array(nx * nz);
  for (let s = 0; s < mask.length; s++) {
    if (mask[s] !== value || labels[s] >= 0) continue;
    const id = sizes.length;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = id;
    let cnt = 0;
    while (sp) {
      const k = stack[--sp];
      cnt++;
      const i = k % nx;
      const j = (k - i) / nx;
      const nb = [i > 0 ? k - 1 : -1, i < nx - 1 ? k + 1 : -1, j > 0 ? k - nx : -1, j < nz - 1 ? k + nx : -1];
      for (const q of nb) {
        if (q >= 0 && mask[q] === value && labels[q] < 0) {
          labels[q] = id;
          stack[sp++] = q;
        }
      }
    }
    sizes.push(cnt);
  }
  return { labels, sizes };
}

// ---------- PNG（调试图）----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = rgb[y * w * 3 + x];
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(file, png);
}
