// 可复现的随机数、哈希与噪声工具。所有程序化生成都从这里取随机性，保证同一 Seed 生成同一座城市。

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
// 多项式平滑最小值：让河道交汇处的岸线圆润过渡
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export function hash32(a, b = 0, c = 0, d = 0) {
  let h = 0x9e3779b9 ^ Math.imul(a | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ Math.imul(b | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 13), 0x85ebca77) ^ Math.imul(d | 0, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export const rand01 = (a, b = 0, c = 0, d = 0) => hash32(a, b, c, d) / 4294967296;

export function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed) {
    this.s = seed >>> 0 || 0x2545f491;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a = 0, b = 1) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
  pickW(arr, w) {
    let s = 0;
    for (let i = 0; i < w.length; i++) s += w[i];
    let r = this.next() * s;
    for (let i = 0; i < arr.length; i++) {
      r -= w[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  }
  gauss() {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
  }
  fork(key) {
    return new RNG(hash32(this.s, typeof key === 'number' ? key : strHash(String(key))));
  }
}

export function rngFor(seed, ...keys) {
  let h = seed >>> 0;
  for (const k of keys) h = hash32(h, typeof k === 'number' ? k | 0 : strHash(String(k)), 0x51ed);
  return new RNG(h);
}

function vhash(ix, iz, seed) {
  return (hash32(ix, iz, seed) / 4294967296) * 2 - 1;
}

// 平滑值噪声，返回 [-1, 1]
export function noise2(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = vhash(ix, iz, seed);
  const b = vhash(ix + 1, iz, seed);
  const c = vhash(ix, iz + 1, seed);
  const d = vhash(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

export function fbm2(x, z, seed = 0, oct = 3) {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * noise2(x * f, z * f, seed + i * 131);
    n += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

// 颜色工具：'#rrggbb' → [r,g,b]（sRGB 0..1），生成时统一转成线性空间写入实例属性
export function hex(h) {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function lin(h) {
  const c = hex(h);
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}
export function mixCol(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
export function scaleCol(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
