// 城市数据格式：构建脚本（tools/build-city.mjs）与运行端（src/world/*）共用的记录字段与量化方式。
// 每类记录在运行端都是定长的 Float32 数组（N 个字段一条）；下载时按字段分组量化成更小的整数类型，
// 加载后再还原成同样的布局，因此运行端代码只需按下面的字段名取值。

// v2 adds UTF-8 renderIdentity and a lazy evidence sidecar; the geometry layout stays v1.
export const CITY_FORMAT_VERSION = 2;
export const RENDER_SCHEMA_VERSION = 1;

// 真实建筑（bldMeta，每栋 24 个字段）
export const BLD = {
  N: 24,
  RING0: 0, NRINGS: 1, BASE: 2, TOP: 3, STYLE: 4, FLOOR_H: 5, CELL_W: 6, LIT: 7, P1: 8, P2: 9, LED: 10,
  COL_A: 11, COL_B: 12, SEED: 13, ROOF: 14, FLAGS: 15,
  // 最小外接矩形：中心、长宽、长边方向
  CX: 16, CZ: 17, W: 18, D: 19, UX: 20, UZ: 21, AREA: 22, ZONE: 23,
};

// 补全地块（fill，每块 19 个字段；Y 为地面高度）；FLAGS & 64 表示骑楼，临街面在 −v 侧
export const FILL = {
  N: 19,
  X: 0, Z: 1, UX: 2, UZ: 3, W: 4, D: 5, H: 6, STYLE: 7, COL_A: 8, COL_B: 9,
  FLOOR_H: 10, CELL_W: 11, LIT: 12, P1: 13, P2: 14, LED: 15, ROOF: 16, FLAGS: 17, Y: 18,
};

// 道路（roadMeta，每条 8 个字段；roadPts 每点 x, z, 高度, 路口让出距离）
export const ROAD = { N: 8, P0: 0, NPTS: 1, W: 2, CLS: 3, LANES: 4, FLAGS: 5, NAME: 6, LAYER: 7 };

// 铁路 / 轨道交通：railMeta 每股道 4 个字段（railPts 每点 x, y, z）；trainMeta 为列车行驶的连续线路
export const RAIL = { N: 4, P0: 0, NPTS: 1, KIND: 2, BRIDGE: 3 };
export const CHAIN = { N: 3, P0: 0, NPTS: 1, KIND: 2 };

// 树木（trees0–4，每棵 6 个字段：位置、朝向、缩放、色调随机数、地面高度）
export const TREE_REC = { N: 6, X: 0, Z: 1, ROT: 2, S: 3, T: 4, Y: 5 };

// 路灯（每盏 6 个字段；KIND：0 街道 / 1 滨江 / 2 高架与桥）与灯光投影（每个 5 个字段）
export const LAMP = { N: 6, X: 0, Y: 1, Z: 2, ROT: 3, H: 4, KIND: 5 };
export const POOL = { N: 5, X: 0, Y: 1, Z: 2, R: 3, KIND: 4 };

// 量化方式：[存储类型, 字段, 缩放, 是否为角度]，存储值 = round(原值 × 缩放)；角度先归一到 [0, 2π)。
// 坐标用 Int16 × 2（0.5 m 精度，覆盖 ±16 km）；补全地块的中心保留 Float32（其随机种子由坐标决定）。
const TAU = Math.PI * 2;
export const QUANT = {
  fill: [
    ['Float32Array', [FILL.X, FILL.Z], 1],
    ['Int16Array', [FILL.UX, FILL.UZ], 32767],
    ['Uint16Array', [FILL.W, FILL.D, FILL.H], 50],
    ['Uint16Array', [FILL.Y], 10],
    ['Uint32Array', [FILL.COL_A, FILL.COL_B], 1],
    ['Uint8Array', [FILL.FLOOR_H, FILL.CELL_W], 20],
    ['Uint8Array', [FILL.LIT, FILL.P2], 255],
    ['Uint8Array', [FILL.STYLE, FILL.P1, FILL.LED, FILL.ROOF, FILL.FLAGS], 1],
  ],
  tree: [
    ['Int16Array', [TREE_REC.X, TREE_REC.Z], 2],
    ['Uint8Array', [TREE_REC.ROT], 255 / TAU, true],
    ['Uint8Array', [TREE_REC.S], 100],
    ['Uint8Array', [TREE_REC.T], 255],
    ['Uint16Array', [TREE_REC.Y], 10],
  ],
  lamp: [
    ['Int16Array', [LAMP.X, LAMP.Z], 2],
    ['Uint16Array', [LAMP.Y], 100],
    ['Uint8Array', [LAMP.ROT], 255 / TAU, true],
    ['Uint8Array', [LAMP.H], 10],
    ['Uint8Array', [LAMP.KIND], 1],
  ],
  pool: [
    ['Int16Array', [POOL.X, POOL.Z], 2],
    ['Uint16Array', [POOL.Y], 100],
    ['Uint8Array', [POOL.R], 10],
    ['Uint8Array', [POOL.KIND], 1],
  ],
};

const RANGE = {
  Int16Array: [-32768, 32767],
  Uint16Array: [0, 65535],
  Uint8Array: [0, 255],
  Uint32Array: [0, 4294967295],
};

// 定长记录 → 按分组量化的若干类型化数组
export function packRecords(arr, N, spec) {
  const n = arr.length / N;
  return spec.map(([type, fields, scale, angle]) => {
    const out = new globalThis[type](n * fields.length);
    const [lo, hi] = RANGE[type] || [-Infinity, Infinity];
    for (let i = 0; i < n; i++) {
      fields.forEach((f, k) => {
        let v = arr[i * N + f];
        if (angle) v = ((v % TAU) + TAU) % TAU;
        out[i * fields.length + k] = type === 'Float32Array' ? v : Math.min(hi, Math.max(lo, Math.round(v * scale)));
      });
    }
    return out;
  });
}

// 分组的类型化数组 → 定长 Float32 记录
export function unpackRecords(groups, N, spec) {
  const n = groups[0].length / spec[0][1].length;
  const out = new Float32Array(n * N);
  spec.forEach(([, fields, scale], g) => {
    const src = groups[g];
    const m = fields.length;
    const inv = 1 / scale;
    for (let i = 0; i < n; i++) for (let k = 0; k < m; k++) out[i * N + fields[k]] = src[i * m + k] * inv;
  });
  return out;
}
