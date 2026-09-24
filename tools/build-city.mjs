// 离线构建：把 OpenStreetMap 原始数据（data/raw/*.json，© OpenStreetMap contributors, ODbL）
// 转换成浏览器端直接加载的紧凑城市数据：data/guangzhou.json（元数据）、guangzhou.bin（首屏所需）、
// guangzhou-veg.bin（树木 / 路灯 / 灯光投影，首屏之后加载）；两个数据文件以 .gz 形式写出。
//
//   node tools/build-city.mjs [--debug] [--out <目录>]
//
// 输出内容：
//   · 水域有符号距离场（内圈 6 m / 外圈 24 m 两级网格；R = 全部水域，G = 珠江主航道）
//   · 道路（真实走向、等级、车道数、单行、桥梁 / 高架纵断面、路口清除距离）
//   · 建筑（真实轮廓、高度 / 层数推断、立面风格、骑楼临街面、屋顶类型）
//   · 地块铺装（公园、草地、林地、广场、停车场、运动场……）三角化结果
//   · 行道树、公园林木、滨江树阵、路灯与灯光投影
//   · 跨江大桥、地标、标注

import fs from 'node:fs';
import zlib from 'node:zlib';
import * as THREE from '../vendor/three/build/three.module.js';
import * as SCHEMA from '../src/world/schema.js';
import { buildTerrain } from './terrain.mjs';
import { buildRails } from './rail.mjs';
import {
  proj, LON0, LAT0, KX, KZ, hash32, rand01, RNG, area, centroid, bbox, pointInRing, segDist, cleanRing, simplify,
  dropCollinear, assembleRings, minRect, Grid, signedDistance, components, writePNG,
} from './lib.mjs';

const DEBUG = process.argv.includes('--debug');
const RAW = 'data/raw/';
// --out <目录>：输出位置（默认 data/，测试时写到临时目录）
const OUT_DIR = (() => {
  const i = process.argv.indexOf('--out');
  return i > 0 ? process.argv[i + 1].replace(/\/?$/, '/') : 'data/';
})();
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const load = (f) => JSON.parse(fs.readFileSync(RAW + f, 'utf8'));
const P = (p) => proj(p[0], p[1]);
const LL = (lon, lat) => proj(lon, lat);

// 城市精细区域（与抓取范围一致）
const CITY = (() => {
  const [x0, z1] = proj(113.212, 23.085);
  const [x1, z0] = proj(113.38, 23.152);
  return { x0, x1, z0, z1 };
})();
const inCity = (x, z, m = 0) => x > CITY.x0 - m && x < CITY.x1 + m && z > CITY.z0 - m && z < CITY.z1 + m;

// ====================================================================================
// 1. 水域
// ====================================================================================
const waterRaw = load('water.json').els;
function polysOf(e) {
  // 返回 [{outer:[ring], holes:[ring...]}]（投影后）
  if (e.k === 'w') {
    const g = e.g.map(P);
    if (g.length < 4) return [];
    const r = cleanRing(g);
    const a = e.g[0];
    const b = e.g[e.g.length - 1];
    if (Math.abs(a[0] - b[0]) > 1e-7 || Math.abs(a[1] - b[1]) > 1e-7) return [];
    return r.length >= 3 ? [{ outer: r, holes: [] }] : [];
  }
  if (e.k === 'r' && e.m) {
    const outs = assembleRings(e.m.filter((m) => m.r !== 'inner').map((m) => m.g));
    const ins = assembleRings(e.m.filter((m) => m.r === 'inner').map((m) => m.g));
    const holes = ins.filter((r) => r.closed).map((r) => cleanRing(r.pts.map(P)));
    // 被抓取范围裁断的外环：直接闭合（断口在远离城市的范围边缘）
    return outs
      .filter((r) => r.pts.length >= 3)
      .map((r) => {
        const outer = cleanRing(r.pts.map(P));
        const ob = bbox(outer);
        return { outer, holes: holes.filter((h) => { const c = h[0]; return c[0] > ob[0] && c[0] < ob[2] && c[1] > ob[1] && c[1] < ob[3]; }) };
      });
  }
  return [];
}
const waterPolys = [];
for (const e of waterRaw) {
  const t = e.t;
  if (t.natural !== 'water' && t.waterway !== 'riverbank') continue;
  if (t.water === 'wastewater' || t.water === 'basin' || t.intermittent === 'yes') continue;
  if (t.layer && +t.layer < 0) continue;
  if (t.tunnel || t.covered === 'yes') continue;
  for (const p of polysOf(e)) waterPolys.push({ ...p, big: t.water === 'river' || t.waterway === 'riverbank', name: t.name || '' });
}
log('water polygons', waterPolys.length);

function waterGrid(x0, z0, x1, z1, cs) {
  const nx = Math.ceil((x1 - x0) / cs);
  const nz = Math.ceil((z1 - z0) / cs);
  const g = new Grid(x0, z0, cs, nx, nz);
  // 外环填 1，洞填 0（按多边形逐个处理，保证嵌套岛屿正确）
  for (const w of waterPolys) {
    const b = bbox(w.outer);
    if (b[2] < x0 || b[0] > x1 || b[3] < z0 || b[1] > z1) continue;
    g.fillRings([w.outer, ...w.holes], 1, 'set');
  }
  // 洞（江心岛）二次确认：外环覆盖后，岛屿的洞在 fillRings 奇偶规则中已经留空
  return g;
}
function mainMask(g, minArea) {
  const { labels, sizes } = components(g.data, g.nx, g.nz, 1);
  const minCells = minArea / (g.cs * g.cs);
  const main = new Uint8Array(g.data.length);
  for (let k = 0; k < main.length; k++) if (labels[k] >= 0 && sizes[labels[k]] >= minCells) main[k] = 1;
  return main;
}
const quant = (d) => Math.max(0, Math.min(255, Math.round(128 + d * 1.5)));
function sdfTexture(g, main) {
  const sAll = signedDistance(g.data, g.nx, g.nz, g.cs);
  const sMain = signedDistance(main, g.nx, g.nz, g.cs);
  const tex = new Uint8Array(g.nx * g.nz * 2);
  for (let k = 0; k < g.nx * g.nz; k++) {
    tex[k * 2] = quant(sAll[k]);
    tex[k * 2 + 1] = quant(sMain[k]);
  }
  return { tex, sAll, sMain };
}
// 内圈（城市范围外扩 1.2 km）6 m；外圈（整个抓取范围）24 m
const IN = { x0: CITY.x0 - 1200, z0: CITY.z0 - 1200, x1: CITY.x1 + 1200, z1: CITY.z1 + 1200, cs: 6 };
const OUT = (() => {
  const [x0, z1] = proj(113.145, 23.025);
  const [x1, z0] = proj(113.455, 23.205);
  return { x0, z0, x1, z1, cs: 24 };
})();
const gIn = waterGrid(IN.x0, IN.z0, IN.x1, IN.z1, IN.cs);
const gOut = waterGrid(OUT.x0, OUT.z0, OUT.x1, OUT.z1, OUT.cs);
const mIn = mainMask(gIn, 250000);
const mOut = mainMask(gOut, 600000);
const sdIn = sdfTexture(gIn, mIn);
const sdOut = sdfTexture(gOut, mOut);
log('sdf', gIn.nx, gIn.nz, gOut.nx, gOut.nz);

function sampleSd(field, g, x, z) {
  let fx = (x - g.x0) / g.cs - 0.5;
  let fz = (z - g.z0) / g.cs - 0.5;
  fx = Math.max(0, Math.min(g.nx - 1.001, fx));
  fz = Math.max(0, Math.min(g.nz - 1.001, fz));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const tx = fx - i;
  const tz = fz - j;
  const k = j * g.nx + i;
  return (field[k] * (1 - tx) + field[k + 1] * tx) * (1 - tz) + (field[k + g.nx] * (1 - tx) + field[k + g.nx + 1] * tx) * tz;
}
const inIn = (x, z) => x > IN.x0 + 12 && x < IN.x1 - 12 && z > IN.z0 + 12 && z < IN.z1 - 12;
const sdAll = (x, z) => (inIn(x, z) ? sampleSd(sdIn.sAll, gIn, x, z) : sampleSd(sdOut.sAll, gOut, x, z));
const sdMain = (x, z) => (inIn(x, z) ? sampleSd(sdIn.sMain, gIn, x, z) : sampleSd(sdOut.sMain, gOut, x, z));

// ====================================================================================
// 2. 道路
// ====================================================================================
const RC = { ARTERIAL: 0, SECONDARY: 1, STREET: 2, LANE: 3, ONEWAY: 6, EXPRESS: 7 };
const roadsRaw = load('roads.json').els;
const names = [];
const nameIdx = new Map();
const nameId = (n) => {
  if (!n) return -1;
  if (!nameIdx.has(n)) {
    nameIdx.set(n, names.length);
    names.push(n);
  }
  return nameIdx.get(n);
};
const QILOU_STREETS = new Set(
  ('上九路 下九路 第十甫路 恩宁路 龙津西路 龙津中路 龙津东路 人民中路 人民南路 大德路 大南路 文明路 东华东路 东华西路 东华南路 北京路 ' +
    '海珠中路 海珠南路 起义路 德政中路 德政南路 中山四路 中山五路 中山六路 中山七路 大新路 一德路 泰康路 万福路 珠光路 长堤大马路 八旗二马路 ' +
    '南华西路 南华中路 南华东路 同福西路 同福中路 同福东路 洪德路 豪贤路 文德路 解放中路 解放南路 光复中路 光复南路 长寿路 长寿东路 宝华路 多宝路 ' +
    '带河路 杉木栏路 和平中路 和平东路 丛桂路 西华路 六二三路 惠福东路 惠福西路 越秀南路 越秀中路 大马站 盐运西 北京南路').split(' '),
);
const HW = {
  motorway: { cls: RC.EXPRESS, lanes: 3, w1: 3.6 },
  trunk: { cls: RC.ARTERIAL, lanes: 3, w1: 3.5 },
  primary: { cls: RC.ARTERIAL, lanes: 3, w1: 3.4 },
  secondary: { cls: RC.SECONDARY, lanes: 2, w1: 3.3 },
  tertiary: { cls: RC.SECONDARY, lanes: 1, w1: 3.3 },
  unclassified: { cls: RC.STREET, lanes: 1, w1: 3.1 },
  residential: { cls: RC.STREET, lanes: 1, w1: 3.0 },
  living_street: { cls: RC.LANE, lanes: 1, w1: 2.6 },
  pedestrian: { cls: RC.LANE, lanes: 1, w1: 3.0 },
  service: { cls: RC.LANE, lanes: 1, w1: 2.6 },
};
const roads = [];
for (const e of roadsRaw) {
  const t = e.t;
  let hw = t.highway;
  const link = /_link$/.test(hw);
  hw = hw.replace(/_link$/, '');
  const spec = HW[hw];
  if (!spec) continue;
  if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') continue;
  if (t.covered === 'yes') continue;
  if (t.area === 'yes') continue;
  if (t.access === 'no' && hw === 'service') continue;
  if (hw === 'service' && /parking_aisle|driveway|drive-through|emergency_access/.test(t.service || '')) continue;
  let pts = cleanRing(e.g.map(P), false);
  if (pts.length < 2) continue;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (hw === 'service' && len < 45) continue;
  // 只保留与城市范围相交的道路
  if (!pts.some((p) => inCity(p[0], p[1], 400))) continue;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || t.junction === 'roundabout' || hw === 'motorway';
  if (t.oneway === '-1') {
    pts = pts.reverse();
    e.g = e.g.slice().reverse();
  }
  let lanes = parseInt(t.lanes, 10);
  if (!(lanes > 0)) lanes = oneway ? (link ? 1 : spec.lanes) : spec.lanes * 2;
  if (link) lanes = Math.min(lanes, oneway ? 2 : 2);
  lanes = Math.min(lanes, 10);
  let cls = spec.cls;
  if (oneway && cls !== RC.LANE) cls = hw === 'motorway' || hw === 'trunk' ? RC.EXPRESS : RC.ONEWAY;
  const lanesPer = oneway ? lanes : Math.max(1, Math.round(lanes / 2));
  let w = parseFloat(t.width);
  if (!(w > 2)) w = lanes * spec.w1 + (oneway ? 1.2 : 1.0);
  if (!oneway && (hw === 'trunk' || hw === 'primary') && lanes >= 4) {
    w += 3.2; // 中央分隔带
    cls = RC.ARTERIAL;
  } else if (!oneway && cls === RC.ARTERIAL) cls = RC.SECONDARY;
  if (!oneway && cls === RC.SECONDARY && lanes <= 2) cls = RC.STREET;
  if (hw === 'pedestrian') w = Math.max(w, 7);
  const bridge = t.bridge && t.bridge !== 'no';
  const layer = parseInt(t.layer, 10) || 0;
  const nm = t.name || '';
  roads.push({
    id: e.id,
    hw,
    link,
    cls,
    w: Math.min(w, 46),
    lanesPer,
    oneway,
    bridge: bridge && (layer >= 1 || len > 60),
    layer,
    name: nm,
    bname: t['bridge:name'] || (bridge && /桥/.test(nm) ? nm : ''),
    raw: e.g,
    pts,
    len,
    qilou: QILOU_STREETS.has(nm),
    pedestrian: hw === 'pedestrian' || hw === 'living_street',
  });
}
log('roads', roads.length);

// 节点连接关系（按原始经纬度点匹配）
const nodeKey = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const nodes = new Map();
roads.forEach((r, ri) => {
  r.raw.forEach((p, pi) => {
    const k = nodeKey(p);
    let a = nodes.get(k);
    if (!a) nodes.set(k, (a = []));
    a.push([ri, pi]);
  });
});
// 与原始点一一对应的投影点（未简化）
for (const r of roads) r.full = r.raw.map(P);

// ---- 跨江桥：逐段检测跨越珠江主航道的区段，按位置聚类成桥 ----
const DECK = { 海珠桥: 9, 人民桥: 11, 解放大桥: 11, 江湾大桥: 12, 海印大桥: 15, 广州大桥: 12, 广州大桥新桥: 12, 猎德大桥: 13, 华南大桥: 16, 琶洲大桥: 16, 鹤洞大桥: 22, 珠江大桥东桥: 10, 珠江大桥西桥: 10 };
const crossings = [];
roads.forEach((r, ri) => {
  r.river = false;
  if (!r.bridge) return;
  const f = r.full;
  let run = null;
  const finish = () => {
    if (run && Math.hypot(run.p1[0] - run.p0[0], run.p1[1] - run.p0[1]) >= 60) crossings.push({ ri, ...run });
    run = null;
  };
  for (let i = 0; i < f.length - 1; i++) {
    const a = f[i];
    const b = f[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n;
      const z = a[1] + ((b[1] - a[1]) * k) / n;
      if (sdMain(x, z) < 0) {
        if (!run) run = { p0: [x, z], p1: [x, z] };
        else run.p1 = [x, z];
      } else finish();
    }
  }
  finish();
});
const clusters = [];
for (const c of crossings) {
  const m = [(c.p0[0] + c.p1[0]) / 2, (c.p0[1] + c.p1[1]) / 2];
  const L = Math.hypot(c.p1[0] - c.p0[0], c.p1[1] - c.p0[1]);
  const d = [(c.p1[0] - c.p0[0]) / L, (c.p1[1] - c.p0[1]) / L];
  let cl = clusters.find((k) => Math.hypot(k.m[0] - m[0], k.m[1] - m[1]) < 130 && Math.abs(k.d[0] * d[0] + k.d[1] * d[1]) > 0.85);
  if (!cl) clusters.push((cl = { m, d, items: [] }));
  cl.items.push({ ...c, m, L });
}
const bridges = [];
for (const cl of clusters) {
  const cnt = new Map();
  for (const it of cl.items) {
    const r = roads[it.ri];
    const nm = r.bname || (/桥/.test(r.name) ? r.name : '');
    if (nm) cnt.set(nm, (cnt.get(nm) || 0) + 1);
  }
  const name = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] || '';
  // 统一方向，求跨度与横向范围
  const d = cl.items[0].p1[0] - cl.items[0].p0[0] >= 0 || true ? cl.d : cl.d;
  let cx = 0;
  let cz = 0;
  for (const it of cl.items) {
    cx += it.m[0];
    cz += it.m[1];
  }
  cx /= cl.items.length;
  cz /= cl.items.length;
  let s0 = Infinity;
  let s1 = -Infinity;
  let l0 = Infinity;
  let l1 = -Infinity;
  for (const it of cl.items) {
    const r = roads[it.ri];
    for (const p of [it.p0, it.p1]) {
      const s = (p[0] - cx) * d[0] + (p[1] - cz) * d[1];
      s0 = Math.min(s0, s);
      s1 = Math.max(s1, s);
    }
    const lat = -(it.m[0] - cx) * d[1] + (it.m[1] - cz) * d[0];
    l0 = Math.min(l0, lat - r.w / 2);
    l1 = Math.max(l1, lat + r.w / 2);
  }
  const lc = (l0 + l1) / 2;
  const ox = -d[1] * lc;
  const oz = d[0] * lc;
  const deckH = DECK[name] ?? 12;
  for (const it of cl.items) {
    const r = roads[it.ri];
    r.river = true;
    r.Ht = deckH;
  }
  bridges.push({ name, a: [cx + d[0] * (s0 - 14) + ox, cz + d[1] * (s0 - 14) + oz], b: [cx + d[0] * (s1 + 14) + ox, cz + d[1] * (s1 + 14) + oz], w: l1 - l0, deckH, span: s1 - s0 });
}
for (const r of roads) {
  if (!r.bridge || r.river) continue;
  r.Ht = Math.max(1, r.layer) * 6.6;
  if (r.layer <= 0 && r.len < 90) r.bridge = false; // 跨涌小桥：按地面道路处理
}
// 节点高度：与地面道路相连为 0；桥与桥相连取平均
const nodeH = new Map();
for (const [k, list] of nodes) {
  let ground = false;
  let hs = 0;
  let hn = 0;
  for (const [ri] of list) {
    const r = roads[ri];
    if (!r.bridge) ground = true;
    else {
      hs += r.Ht;
      hn++;
    }
  }
  if (hn) nodeH.set(k, ground ? 0 : hs / hn);
}
for (const r of roads) {
  const n = r.full.length;
  r.ys = new Float32Array(n);
  if (!r.bridge) continue;
  const s = [0];
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(r.full[i][0] - r.full[i - 1][0], r.full[i][1] - r.full[i - 1][1]));
  const L = s[n - 1];
  const h0 = nodeH.get(nodeKey(r.raw[0])) ?? r.Ht;
  const h1 = nodeH.get(nodeKey(r.raw[n - 1])) ?? r.Ht;
  const R = Math.max(40, Math.min(r.river ? 220 : 170, (r.Ht / 0.05)));
  const sm = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  for (let i = 0; i < n; i++) {
    const w0 = 1 - sm(0, Math.min(R, L * 0.5), s[i]);
    const w1 = 1 - sm(0, Math.min(R, L * 0.5), L - s[i]);
    let y = r.Ht + (h0 - r.Ht) * w0 + (h1 - r.Ht) * w1;
    // 中间的桥墩连接点（桥与桥相连）保持连续
    r.ys[i] = Math.max(0, y);
  }
}

// ---- 路口清除距离：该点被其它道路共享时，标线在路口范围内断开 ----
for (const r of roads) {
  r.clear = new Float32Array(r.full.length);
  r.raw.forEach((p, pi) => {
    const list = nodes.get(nodeKey(p));
    if (!list || list.length < 2) return;
    let c = 0;
    for (const [ri2] of list) {
      if (ri2 === roads.indexOf(r)) continue;
      const o = roads[ri2];
      if (o.bridge !== r.bridge) continue;
      c = Math.max(c, o.w * 0.5 + 1.2);
    }
    r.clear[pi] = c;
  });
}

// ---- 简化（保留路口与高度变化点）----
for (const r of roads) {
  const keepIdx = new Set([0, r.full.length - 1]);
  r.raw.forEach((p, pi) => {
    if (r.clear[pi] > 0) keepIdx.add(pi);
  });
  const pts = r.full.map((p, i) => [p[0], p[1], i]);
  const simp = simplify(pts, r.bridge ? 0.4 : 0.8, false);
  for (const p of simp) keepIdx.add(p[2]);
  const idx = [...keepIdx].sort((a, b) => a - b);
  r.out = idx.map((i) => [r.full[i][0], r.full[i][1], r.ys[i], r.clear[i]]);
}

// ====================================================================================
// 3. 分区（参考广州实际行政与功能片区的近似范围）
// ====================================================================================
const Z = (lon0, lat0, lon1, lat1) => {
  const [x0, z1] = proj(lon0, lat0);
  const [x1, z0] = proj(lon1, lat1);
  return [x0, z0, x1, z1];
};
const ZONES = [
  ['shamian', Z(113.2355, 23.1068, 113.2478, 23.1118)],
  ['ersha', Z(113.2885, 23.1068, 113.3112, 23.1168)],
  ['cbd', Z(113.3085, 23.1135, 113.3395, 23.1368)],
  ['tianhe', Z(113.3040, 23.1368, 113.3480, 23.1560)],
  ['pazhou', Z(113.3280, 23.0860, 113.3900, 23.1115)],
  ['xiguan', Z(113.2270, 23.1110, 113.2625, 23.1430)],
  ['yuexiu', Z(113.2625, 23.1120, 113.2960, 23.1430)],
  ['haizhuold', Z(113.2480, 23.0930, 113.2950, 23.1105)],
  ['fangcun', Z(113.2050, 23.0800, 113.2420, 23.1060)],
];
function zoneAt(x, z) {
  for (const [id, b] of ZONES) if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) return id;
  return 'res';
}
const OLD = new Set(['xiguan', 'yuexiu', 'haizhuold']);
const ZONE_IDS = ['res', ...ZONES.map((z) => z[0])];

// ====================================================================================
// 4. 地块铺装（公园 / 绿地 / 广场 / 停车 / 运动场）
// ====================================================================================
const GK = { GRASS: 0, PLAZA: 1, OLDSTONE: 2, GARDEN: 3, FIELD: 4, DIRT: 6, PARKING: 8, COMPOUND: 9, TRACK: 10, FOREST: 11 };
const landRaw = [...load('landuse.json').els, ...load('relations.json').els.filter((e) => !e.t.building)];
const ground = [];
const parkPolys = [];
const greenPolys = [];
for (const e of landRaw) {
  const t = e.t;
  let kind = -1;
  let pri = 0;
  const lu = t.landuse;
  const le = t.leisure;
  const na = t.natural;
  const am = t.amenity;
  if (le === 'park' || le === 'garden' || le === 'nature_reserve' || le === 'golf_course') { kind = GK.GARDEN; pri = 4; }
  else if (lu === 'grass' || lu === 'village_green' || lu === 'recreation_ground' || lu === 'meadow' || lu === 'cemetery' || na === 'grassland') { kind = GK.GRASS; pri = 5; }
  else if (lu === 'forest' || na === 'wood' || na === 'scrub' || lu === 'orchard' || na === 'wetland') { kind = GK.FOREST; pri = 6; }
  else if (le === 'pitch' || le === 'playground') { kind = GK.FIELD; pri = 8; }
  else if (le === 'track') { kind = GK.TRACK; pri = 9; }
  else if (le === 'stadium' || le === 'sports_centre') { kind = GK.PLAZA; pri = 2; }
  else if (am === 'parking') { kind = GK.PARKING; pri = 3; }
  else if (lu === 'construction' || na === 'sand' || na === 'beach' || lu === 'railway' || lu === 'farmland') { kind = GK.DIRT; pri = 3; }
  else if (lu === 'commercial' || lu === 'retail') { kind = GK.PLAZA; pri = 1; }
  else if (lu === 'residential' || am === 'school' || am === 'university' || am === 'college' || am === 'hospital' || lu === 'education' || lu === 'religious') { kind = GK.COMPOUND; pri = 0; }
  else if (t.place === 'square' || t['area:highway']) { kind = GK.PLAZA; pri = 7; }
  else if (lu === 'industrial') { kind = GK.DIRT; pri = 0; }
  if (kind < 0) continue;
  for (const p of polysOf(e)) {
    const outer = simplify(p.outer, 1.0, true);
    if (outer.length < 3) continue;
    const a = Math.abs(area(outer));
    if (a < 60) continue;
    const c = centroid(outer);
    if (!inCity(c[0], c[1], 600)) continue;
    const poly = { outer, holes: p.holes.map((h) => simplify(h, 1.0, true)).filter((h) => h.length >= 3), kind, pri, area: a, name: t.name || '' };
    ground.push(poly);
    if (kind === GK.GARDEN || kind === GK.GRASS || kind === GK.FOREST) {
      greenPolys.push(poly);
      if (kind === GK.GARDEN) parkPolys.push(poly);
    }
  }
}
log('ground polys', ground.length);

// ====================================================================================
// 5. 建筑
// ====================================================================================
const bldRaw = new Map();
for (const f of ['bld-1.json', 'bld-2.json', 'bld-3.json', 'bld-4.json']) for (const e of load(f).els) bldRaw.set(e.k + e.id, e);
for (const e of load('relations.json').els) if (e.t.building) bldRaw.set('r' + e.id, e);
const num = (v) => {
  if (v === undefined || v === null) return NaN;
  const f = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(f) ? f : NaN;
};

// ---- 专项地标：替换为程序化精细模型的 OSM 要素 ----
const LM = {
  cantonTower: LL(113.31914, 23.10899),
  ifc: LL(113.31786, 23.12032),
  ctf: LL(113.32058, 23.12026),
  citic: LL(113.3195, 23.1444),
  opera: LL(113.31722, 23.11785),
};
const landmarks = [];
const exclusion = []; // {ring} 或 {c, r}：落在其中的 OSM 建筑被移除

function polyFromId(key) {
  const e = bldRaw.get(key);
  if (e) return polysOf(e)[0];
  return null;
}
function landPoly(id) {
  const e = landRaw.find((x) => x.id === id) || load('misc.json').els.find((x) => x.id === id);
  if (!e) return null;
  return polysOf(e)[0] || (e.g && e.g.length > 3 ? { outer: cleanRing(e.g.map(P)), holes: [] } : null);
}
const misc = load('misc.json').els;
{
  // 广州塔
  const c = LM.cantonTower;
  landmarks.push({ kind: 'cantonTower', x: c[0], z: c[1] });
  exclusion.push({ c, r: 75 });
  // 广州大剧院（扎哈·哈迪德“双砾石”）
  const op = polyFromId('r10061850');
  if (op) {
    const mr = minRect(op.outer);
    landmarks.push({ kind: 'opera', x: mr.cx, z: mr.cz, rot: Math.atan2(-mr.uz, mr.ux), w: mr.w, d: mr.d });
    exclusion.push({ ring: op.outer, pad: 4 });
  }
  // 天河体育场
  const st = landRaw.find((x) => x.id === 29162424);
  if (st) {
    const ring = cleanRing(st.g.map(P));
    const mr = minRect(ring);
    landmarks.push({ kind: 'stadium', x: mr.cx, z: mr.cz, rot: Math.atan2(-mr.uz, mr.ux), rx: mr.w / 2, rz: mr.d / 2 });
    exclusion.push({ ring, pad: 2 });
  }
  // 陈家祠
  const ch = misc.find((x) => x.id === 520935699);
  if (ch) {
    const ring = cleanRing(ch.g.map(P));
    const mr = minRect(ring);
    // 正门朝南：取最接近南北向的轴作为进深方向
    let ux = mr.ux;
    let uz = mr.uz;
    let w = mr.w;
    let d = mr.d;
    if (Math.abs(uz) > Math.abs(ux)) {
      [ux, uz] = [-uz, ux];
      [w, d] = [d, w];
    }
    if (ux < 0) {
      ux = -ux;
      uz = -uz;
    }
    landmarks.push({ kind: 'chen', x: mr.cx, z: mr.cz, ux, uz, w, d });
    exclusion.push({ ring, pad: 3 });
  }
  // 六榕花塔 / 琶洲塔
  for (const [key, name, h] of [['w146674383', '六榕花塔', 57], ['w487011306', '琶洲塔', 59]]) {
    const p = polyFromId(key);
    if (!p) continue;
    const c2 = centroid(p.outer);
    landmarks.push({ kind: 'pagoda', x: c2[0], z: c2[1], name, h });
    exclusion.push({ c: c2, r: 16 });
  }
  // 广东电视塔（越秀山）
  {
    const p = polyFromId('w146688566');
    if (p) {
      const c2 = centroid(p.outer);
      landmarks.push({ kind: 'tvTower', x: c2[0], z: c2[1], h: 200 });
      exclusion.push({ c: c2, r: 20 });
    }
  }
  // 周大福金融中心（东塔）：切角方形平面，四段收分 + 冠顶，白色竖向陶板肋
  {
    const p = polyFromId('w511404889');
    if (p) {
      const mr = minRect(p.outer);
      landmarks.push({ kind: 'ctf', x: mr.cx, z: mr.cz, ux: mr.ux, uz: mr.uz, w: Math.min(mr.w, mr.d), h: 530 });
      exclusion.push({ c: [mr.cx, mr.cz], r: Math.max(mr.w, mr.d) * 0.62 });
    }
  }
  // 中山纪念堂：八角重檐攒尖蓝琉璃瓦顶 + 四面抱厦
  {
    const p = polyFromId('w613715001');
    if (p) {
      const mr = minRect(p.outer);
      landmarks.push({ kind: 'memorial', x: mr.cx, z: mr.cz, ux: mr.ux, uz: mr.uz, w: Math.max(mr.w, mr.d) });
      exclusion.push({ ring: p.outer, pad: 2 });
    }
  }
  // 石室圣心大教堂：花岗岩哥特式双尖塔（正立面朝钟楼方向）
  {
    const p = polyFromId('w542890833');
    const t1 = polyFromId('w932452311');
    if (p) {
      const mr = minRect(p.outer);
      const c = centroid(p.outer);
      const tc = t1 ? centroid(t1.outer) : [c[0], c[1] + 30];
      let fx = tc[0] - c[0];
      let fz = tc[1] - c[1];
      const fl = Math.hypot(fx, fz) || 1;
      fx /= fl;
      fz /= fl;
      // 长轴取与正立面方向最接近的矩形轴
      const along = Math.abs(mr.ux * fx + mr.uz * fz) > 0.7;
      const L = along ? mr.w : mr.d;
      const W = along ? mr.d : mr.w;
      landmarks.push({ kind: 'cathedral', x: mr.cx, z: mr.cz, fx, fz, L: Math.max(L, 60), W: Math.max(W, 28) });
      exclusion.push({ c: [mr.cx, mr.cz], r: Math.max(L, W) * 0.62 });
    }
  }
  // 镇海楼（越秀山五层楼）
  {
    const p = polyFromId('w146688561');
    if (p) {
      const mr = minRect(p.outer);
      landmarks.push({ kind: 'zhenhai', x: mr.cx, z: mr.cz, ux: mr.ux, uz: mr.uz, w: mr.w, d: mr.d });
      exclusion.push({ ring: p.outer, pad: 2 });
    }
  }
  // 海心桥（人行拱桥）
  const hx = misc.find((x) => x.id === 1313608038);
  if (hx) {
    const ring = cleanRing(hx.g.map(P));
    const mr = minRect(ring);
    const L = Math.max(mr.w, mr.d);
    const ax = mr.w >= mr.d ? [mr.ux, mr.uz] : [-mr.uz, mr.ux];
    landmarks.push({ kind: 'haixin', a: [mr.cx - ax[0] * L * 0.5, mr.cz - ax[1] * L * 0.5], b: [mr.cx + ax[0] * L * 0.5, mr.cz + ax[1] * L * 0.5], w: Math.min(mr.w, mr.d) });
  }
}
const excluded = (c, ring) => {
  for (const ex of exclusion) {
    if (ex.c && Math.hypot(c[0] - ex.c[0], c[1] - ex.c[1]) < ex.r) return true;
    if (ex.ring && pointInRing(c[0], c[1], ex.ring)) return true;
  }
  void ring;
  return false;
};

// ---- 收集轮廓与构件 ----
const outlines = [];
const parts = [];
for (const [key, e] of bldRaw) {
  const t = e.t;
  if ((parseInt(t.layer, 10) || 0) < 0 && !t.height) continue;
  if (/underground|tunnel/.test(t.location || '')) continue;
  if (t.building === 'train_station' && t.layer && +t.layer < 0) continue;
  if (t.building === 'trn' || t['building:levels:underground'] && !t['building:levels'] && !t.height && (parseInt(t.layer, 10) || 0) < 0) continue;
  for (const p of polysOf(e)) {
    let outer = dropCollinear(simplify(p.outer, 0.35, true));
    if (outer.length < 3) continue;
    const a = area(outer);
    if (Math.abs(a) < 12) continue;
    if (a < 0) outer = outer.reverse(); // 统一为 z 向下坐标系中的正面积（逆时针俯视）
    const c = centroid(outer);
    if (!inCity(c[0], c[1], 150)) continue;
    if (sdAll(c[0], c[1]) < -2) continue;
    const holes = p.holes.map((h) => dropCollinear(simplify(h, 0.35, true))).filter((h) => h.length >= 3 && Math.abs(area(h)) > 20).map((h) => (area(h) > 0 ? h.reverse() : h));
    const rec = { key, t, outer, holes, c, a: Math.abs(a), bb: bbox(outer) };
    if (t['building:part'] && !t.building) parts.push(rec);
    else if (t['building:part']) parts.push(rec);
    else outlines.push(rec);
  }
}
// 含构件的轮廓：构件替代轮廓显示（OSM 简单 3D 建筑规范）
const partGrid = new Map();
const gkey = (x, z) => `${Math.floor(x / 100)},${Math.floor(z / 100)}`;
for (const p of parts) {
  const k = gkey(p.c[0], p.c[1]);
  if (!partGrid.has(k)) partGrid.set(k, []);
  partGrid.get(k).push(p);
}
const hasParts = (o) => {
  const [x0, z0, x1, z1] = o.bb;
  for (let gx = Math.floor(x0 / 100); gx <= Math.floor(x1 / 100); gx++) {
    for (let gz = Math.floor(z0 / 100); gz <= Math.floor(z1 / 100); gz++) {
      for (const p of partGrid.get(`${gx},${gz}`) || []) if (p !== o && pointInRing(p.c[0], p.c[1], o.outer)) return true;
    }
  }
  return false;
};
let bl = [];
for (const o of outlines) if (!hasParts(o)) bl.push(o);
for (const p of parts) bl.push({ ...p, part: true });
bl = bl.filter((b) => !excluded(b.c, b.outer));
log('buildings (outlines + parts)', bl.length, 'parts', parts.length);

// ---- 高度 ----
const OFFICE = /commercial|office|hotel|retail|government|public|civic/;
function tagHeight(b) {
  const t = b.t;
  const lvl = num(t['building:levels']);
  const fh = OFFICE.test(t.building || t['building:part'] || '') ? 3.9 : 3.0;
  let h = num(t.height);
  if (!(h > 0) && lvl > 0) h = lvl * fh + (lvl > 20 ? 4 : 1);
  let base = num(t.min_height);
  const ml = num(t['building:min_level'] ?? t.min_level);
  if (!(base >= 0) && ml > 0) base = ml * fh;
  return { h: h > 0 ? h : NaN, base: base > 0 ? base : 0, lvl };
}
const sizeClass = (a) => (a < 120 ? 0 : a < 400 ? 1 : a < 1500 ? 2 : a < 4000 ? 3 : 4);
const hGrid = new Map();
for (const b of bl) {
  const { h } = tagHeight(b);
  b.th = h;
  if (!(h > 0) || b.part) continue;
  const k = `${Math.floor(b.c[0] / 250)},${Math.floor(b.c[1] / 250)},${sizeClass(b.a)}`;
  if (!hGrid.has(k)) hGrid.set(k, []);
  hGrid.get(k).push(h);
}
// 城中村判定：小体量建筑的密集簇
const dens = new Map();
for (const b of bl) {
  if (b.a > 260) continue;
  const k = `${Math.floor(b.c[0] / 40)},${Math.floor(b.c[1] / 40)}`;
  dens.set(k, (dens.get(k) || 0) + 1);
}
const villageAt = (x, z) => {
  let n = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += dens.get(`${Math.floor(x / 40) + i},${Math.floor(z / 40) + j}`) || 0;
  return n;
};
const DEF_LVL = {
  //        <120 <400 <1500 <4000 >4000
  old: [4, 6, 8, 8, 5],
  cbd: [3, 6, 12, 8, 5],
  tianhe: [4, 8, 16, 8, 5],
  pazhou: [3, 6, 12, 6, 5],
  res: [4, 7, 12, 6, 5],
  shamian: [3, 4, 4, 4, 3],
  ersha: [3, 3, 4, 4, 3],
  fangcun: [4, 7, 10, 5, 4],
};
function estimateHeight(b, zone) {
  const sc = sizeClass(b.a);
  const typ = b.t.building || '';
  const rr = rand01(hash32(b.key), 7);
  const med = (arr) => arr.slice().sort((p, q) => p - q)[arr.length >> 1];
  const gx = Math.floor(b.c[0] / 250);
  const gz = Math.floor(b.c[1] / 250);
  let pool = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) pool = pool.concat(hGrid.get(`${gx + i},${gz + j},${sc}`) || []);
  if (/warehouse|industrial|roof|garage|garages|service|shed|kiosk|hut|toilets/.test(typ)) return typ === 'roof' ? 6 : 8 + rr * 5;
  if (/house|detached|terrace|temple|shrine|chapel|church/.test(typ)) return (OLD.has(zone) ? 7 : 9) + rr * 4;
  if (/school|kindergarten/.test(typ)) return 3.4 * (3 + Math.round(rr * 3));
  if (/university|college/.test(typ)) return 3.8 * (4 + Math.round(rr * 5));
  if (/hospital/.test(typ)) return 3.8 * (5 + Math.round(rr * 10));
  if (/train_station|transportation/.test(typ)) return 12 + rr * 8;
  if (pool.length >= 3) return med(pool) * (0.82 + 0.36 * rr);
  const key = OLD.has(zone) ? 'old' : DEF_LVL[zone] ? zone : 'res';
  let lvl = DEF_LVL[key][sc];
  // 紧凑的中型平面（点式塔楼）在新城区多为高层住宅
  if (!OLD.has(zone) && sc === 2) {
    const mr = minRect(b.outer);
    const aspect = mr ? Math.max(mr.w, mr.d) / Math.max(1, Math.min(mr.w, mr.d)) : 2;
    if (aspect < 2.2 && (typ === 'apartments' || typ === 'residential' || typ === 'yes')) lvl = 18 + Math.round(rr * 14);
  }
  return lvl * 3.1 * (0.85 + 0.3 * rr);
}

// ---- 骑楼临街面 ----
const qilouRoads = roads.filter((r) => r.qilou && !r.bridge);
const qGrid = new Map();
qilouRoads.forEach((r, qi) => {
  for (let i = 0; i < r.full.length - 1; i++) {
    const a = r.full[i];
    const b = r.full[i + 1];
    const k0 = [Math.floor(Math.min(a[0], b[0]) / 60), Math.floor(Math.min(a[1], b[1]) / 60)];
    const k1 = [Math.floor(Math.max(a[0], b[0]) / 60), Math.floor(Math.max(a[1], b[1]) / 60)];
    for (let gx = k0[0]; gx <= k1[0]; gx++) for (let gz = k0[1]; gz <= k1[1]; gz++) {
      const k = `${gx},${gz}`;
      if (!qGrid.has(k)) qGrid.set(k, []);
      qGrid.get(k).push([qi, i]);
    }
  }
});
function qilouEdges(b) {
  const out = [];
  const ring = b.outer;
  const n = ring.length;
  for (let e = 0; e < n; e++) {
    const A = ring[e];
    const B = ring[(e + 1) % n];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 2.8) continue;
    const mx = (A[0] + B[0]) / 2;
    const mz = (A[1] + B[1]) / 2;
    // 外法线：环为 area() > 0 的方向，外法线 = (-dz, dx)
    const nx = -(B[1] - A[1]) / L;
    const nz = (B[0] - A[0]) / L;
    const cand = qGrid.get(`${Math.floor(mx / 60)},${Math.floor(mz / 60)}`) || [];
    for (const [qi, si] of cand) {
      const r = qilouRoads[qi];
      const a = r.full[si];
      const c = r.full[si + 1];
      const d = segDist(mx, mz, a[0], a[1], c[0], c[1]);
      if (d > r.w * 0.5 + 12) continue;
      const tx = (c[0] - a[0]) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1);
      const tz = (c[1] - a[1]) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1);
      const par = Math.abs((B[0] - A[0]) / L * tx + (B[1] - A[1]) / L * tz);
      if (par < 0.85) continue;
      // 外法线指向道路
      const px = mx + nx * d;
      const pz = mz + nz * d;
      if (segDist(px, pz, a[0], a[1], c[0], c[1]) > d * 0.6 + 2) continue;
      out.push(e);
      break;
    }
  }
  return out;
}

// ---- 主干道临街商铺判定 ----
const mainRoads = roads.filter((r) => !r.bridge && (r.cls === RC.ARTERIAL || r.cls === RC.SECONDARY || r.cls === RC.ONEWAY || r.cls === RC.STREET));
const mGrid = new Map();
mainRoads.forEach((r, mi) => {
  for (let i = 0; i < r.full.length - 1; i++) {
    const a = r.full[i];
    const k = `${Math.floor(a[0] / 80)},${Math.floor(a[1] / 80)}`;
    if (!mGrid.has(k)) mGrid.set(k, []);
    mGrid.get(k).push([mi, i]);
  }
});
function nearRoad(x, z, extra) {
  let best = 1e9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    for (const [mi, si] of mGrid.get(`${Math.floor(x / 80) + i},${Math.floor(z / 80) + j}`) || []) {
      const r = mainRoads[mi];
      const a = r.full[si];
      const c = r.full[si + 1];
      const d = segDist(x, z, a[0], a[1], c[0], c[1]) - r.w * 0.5;
      if (d < best) best = d;
    }
  }
  return best < extra;
}

// ---- 调色板（sRGB）----
const hex = (s) => parseInt(s.slice(1), 16);
const PAL = {
  glass: ['#6f8b96', '#5b7a86', '#8ea4ac', '#7b9090', '#4c6975', '#9aabb2', '#6c807c', '#8a8472', '#a4b8c0', '#56707e', '#7f98a6', '#667a86'],
  mull: ['#c7ccd0', '#8b9195', '#e4e6e7', '#50565b', '#b7b1a3', '#d6d2c8'],
  stone: ['#cfc9bd', '#b9b6ae', '#d8d3c8', '#a9a8a3', '#c2b8a6', '#bdb6aa'],
  resWall: ['#e7dcc6', '#efe9dc', '#d9d5cc', '#e4c9b2', '#ead9ae', '#dcd0bf', '#c9ccc6', '#f0e6d6', '#d8c3a7', '#e1d7c9'],
  resTrim: ['#8a7b6b', '#b9a58c', '#6f757a', '#f4f1ea', '#a2856b', '#7d8a8e'],
  walkup: ['#e8e4dc', '#e3cfc6', '#cfd8cf', '#d4d4d0', '#e6dcc2', '#c9c4bb', '#d9c7b8', '#d1c9b5'],
  qilou: ['#e8dcc4', '#e3cf9f', '#b9a78f', '#b05a3e', '#e0b9a2', '#c7cfb5', '#d09a63', '#d8d2c4', '#c2b49a', '#9c8a78', '#e6d3b0', '#cf8f6c'],
  qTrim: ['#3f5a47', '#5b3d2c', '#f1ece2', '#6b7f86', '#7a4a36', '#2f4a44'],
  brick: ['#7d8584', '#868c8a', '#737b7c', '#8e9290', '#7a8180'],
  village: ['#cfcac0', '#bdb8ae', '#e0dbd0', '#b7aa98', '#d6cfbf', '#a9a49a', '#e3d6c0', '#c4bdb0', '#d2c2a8'],
  colonial: ['#e9d9a8', '#efe3c6', '#e7c7b4', '#f2efe6', '#d9c38f', '#e4d0a6'],
  shopIn: ['#6d5a48', '#5a5a5e', '#7a6a58', '#4f5357'],
  metal: ['#9aa3a8', '#8c9396', '#a7adb0', '#7d8a8e', '#b3b7b8'],
};
const pick = (arr, r) => hex(arr[Math.floor(r * arr.length) % arr.length]);
const ST = { PLAIN: 0, CURTAIN: 1, PUNCHED: 2, RESI: 3, WALKUP: 4, QILOU: 5, BRICK: 6, VILLAGE: 7, PODIUM: 8, SHOP: 9, FINS: 10, DIAGRID: 11, COLONIAL: 12, STONE: 14, METAL: 16 };
const ROOF = { FLAT: 0, PLAIN: 1, GABLE: 2, HIP: 3, GREEN: 4, CANOPY: 5, WAVE: 6 };

const BLD = [];
const qEdges = [];
let nQilou = 0;
let nTall = 0;
for (const b of bl) {
  const zone = zoneAt(b.c[0], b.c[1]);
  const t = b.t;
  const typ = t.building || t['building:part'] || 'yes';
  const r = new RNG(hash32(b.key, 99));
  let { h, base } = (() => {
    const th = tagHeight(b);
    return { h: th.h, base: th.base };
  })();
  if (!(h > 0)) h = estimateHeight(b, zone);
  if (b.part && !(num(t.height) > 0) && !(num(t['building:levels']) > 0)) h = Math.max(h, base + 4);
  if (h <= base + 0.5) h = base + 3;
  h = Math.min(h, 620);
  const sdm = sdMain(b.c[0], b.c[1]);
  const mr = minRect(b.outer);
  const rect = mr ? b.a / Math.max(1, mr.area) : 0.5;
  const nearMain = b.a < 5000 && nearRoad(b.c[0], b.c[1], Math.sqrt(b.a) * 0.6 + 8);
  let style;
  let colA;
  let colB;
  let floorH = 3.2;
  let cellW = 3;
  let lit = r.float(0.45, 0.75);
  let p1 = 0;
  let p2 = 0;
  let led = 0;
  let roof = ROOF.FLAT;
  let flags = 0;
  const name = t.name || '';
  const tall = h >= 80;
  const old = OLD.has(zone);
  let qe = [];
  if (old && h <= 40 && !b.part && b.a < 3000 && qilouRoads.length) qe = qilouEdges(b);
  const village = !old && zone !== 'cbd' && b.a < 260 && villageAt(b.c[0], b.c[1]) >= 16 && h < 36;

  if (qe.length) {
    style = ST.QILOU;
    colA = pick(PAL.qilou, r.next());
    colB = pick(PAL.qTrim, r.next());
    floorH = r.float(3.4, 3.9);
    cellW = r.float(1.7, 2.4);
    lit = r.float(0.28, 0.5);
    p1 = r.int(0, 2);
    p2 = r.next();
    for (const e of qe) qEdges.push(BLD.length, e);
    nQilou++;
  } else if (zone === 'shamian' && h < 30) {
    style = ST.COLONIAL;
    colA = pick(PAL.colonial, r.next());
    colB = hex('#f2efe8');
    floorH = 4.3;
    cellW = r.float(3.0, 3.8);
    lit = 0.4;
    if (rect > 0.8 && b.a < 1800) roof = r.chance(0.6) ? ROOF.HIP : ROOF.FLAT;
  } else if (tall && (OFFICE.test(typ) || typ === 'yes' || /glass/.test(t['building:material'] || '')) && (!/apartments|residential/.test(typ))) {
    const curtain = zone === 'cbd' || zone === 'tianhe' || zone === 'pazhou' ? r.chance(0.85) : r.chance(0.55);
    style = curtain ? ST.CURTAIN : ST.PUNCHED;
    colA = curtain ? pick(PAL.glass, r.next()) : pick(PAL.stone, r.next());
    colB = curtain ? pick(PAL.mull, r.next()) : pick(PAL.glass, r.next());
    floorH = 4.0;
    cellW = curtain ? r.pick([1.35, 1.5, 1.6]) : r.pick([2.6, 3.0, 3.4]);
    lit = r.float(0.55, 0.85);
    flags |= 16;
    nTall++;
  } else if (village) {
    style = ST.VILLAGE;
    colA = pick(PAL.village, r.next());
    colB = pick(PAL.qTrim, r.next());
    floorH = 2.95;
    cellW = r.pick([2.4, 2.6, 3.0]);
    lit = r.float(0.5, 0.8);
    flags |= 2;
  } else if (/apartments|residential|dormitory/.test(typ) || (typ === 'yes' && !old && h >= 24 && b.a < 2500)) {
    if (h >= 26) {
      style = ST.RESI;
      colA = pick(PAL.resWall, r.next());
      colB = pick(PAL.resTrim, r.next());
      floorH = 3.0;
      cellW = r.pick([3.2, 3.5, 3.8]);
      lit = r.float(0.5, 0.72);
      if (tall) nTall++;
    } else {
      style = ST.WALKUP;
      colA = pick(PAL.walkup, r.next());
      colB = pick(PAL.qTrim, r.next());
      floorH = 3.0;
      cellW = r.pick([3.0, 3.3, 3.6]);
      lit = r.float(0.45, 0.7);
      if (nearMain) p1 = 1;
    }
    flags |= 2;
  } else if (/retail|commercial|supermarket|mall/.test(typ) && b.a > 2200 && h < 45) {
    style = ST.PODIUM;
    colA = pick(PAL.stone, r.next());
    colB = pick(PAL.glass, r.next());
    floorH = 5.2;
    cellW = 7.5;
    lit = 0.9;
    roof = r.chance(0.25) ? ROOF.GREEN : ROOF.FLAT;
  } else if (/school|university|college|hospital|public|government|civic|office|kindergarten|museum|library/.test(typ)) {
    style = r.chance(0.5) ? ST.STONE : ST.PUNCHED;
    colA = pick(style === ST.STONE ? PAL.stone : PAL.resWall, r.next());
    colB = pick(PAL.glass, r.next());
    floorH = 3.8;
    cellW = style === ST.STONE ? r.pick([2.4, 2.8]) : r.pick([3.0, 3.4]);
    lit = r.float(0.3, 0.6);
    flags |= 2;
  } else if (/warehouse|industrial|train_station|transportation|garage|garages|service|shed|hangar/.test(typ)) {
    style = ST.PLAIN;
    colA = pick(PAL.metal, r.next());
    colB = colA;
    roof = ROOF.PLAIN;
  } else if (typ === 'roof') {
    style = ST.PLAIN;
    colA = hex('#c9ccce');
    colB = colA;
    roof = ROOF.CANOPY;
    base = Math.max(base, h - 1.2);
  } else if (old && h < 13) {
    style = ST.BRICK;
    const wash = r.chance(0.28);
    colA = wash ? hex('#d8d3c6') : pick(PAL.brick, r.next());
    colB = pick(PAL.qTrim, r.next());
    floorH = 3.3;
    cellW = r.float(3.4, 3.8);
    lit = 0.28;
    p1 = wash ? 1 : 0;
    if (rect > 0.78 && b.a < 700) roof = ROOF.GABLE;
  } else if (/house|detached|terrace|temple|church|chapel|shrine/.test(typ)) {
    style = zone === 'ersha' ? ST.COLONIAL : ST.BRICK;
    colA = style === ST.COLONIAL ? pick(PAL.colonial, r.next()) : pick(PAL.brick, r.next());
    colB = hex('#f2efe8');
    floorH = 3.6;
    cellW = 3.4;
    lit = 0.4;
    if (rect > 0.78 && b.a < 900) roof = r.chance(0.6) ? ROOF.HIP : ROOF.GABLE;
  } else if (h >= 40) {
    const res = !(zone === 'cbd' || zone === 'tianhe' || zone === 'pazhou') && r.chance(0.65);
    style = res ? ST.RESI : r.chance(0.6) ? ST.CURTAIN : ST.PUNCHED;
    colA = res ? pick(PAL.resWall, r.next()) : style === ST.CURTAIN ? pick(PAL.glass, r.next()) : pick(PAL.stone, r.next());
    colB = res ? pick(PAL.resTrim, r.next()) : style === ST.CURTAIN ? pick(PAL.mull, r.next()) : pick(PAL.glass, r.next());
    floorH = res ? 3.0 : 4.0;
    cellW = res ? r.pick([3.2, 3.5]) : style === ST.CURTAIN ? 1.5 : 3.0;
    flags |= 2;
    if (tall) nTall++;
  } else {
    style = old ? (r.chance(0.7) ? ST.WALKUP : ST.BRICK) : ST.WALKUP;
    colA = style === ST.BRICK ? pick(PAL.brick, r.next()) : pick(PAL.walkup, r.next());
    colB = pick(PAL.qTrim, r.next());
    floorH = 3.0;
    cellW = r.pick([3.0, 3.3, 3.6]);
    lit = r.float(0.45, 0.7);
    if (nearMain || old) p1 = 1;
    flags |= 2;
  }
  // ---- 指定地标的立面 ----
  if (b.key === 'w184738716') {
    style = ST.DIAGRID;
    colA = hex('#9fb3bd');
    colB = hex('#eef0f1');
    floorH = 4.5;
    cellW = 1.6;
    lit = 0.75;
    h = 440;
    landmarks.push({ kind: 'label', name: '西塔 · 广州国际金融中心', sub: 'IFC · 440 m', x: b.c[0], z: b.c[1], y: 480, tier: 2 });
  }
  if (b.part && Math.hypot(b.c[0] - LM.ctf[0], b.c[1] - LM.ctf[1]) < 60) {
    style = ST.FINS;
    colA = hex('#56656b');
    colB = hex('#e7e1d3');
    floorH = 4.2;
    cellW = 1.25;
    lit = 0.72;
    led = h > 500 ? 3 : 0;
  }
  if (b.part && Math.hypot(b.c[0] - LM.citic[0], b.c[1] - LM.citic[1]) < 70) {
    style = ST.STONE;
    colA = hex('#c9c0ad');
    colB = hex('#58646a');
    floorH = 4.0;
    cellW = 2.2;
  }
  if (name === '广东省博物馆') {
    style = ST.STONE;
    colA = hex('#3d3736');
    colB = hex('#c9c1b3');
    h = 44;
    base = 0;
    floorH = 5.5;
    cellW = 6;
    lit = 0.15;
  }
  if (name === '广州图书馆') {
    style = ST.FINS;
    colA = hex('#8c9296');
    colB = hex('#d9d4c8');
    h = 50;
    cellW = 1.8;
  }
  // 临江楼宇灯光秀
  if (h > 60 && sdm < 260 && sdm > 0 && style !== ST.RESI) led = led || r.pickW([1, 2, 3], [3, 3, 1]);
  else if (h > 60 && sdm < 260 && sdm > 0) led = r.chance(0.5) ? r.pickW([1, 2], [2, 1]) : 0;
  else if (h > 150) led = led || r.pickW([0, 1, 3], [2, 2, 1]);
  if (sdm < 300) flags |= 8;
  if (roof === ROOF.FLAT && (h < 4 || b.a < 25)) roof = ROOF.PLAIN;
  // 琶洲广交会展馆：大跨度展厅 + 波浪形金属屋面，玻璃幕墙
  if (zone === 'pazhou' && b.a > 12000 && h < 45 && !b.part) {
    roof = ROOF.WAVE;
    style = ST.PODIUM;
    colA = hex('#c9ced1');
    colB = hex('#6f858e');
    floorH = 6;
    cellW = 3;
    h = Math.max(h, 24);
  }
  if (t['roof:shape'] === 'gabled' && rect > 0.7) roof = ROOF.GABLE;
  if (t['roof:shape'] === 'hipped' && rect > 0.7) roof = ROOF.HIP;
  BLD.push({ b, h, base, style, colA, colB, floorH, cellW, lit, p1, p2, led, roof, flags, seed: hash32(b.key) % 9973 });
}
log('styled', BLD.length, 'qilou', nQilou, 'tall', nTall);

// 地标标注：从命名建筑与地块中提取
const LABELS = [];
const lab = (name, sub, lon, lat, y, tier, district = false) => {
  const [x, z] = LL(lon, lat);
  LABELS.push({ name, sub, x, z, y, tier, district });
};
lab('珠江新城 CBD', 'ZHUJIANG NEW TOWN', 113.3265, 23.1265, 320, 1, true);
lab('天河路商圈', 'TIANHE ROAD', 113.3255, 23.1335, 180, 1, true);
lab('琶洲 · 互联网总部集聚区', 'PAZHOU', 113.3445, 23.1045, 260, 1, true);
lab('海珠', 'HAIZHU', 113.2905, 23.0990, 90, 1, true);
lab('越秀 · 千年老城', 'YUEXIU', 113.2700, 23.1275, 90, 1, true);
lab('西关 · 荔湾老城', 'XIGUAN', 113.2445, 23.1245, 70, 1, true);
lab('白鹅潭', 'BAIETAN', 113.2338, 23.1030, 25, 1, true);
lab('珠江 · 前航道', 'PEARL RIVER', 113.2860, 23.1108, 25, 1, true);
lab('二沙岛', 'ERSHA ISLAND', 113.3000, 23.1128, 40, 1, true);
lab('东山口', 'DONGSHANKOU', 113.2955, 23.1255, 60, 1, true);
lab('芳村', 'FANGCUN', 113.2270, 23.0960, 50, 1, true);
lab('广州塔', 'Canton Tower · 600 m', 113.31914, 23.10899, 640, 0);
lab('东塔 · 周大福金融中心', 'CTF · 530 m', 113.32058, 23.12026, 565, 2);
lab('中信广场', 'CITIC Plaza · 391 m', 113.3195, 23.1444, 430, 2);
lab('广州大剧院', 'Opera House', 113.31722, 23.11785, 70, 3);
lab('广东省博物馆', 'Guangdong Museum', 113.32115, 23.11749, 70, 3);
lab('广州图书馆', 'Guangzhou Library', 113.32055, 23.11896, 75, 3);
lab('花城广场', 'Huacheng Square', 113.3192, 23.1240, 30, 3);
lab('海心沙', 'Haixinsha', 113.31943, 23.11415, 30, 3);
lab('海心桥', 'Haixin Bridge', 113.3139, 23.1110, 50, 3);
lab('天河体育中心', 'Tianhe Sports Center', 113.31938, 23.14058, 70, 3);
lab('星海音乐厅', 'Xinghai Concert Hall', 113.30021, 23.11050, 45, 3);
lab('陈家祠', 'Chen Clan Academy', 113.24006, 23.12993, 40, 2);
lab('永庆坊', 'Yongqingfang', 113.23398, 23.11727, 30, 3);
lab('上下九步行街', 'Shangxiajiu', 113.24293, 23.11750, 40, 2);
lab('北京路步行街', 'Beijing Road', 113.26399, 23.12327, 45, 2);
lab('石室圣心大教堂', 'Sacred Heart Cathedral', 113.25473, 23.11737, 75, 3);
lab('中山纪念堂', 'Sun Yat-sen Memorial Hall', 113.25947, 23.13570, 55, 3);
lab('越秀公园 · 镇海楼', 'Yuexiu Park', 113.26025, 23.14059, 60, 3);
lab('六榕花塔', 'Flower Pagoda', 113.25473, 23.13094, 85, 3);
lab('广东电视塔', 'TV Tower · 200 m', 113.26415, 23.14374, 240, 3);
lab('沙面', 'Shamian Island', 113.2412, 23.1093, 45, 2);
lab('白天鹅宾馆', 'White Swan Hotel', 113.23736, 23.10853, 110, 3);
lab('爱群大厦', 'Oi Kwan Building', 113.25153, 23.11211, 95, 3);
lab('琶洲 · 广交会展馆', 'Canton Fair Complex', 113.3594, 23.1025, 70, 2);
lab('琶洲塔', 'Pazhou Pagoda', 113.37027, 23.10175, 85, 3);
lab('流花湖公园', 'Liuhua Lake Park', 113.2447, 23.1388, 30, 3);
lab('荔湾湖公园', 'Liwan Lake Park', 113.2284, 23.1243, 30, 3);
lab('珠江公园', 'Pearl River Park', 113.3338, 23.1228, 30, 3);
lab('中山大学', 'Sun Yat-sen University', 113.2960, 23.0975, 40, 3);
lab('猎德村', 'Liede Village', 113.3290, 23.1170, 60, 3);

// ====================================================================================
// 6. 跨江桥（按桥名合并双幅）
// ====================================================================================
const KIND = { 海印大桥: 'cable1', 猎德大桥: 'liede', 海珠桥: 'arch', 解放大桥: 'tubearch', 人民桥: 'girder', 江湾大桥: 'girder', 广州大桥: 'girder', 广州大桥新桥: 'girder', 华南大桥: 'girder', 琶洲大桥: 'vstrut', 鹤洞大桥: 'cable', 珠江大桥东桥: 'truss', 珠江大桥西桥: 'truss', 鹅潭大桥: 'girder' };
for (let i = bridges.length - 1; i >= 0; i--) {
  const m = [(bridges[i].a[0] + bridges[i].b[0]) / 2, (bridges[i].a[1] + bridges[i].b[1]) / 2];
  if (!inCity(m[0], m[1], 600) || /引桥/.test(bridges[i].name)) bridges.splice(i, 1);
}
for (const br of bridges) {
  br.kind = KIND[br.name] || 'girder';
  if (br.name) LABELS.push({ name: br.name, sub: 'Bridge', x: (br.a[0] + br.b[0]) / 2, z: (br.a[1] + br.b[1]) / 2, y: br.deckH + 45, tier: 3 });
}
log('river bridges', bridges.map((b) => `${b.name}:${b.kind}`).join(' '));

// ====================================================================================
// 7. 植被与路灯
// ====================================================================================
const OC = 2;
const occ = new Grid(CITY.x0 - 500, CITY.z0 - 500, OC, Math.ceil((CITY.x1 - CITY.x0 + 1000) / OC), Math.ceil((CITY.z1 - CITY.z0 + 1000) / OC));
// 1 = 建筑，2 = 道路，4 = 树
for (const B of BLD) {
  if (B.roof === ROOF.CANOPY || B.base > 3) continue;
  occ.fillRings([B.b.outer], 1, 'or');
}
for (const r of roads) {
  if (r.bridge) continue;
  for (let i = 0; i < r.out.length - 1; i++) occ.strokeLine(r.out[i], r.out[i + 1], r.w * 0.5 + 0.8, 2, 'or');
}
// 铁路与地面 / 高架轨道（道床占地，补全建筑与树木避开）
const RAILS = buildRails({ misc, P, sdMain, inCity });
for (const w of RAILS.ways) for (let i = 0; i < w.pts.length - 1; i++) occ.strokeLine(w.pts[i], w.pts[i + 1], 3, 2, 'or');
log('rails', RAILS.ways.length, 'tracks', (RAILS.ways.reduce((s, w) => s + w.len, 0) / 1000).toFixed(0), 'km', RAILS.chains.length, 'train routes');

// ====================================================================================
// 6b. 补全：OSM 未测绘建筑的街区，沿真实街道按片区规则生成临街建筑与街坊内部建筑
// ====================================================================================
// 开敞空间（公园、绿地、运动场、停车场、广场、工地）不补建
for (const g of ground) {
  if (g.kind === GK.COMPOUND || (g.kind === GK.PLAZA && g.pri === 1)) continue;
  occ.fillRings([g.outer], 8, 'or');
}
for (const ex of exclusion) {
  if (ex.ring) occ.fillRings([ex.ring], 8, 'or');
  else {
    const ring = [];
    for (let k = 0; k < 16; k++) ring.push([ex.c[0] + Math.cos((k / 16) * 6.283) * ex.r * 1.4, ex.c[1] + Math.sin((k / 16) * 6.283) * ex.r * 1.4]);
    occ.fillRings([ring], 8, 'or');
  }
}
const FILL = [];
const fillFree = (cx, cz, ux, uz, w, d, pad) => {
  const vx = -uz;
  const vz = ux;
  const hw = w / 2 + pad;
  const hd = d / 2 + pad;
  for (let a = -hw; a <= hw + 0.01; a += OC * 0.9) {
    for (let b = -hd; b <= hd + 0.01; b += OC * 0.9) {
      const x = cx + ux * a + vx * b;
      const z = cz + uz * a + vz * b;
      const k = occ.idx(x, z);
      if (k < 0 || occ.data[k]) return false;
    }
  }
  if (sdAll(cx, cz) < Math.max(w, d) * 0.5 + 4) return false;
  if (sdMain(cx, cz) < Math.max(w, d) * 0.5 + 24) return false;
  return true;
};
const markRect = (cx, cz, ux, uz, w, d) => {
  const vx = -uz;
  const vz = ux;
  const ring = [[cx - ux * w / 2 - vx * d / 2, cz - uz * w / 2 - vz * d / 2], [cx + ux * w / 2 - vx * d / 2, cz + uz * w / 2 - vz * d / 2], [cx + ux * w / 2 + vx * d / 2, cz + uz * w / 2 + vz * d / 2], [cx - ux * w / 2 + vx * d / 2, cz - uz * w / 2 + vz * d / 2]];
  occ.fillRings([ring], 1, 'or');
};
// 按字段名写入定长记录（字段顺序见 src/world/schema.js）
function record(F, values) {
  const out = new Array(F.N).fill(0);
  for (const [k, v] of Object.entries(values)) out[F[k]] = v || 0;
  return out;
}
// FILL 记录（flags & 64：临街面为 −v 侧的骑楼）
function emitFill(cx, cz, ux, uz, w, d, spec) {
  FILL.push(record(SCHEMA.FILL, { X: cx, Z: cz, UX: ux, UZ: uz, W: w, D: d, H: spec.h, STYLE: spec.style, COL_A: spec.colA, COL_B: spec.colB, FLOOR_H: spec.floorH, CELL_W: spec.cellW, LIT: spec.lit, P1: spec.p1, P2: spec.p2, LED: spec.led, ROOF: spec.roof, FLAGS: spec.flags }));
  markRect(cx, cz, ux, uz, w, d);
}
const frng = new RNG(88801);
const FILL_ZONES = new Set(['xiguan', 'yuexiu', 'haizhuold', 'res', 'fangcun']);
function lotSpec(zone, kind, r) {
  const old = OLD.has(zone);
  if (kind === 'qilou') {
    const floors = r.int(2, 4);
    return { h: r.float(4.8, 5.4) + floors * r.float(3.4, 3.9), style: ST.QILOU, colA: pick(PAL.qilou, r.next()), colB: pick(PAL.qTrim, r.next()), floorH: r.float(3.4, 3.9), cellW: r.float(1.7, 2.4), lit: r.float(0.28, 0.5), p1: r.int(0, 2), p2: r.next(), flags: 64 | 2 };
  }
  if (old) {
    if (kind === 'lane' || r.chance(0.35)) {
      const wash = r.chance(0.3);
      const floors = r.int(2, 4);
      return { h: floors * 3.3, style: ST.BRICK, colA: wash ? hex('#d8d3c6') : pick(PAL.brick, r.next()), colB: pick(PAL.qTrim, r.next()), floorH: 3.3, cellW: r.float(3.4, 3.8), lit: 0.3, p1: wash ? 1 : 0, roof: r.chance(0.7) ? ROOF.GABLE : ROOF.FLAT, flags: 2 };
    }
    const floors = r.int(4, 8);
    return { h: floors * 3.0, style: ST.WALKUP, colA: pick(PAL.walkup, r.next()), colB: pick(PAL.qTrim, r.next()), floorH: 3.0, cellW: r.pick([3.0, 3.3, 3.6]), lit: r.float(0.45, 0.7), p1: kind === 'street' ? 1 : 0, flags: 2 };
  }
  if (kind === 'tower') {
    const floors = r.int(16, 33);
    return { h: floors * 3.0 + 1.2, style: ST.RESI, colA: pick(PAL.resWall, r.next()), colB: pick(PAL.resTrim, r.next()), floorH: 3.0, cellW: r.pick([3.2, 3.5, 3.8]), lit: r.float(0.5, 0.72), flags: 2 | 16 };
  }
  const floors = r.int(6, 9);
  return { h: floors * 3.0, style: floors >= 9 ? ST.RESI : ST.WALKUP, colA: pick(PAL.walkup, r.next()), colB: pick(PAL.qTrim, r.next()), floorH: 3.0, cellW: r.pick([3.0, 3.3, 3.6]), lit: r.float(0.45, 0.7), p1: kind === 'street' ? 1 : 0, flags: 2 };
}
// 沿街：逐段、两侧布置地块；老城多排进深
for (const r of roads) {
  if (r.bridge || r.cls === RC.EXPRESS || r.link || r.hw === 'service' && r.len < 80) continue;
  const pts = r.out;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 12) continue;
    const ux = (b[0] - a[0]) / L;
    const uz = (b[1] - a[1]) / L;
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const zone = zoneAt(mid[0], mid[1]);
    if (!FILL_ZONES.has(zone) || !inCity(mid[0], mid[1], -50)) continue;
    const old = OLD.has(zone);
    for (const side of [-1, 1]) {
      // 法线指向地块一侧：v = side * (-uz, ux)
      const vx = -uz * side;
      const vz = ux * side;
      const rows = old ? 4 : 2;
      // 地块前沿须让开道路占地（路宽一半 + 0.8 m）
      let o0 = r.w / 2 + (r.qilou && old ? 1.15 : old ? (r.cls === RC.LANE ? 1.15 : 2.4) : r.cls === RC.LANE ? 3 : frng.float(6, 11));
      for (let row = 0; row < rows; row++) {
        const kindRow = row === 0 ? (r.qilou && old ? 'qilou' : r.cls === RC.LANE ? 'lane' : 'street') : 'inner';
        let s = a[3] + (row === 0 ? 2 : 4);
        let D = 0;
        while (s < L - b[3] - 3) {
          let W;
          let Dl;
          let kind = kindRow;
          if (old) {
            W = kind === 'qilou' ? frng.float(4.2, 5.8) : kind === 'lane' ? frng.float(4, 6.5) : frng.float(4.5, 9);
            Dl = kind === 'qilou' ? frng.float(14, 19) : frng.float(9, 14);
          } else {
            const tower = kindRow !== 'lane' && frng.chance(0.33);
            kind = tower ? 'tower' : kindRow;
            W = tower ? frng.float(20, 26) : kind === 'lane' ? frng.float(9, 16) : frng.float(16, 36);
            Dl = tower ? frng.float(17, 22) : frng.float(11, 15);
          }
          if (s + W > L - b[3] - 1) break;
          const cx = a[0] + ux * (s + W / 2) + vx * (o0 + Dl / 2);
          const cz = a[1] + uz * (s + W / 2) + vz * (o0 + Dl / 2);
          // 地块局部坐标：u 沿街，v 指向街区内部；FILL 的 -v 侧为临街面
          if (fillFree(cx, cz, ux * side, uz * side, W, Dl, old ? 0.25 : 2.5)) {
            const spec = lotSpec(zone, kind, frng);
            emitFill(cx, cz, ux * side, uz * side, W - (old ? 0.1 : 0), Dl, spec);
            D = Math.max(D, Dl);
          }
          s += W + (old ? (kind === 'qilou' ? 0.05 : frng.float(0.2, 1.1)) : frng.float(6, 14));
        }
        o0 += (D || 12) + (old ? frng.float(1.2, 2.2) : frng.float(10, 16));
        D = 0;
      }
    }
  }
}
log('fill along streets', FILL.length);
// 街坊内部：按最近道路方向网格补建
{
  const n0 = FILL.length;
  const step = (zone) => (OLD.has(zone) ? 11 : 36);
  for (let x = CITY.x0 + 20; x < CITY.x1 - 20; x += 11) {
    for (let z = CITY.z0 + 20; z < CITY.z1 - 20; z += 11) {
      const zone = zoneAt(x, z);
      if (!FILL_ZONES.has(zone)) continue;
      const st = step(zone);
      if (!OLD.has(zone) && (Math.round(x / 11) % 3 || Math.round(z / 11) % 3)) continue;
      // 最近道路方向
      let best = null;
      let bd = 140;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        for (const [mi, si] of mGrid.get(`${Math.floor(x / 80) + i},${Math.floor(z / 80) + j}`) || []) {
          const r = mainRoads[mi];
          const a = r.full[si];
          const c = r.full[si + 1];
          const d = segDist(x, z, a[0], a[1], c[0], c[1]);
          if (d < bd) {
            bd = d;
            best = [c[0] - a[0], c[1] - a[1]];
          }
        }
      }
      if (!best) continue;
      const bl2 = Math.hypot(best[0], best[1]) || 1;
      const ux = best[0] / bl2;
      const uz = best[1] / bl2;
      const old = OLD.has(zone);
      const tower = !old && frng.chance(0.45);
      const W = old ? frng.float(5.5, 11) : tower ? frng.float(20, 26) : frng.float(20, 40);
      const Dl = old ? frng.float(8, 13) : tower ? frng.float(17, 22) : frng.float(11, 15);
      const cx = x + frng.float(-st * 0.25, st * 0.25);
      const cz = z + frng.float(-st * 0.25, st * 0.25);
      if (!fillFree(cx, cz, ux, uz, W, Dl, old ? 0.5 : 4)) continue;
      emitFill(cx, cz, ux, uz, W, Dl, lotSpec(zone, old ? (frng.chance(0.6) ? 'lane' : 'inner') : tower ? 'tower' : 'inner', frng));
    }
  }
  log('fill interior', FILL.length - n0);
}

// 种树：避开建筑、道路与已有的树（开敞空间标记 8 只用于阻止补建，公园绿地里照常种树）
const free = (x, z, rad = 1) => {
  const i0 = Math.floor((x - occ.x0) / OC);
  const j0 = Math.floor((z - occ.z0) / OC);
  for (let j = j0 - rad; j <= j0 + rad; j++) for (let i = i0 - rad; i <= i0 + rad; i++) {
    if (i < 0 || j < 0 || i >= occ.nx || j >= occ.nz) return false;
    if (occ.data[j * occ.nx + i] & 7) return false;
  }
  return true;
};
const markTree = (x, z) => {
  const k = occ.idx(x, z);
  if (k >= 0) occ.data[k] |= 4;
};
const TREE = { BANYAN: 0, PALM: 1, FANPALM: 2, KAPOK: 3, BROAD: 4 };
const trees = [[], [], [], [], []];
let nTrees = 0;
const trng = new RNG(20260924);
const scaleFor = (sp) => (sp === TREE.BANYAN ? trng.float(0.8, 1.2) : sp === TREE.PALM ? trng.float(0.85, 1.2) : sp === TREE.KAPOK ? trng.float(0.85, 1.15) : trng.float(0.75, 1.2));
function put(sp, x, z, s, opt = {}) {
  if (!inCity(x, z, 300)) return false;
  if (!opt.force && !free(x, z, opt.rad ?? 1)) return false;
  if (sdAll(x, z) < (opt.wet ?? 2.5)) return false;
  trees[sp].push(+x.toFixed(2), +z.toFixed(2), +trng.float(0, 6.283).toFixed(3), +s.toFixed(3), +trng.next().toFixed(3), 0);
  markTree(x, z);
  nTrees++;
  return true;
}
const pickSp = (zone, rr) => {
  switch (zone) {
    case 'cbd':
    case 'pazhou':
      return rr < 0.5 ? TREE.PALM : rr < 0.72 ? TREE.BROAD : rr < 0.88 ? TREE.BANYAN : TREE.FANPALM;
    case 'tianhe':
      return rr < 0.35 ? TREE.PALM : rr < 0.7 ? TREE.BROAD : TREE.BANYAN;
    case 'xiguan':
    case 'yuexiu':
    case 'haizhuold':
    case 'shamian':
      return rr < 0.62 ? TREE.BANYAN : rr < 0.85 ? TREE.BROAD : TREE.KAPOK;
    default:
      return rr < 0.4 ? TREE.BANYAN : rr < 0.72 ? TREE.BROAD : rr < 0.84 ? TREE.KAPOK : rr < 0.93 ? TREE.FANPALM : TREE.PALM;
  }
};
// 1) 滨江步道：大王椰与榕树交替（沿主航道等距线）
{
  const lines = contourSdf(6);
  let alt = 0;
  for (const l of lines) for (const p of resample(l, 9)) {
    if (!inCity(p[0], p[1], 100)) continue;
    const sp = alt++ % 3 === 2 ? TREE.BANYAN : trng.chance(0.14) ? TREE.KAPOK : TREE.PALM;
    put(sp, p[0], p[1], scaleFor(sp), { wet: 1, rad: 0 });
  }
  for (const l of contourSdf(16)) for (const p of resample(l, 12)) {
    if (!inCity(p[0], p[1], 100)) continue;
    const sp = trng.chance(0.6) ? TREE.BANYAN : TREE.BROAD;
    put(sp, p[0], p[1], scaleFor(sp), { rad: 1 });
  }
}
// 2) 行道树与分隔带
const lamps = [];
const pools = [];
for (const r of roads) {
  if (r.bridge || r.hw === 'service') continue;
  const big = r.cls === RC.ARTERIAL || r.cls === RC.EXPRESS || r.cls === RC.SECONDARY || r.cls === RC.ONEWAY;
  const spacing = r.cls === RC.LANE ? 22 : big ? 10 : 13;
  const zoneMid = zoneAt(r.out[0][0], r.out[0][1]);
  const skip = OLD.has(zoneMid) ? (r.cls === RC.STREET || r.cls === RC.LANE ? 0.7 : 0.35) : 0;
  const pts = r.out;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 6) continue;
    const tx = (b[0] - a[0]) / len;
    const tz = (b[1] - a[1]) / len;
    const nx = -tz;
    const nz = tx;
    const c0 = a[3] + 3;
    const c1 = b[3] + 3;
    const sides = r.oneway && big ? [1] : [-1, 1];
    for (const side of sides) {
      const o = r.w / 2 + 2.3;
      let t = c0 + trng.float(0, spacing * 0.5);
      while (t < len - c1) {
        if (trng.next() >= skip) {
          const x = a[0] + tx * t + nx * o * side;
          const z = a[1] + tz * t + nz * o * side;
          const zone = zoneAt(x, z);
          const sp = r.qilou ? TREE.BROAD : pickSp(zone, trng.next());
          put(sp, x, z, scaleFor(sp), { rad: 0 });
        }
        t += spacing * trng.float(0.85, 1.15);
      }
    }
    // 宽马路中央分隔带：棕榈 / 蒲葵
    if (r.cls === RC.ARTERIAL && !r.oneway) {
      let t = c0 + 4;
      const zone = zoneAt(a[0], a[1]);
      while (t < len - c1 - 4) {
        const sp = zone === 'cbd' || zone === 'pazhou' || zone === 'tianhe' ? TREE.PALM : trng.chance(0.5) ? TREE.FANPALM : TREE.BROAD;
        put(sp, a[0] + tx * t, a[1] + tz * t, scaleFor(sp) * 0.9, { force: true });
        t += 12;
      }
    }
    // 路灯（灯臂指向路中）与灯光投影
    if (r.cls !== RC.LANE || r.pedestrian) {
      const ls = r.cls === RC.STREET || r.cls === RC.LANE ? 34 : 38;
      const lh = r.cls === RC.STREET || r.cls === RC.LANE ? 7.5 : 10;
      for (const side of r.cls === RC.STREET || r.cls === RC.LANE ? [1] : [-1, 1]) {
        let t = c0 + 6;
        while (t < len - c1 - 4) {
          const o = r.w / 2 + 0.6;
          const x = a[0] + tx * t + nx * o * side;
          const z = a[1] + tz * t + nz * o * side;
          if (sdAll(x, z) > 2 && inCity(x, z, 200)) {
            lamps.push(+x.toFixed(2), 0, +z.toFixed(2), +Math.atan2(nz * side, -nx * side).toFixed(3), lh, 0);
            pools.push(+(x - nx * side * 3.5).toFixed(2), 0.18, +(z - nz * side * 3.5).toFixed(2), r.cls === RC.STREET ? 8 : 11, 0);
          }
          t += ls;
        }
      }
    }
  }
}
// 3) 公园 / 绿地 / 林地（珠江新城的广场式公园如花城广场：大草坪上稀疏的大王椰与蒲葵）
for (const g of greenPolys) {
  const [x0, z0, x1, z1] = bbox(g.outer);
  const plaza = g.kind !== GK.FOREST && zoneAt(...centroid(g.outer)) === 'cbd';
  const sp0 = plaza ? 26 : g.kind === GK.FOREST ? 11 : g.kind === GK.GARDEN ? 13 : 19;
  for (let x = x0 + sp0 * 0.5; x < x1; x += sp0) {
    for (let z = z0 + sp0 * 0.5; z < z1; z += sp0) {
      const px = x + trng.float(-sp0 * 0.4, sp0 * 0.4);
      const pz = z + trng.float(-sp0 * 0.4, sp0 * 0.4);
      if (!pointInRing(px, pz, g.outer)) continue;
      if (g.holes.some((h) => pointInRing(px, pz, h))) continue;
      // 林间空地：低频噪声留出草坪
      if (g.kind !== GK.FOREST && rand01(Math.floor(px / 45), Math.floor(pz / 45), 17) < 0.3) continue;
      const zone = zoneAt(px, pz);
      const sp = g.kind === GK.FOREST ? trng.pickW([TREE.BROAD, TREE.BANYAN, TREE.KAPOK], [5, 3, 1]) : plaza ? trng.pickW([TREE.PALM, TREE.FANPALM, TREE.BANYAN], [6, 2, 1]) : zone === 'cbd' ? trng.pickW([TREE.PALM, TREE.BANYAN, TREE.BROAD, TREE.KAPOK], [4, 3, 2, 1]) : trng.pickW([TREE.BANYAN, TREE.BROAD, TREE.KAPOK, TREE.PALM, TREE.FANPALM], [3.5, 3, 1.2, 1.3, 1]);
      put(sp, px, pz, scaleFor(sp) * 1.08, { rad: 1 });
    }
  }
}
// 4) 小区与院落：在空地中稀疏种植
for (const g of ground) {
  if (g.kind !== GK.COMPOUND) continue;
  const [x0, z0, x1, z1] = bbox(g.outer);
  const sp0 = 26;
  for (let x = x0 + 5; x < x1; x += sp0) {
    for (let z = z0 + 5; z < z1; z += sp0) {
      const px = x + trng.float(-5, 5);
      const pz = z + trng.float(-5, 5);
      if (!pointInRing(px, pz, g.outer)) continue;
      const zone = zoneAt(px, pz);
      put(pickSp(zone, trng.next()), px, pz, trng.float(0.8, 1.15), { rad: 2 });
    }
  }
}
log('trees', nTrees, trees.map((t) => t.length / SCHEMA.TREE_REC.N).join('/'), 'lamps', lamps.length / 6);
// 滨江灯柱
for (const l of contourSdf(3.5)) for (const p of resample(l, 17)) {
  if (!inCity(p[0], p[1], 100)) continue;
  lamps.push(+p[0].toFixed(2), 0, +p[1].toFixed(2), 0, 4.6, 1);
  pools.push(+p[0].toFixed(2), 0.18, +p[1].toFixed(2), 7, 1);
}
// 高架路灯
for (const r of roads) {
  if (!r.bridge || r.river) continue;
  const f = r.full;
  let acc = 0;
  for (let i = 0; i < f.length - 1; i++) {
    const a = f[i];
    const b = f[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / (L || 1);
    const tz = (b[1] - a[1]) / (L || 1);
    for (let t = (40 - acc) % 40; t < L; t += 40) {
      const y = r.ys[i] + (r.ys[i + 1] - r.ys[i]) * (t / L);
      if (y < 4) continue;
      const x = a[0] + tx * t;
      const z = a[1] + tz * t;
      const side = r.oneway ? 1 : -1;
      const o = r.w / 2 - 0.4;
      lamps.push(+(x - tz * o * side).toFixed(2), +y.toFixed(2), +(z + tx * o * side).toFixed(2), +Math.atan2(tx * side, tz * side).toFixed(3), 8, 2);
      pools.push(+x.toFixed(2), +(y + 0.3).toFixed(2), +z.toFixed(2), 10, 2);
    }
    acc = (acc + L) % 40;
  }
}

// ---- 等距线工具（主航道 SDF）----
function contourSdf(level, f = sdIn.sMain) {
  // 在内圈网格上用 marching squares 求距离场的等值线（默认主航道）
  const g = gIn;
  const nx = g.nx;
  const nz = g.nz;
  const segs = [];
  const P2 = (i, j) => [g.x0 + (i + 0.5) * g.cs, g.z0 + (j + 0.5) * g.cs];
  const lerpP = (i0, j0, i1, j1) => {
    const a = f[j0 * nx + i0] - level;
    const b = f[j1 * nx + i1] - level;
    const t = a / (a - b);
    const p0 = P2(i0, j0);
    const p1 = P2(i1, j1);
    return [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
  };
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = f[j * nx + i] > level;
      const b = f[j * nx + i + 1] > level;
      const c = f[(j + 1) * nx + i + 1] > level;
      const d = f[(j + 1) * nx + i] > level;
      const E = [];
      if (a !== b) E.push(lerpP(i, j, i + 1, j));
      if (b !== c) E.push(lerpP(i + 1, j, i + 1, j + 1));
      if (c !== d) E.push(lerpP(i, j + 1, i + 1, j + 1));
      if (d !== a) E.push(lerpP(i, j, i, j + 1));
      if (E.length === 2) segs.push(E);
      else if (E.length === 4) segs.push([E[0], E[1]], [E[2], E[3]]);
    }
  }
  // 串接
  const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const adj = new Map();
  for (const s of segs) {
    for (const [p, q] of [[s[0], s[1]], [s[1], s[0]]]) {
      const k = key(p);
      if (!adj.has(k)) adj.set(k, []);
      adj.get(k).push(q);
    }
  }
  const used = new Set();
  const lines = [];
  for (const s of segs) {
    const k0 = key(s[0]) + '|' + key(s[1]);
    if (used.has(k0)) continue;
    const line = [s[0], s[1]];
    used.add(k0);
    used.add(key(s[1]) + '|' + key(s[0]));
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = line[line.length - 1];
        const nb = (adj.get(key(end)) || []).find((q) => !used.has(key(end) + '|' + key(q)));
        if (!nb) break;
        used.add(key(end) + '|' + key(nb));
        used.add(key(nb) + '|' + key(end));
        line.push(nb);
      }
      line.reverse();
    }
    if (line.length > 3) lines.push(simplify(line, level === 0 ? 0.8 : 1.2, false));
  }
  return lines;
}
function resample(pts, step) {
  const out = [];
  let next = trng.float(0, step);
  let base = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next <= base + L) {
      const t = (next - base) / (L || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      next += step;
    }
    base += L;
  }
  return out;
}

// ====================================================================================
// 8. 地块三角化
// ====================================================================================
// 老城片区：整体铺设旧麻石 / 水泥铺地（最底层）
for (const [id, b] of ZONES) {
  if (!OLD.has(id)) continue;
  ground.push({ outer: [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], holes: [], kind: GK.OLDSTONE, pri: -1, area: (b[2] - b[0]) * (b[3] - b[1]) });
}
ground.sort((p, q) => p.pri - q.pri || q.area - p.area);
let gTri = [];
let gKind = [];
for (const g of ground) {
  const contour = g.outer.map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = g.holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  let tris;
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  } catch {
    continue;
  }
  const all = [...g.outer, ...g.holes.flat()];
  for (const t of tris) {
    for (const k of t) gTri.push(+all[k][0].toFixed(2), +all[k][1].toFixed(2));
    gKind.push(g.kind);
  }
}
log('ground tris', gKind.length);

// ====================================================================================
// 8b. 地形：越秀山与北部远山；道路、建筑、补全地块、地块铺装、树木、路灯、地标与标注随地形抬升
// ====================================================================================
const TERRAIN = (() => {
  // 越秀山的山体范围：OSM 越秀公园（w255622888）、公园内山林（r12583382）
  const hillRings = [];
  for (const e of landRaw) {
    if (e.k === 'w' && e.id === 255622888 && e.g && e.g.length > 3) hillRings.push(e.g.map(P));
    if (e.k === 'r' && e.id === 12583382) for (const m of e.m || []) if (m.r === 'outer' && m.g.length > 3) hillRings.push(m.g.map(P));
  }
  const [x0, z0] = proj(113.13, 23.32);
  const [x1, z1] = proj(113.47, 23.02);
  return buildTerrain({ rawDir: RAW, hillRings, sdAll, region: { x0, z0, x1, z1 } });
})();
const HT = TERRAIN.H;
{
  // 道路：经过山地的路段按 10 m 加密后贴地
  let nDense = 0;
  for (const r of roads) {
    const out = [];
    for (let i = 0; i < r.out.length; i++) {
      const p = r.out[i];
      if (i > 0) {
        const q = r.out[i - 1];
        const n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 10);
        let hilly = false;
        for (let k = 0; k <= n && !hilly; k++) hilly = HT(q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n) > 0.02;
        if (hilly) {
          for (let k = 1; k < n; k++) {
            const t = k / n;
            out.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t, q[2] + (p[2] - q[2]) * t, 0]);
            nDense++;
          }
        }
      }
      out.push(p.slice());
    }
    for (const p of out) p[2] += HT(p[0], p[1]);
    r.out = out;
  }
  // 建筑：底部落在轮廓内最低的地面上（上坡一侧埋入地下）
  for (const B of BLD) {
    let m = Infinity;
    for (const p of B.b.outer) m = Math.min(m, HT(p[0], p[1]));
    if (m > 0.01) {
      B.base += m;
      B.h += m;
    }
  }
  for (const F of FILL) {
    const f = SCHEMA.FILL;
    let m = HT(F[f.X], F[f.Z]);
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      m = Math.min(m, HT(F[f.X] + F[f.UX] * a * F[f.W] - F[f.UZ] * b * F[f.D], F[f.Z] + F[f.UZ] * a * F[f.W] + F[f.UX] * b * F[f.D]));
    }
    F[f.Y] = m;
  }
  for (const L of trees) for (let i = 0; i < L.length; i += SCHEMA.TREE_REC.N) L[i + SCHEMA.TREE_REC.Y] = +HT(L[i], L[i + 1]).toFixed(2);
  for (let i = 0; i < lamps.length; i += SCHEMA.LAMP.N) lamps[i + SCHEMA.LAMP.Y] += HT(lamps[i], lamps[i + 2]);
  for (let i = 0; i < pools.length; i += SCHEMA.POOL.N) pools[i + SCHEMA.POOL.Y] += HT(pools[i], pools[i + 2]);
  for (const lm of landmarks) if (lm.x !== undefined) lm.y = +HT(lm.x, lm.z).toFixed(2);
  for (const w of RAILS.ways) w.ys = w.ys.map((y, i) => y + HT(w.pts[i][0], w.pts[i][1]));
  for (const c of RAILS.chains) for (const p of c.pts) p[2] += HT(p[0], p[1]);
  for (const l of LABELS) l.y += HT(l.x, l.z);
  // 地块铺装：城区范围内山地上的三角形细分到边长 30 m 以内再贴地（略抬高，避免与地形网格互相穿插）；
  // 城区以外的山地地块被远山地形遮住，不再细分
  const flat = gTri;
  const kinds = gKind;
  gTri = [];
  gKind = [];
  const onHill = (a, b, c) => {
    for (let u = 0; u <= 4; u++) for (let v = 0; v <= 4 - u; v++) {
      const w = 4 - u - v;
      if (HT((a[0] * u + b[0] * v + c[0] * w) / 4, (a[1] * u + b[1] * v + c[1] * w) / 4) > 0.02) return true;
    }
    return false;
  };
  const emit = (a, b, c, kind) => {
    for (const p of [a, b, c]) {
      const h = HT(p[0], p[1]);
      gTri.push(p[0], +(0.05 + (h > 0.02 ? h + 0.25 : 0)).toFixed(2), p[1]);
    }
    gKind.push(kind);
  };
  const split = (a, b, c, kind, depth) => {
    const e = [Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]), Math.hypot(a[0] - b[0], a[1] - b[1])];
    const m = e.indexOf(Math.max(...e));
    if (e[m] < 30 || depth > 14) return emit(a, b, c, kind);
    const [p, q, r] = m === 0 ? [a, b, c] : m === 1 ? [b, c, a] : [c, a, b];
    const mid = [(q[0] + r[0]) / 2, (q[1] + r[1]) / 2];
    // 只在仍与山地相交的子三角形上继续细分
    for (const [u, v, w] of [[p, q, mid], [p, mid, r]]) {
      if (onHill(u, v, w)) split(u, v, w, kind, depth + 1);
      else emit(u, v, w, kind);
    }
  };
  for (let t = 0; t < kinds.length; t++) {
    const a = [flat[t * 6], flat[t * 6 + 1]];
    const b = [flat[t * 6 + 2], flat[t * 6 + 3]];
    const c = [flat[t * 6 + 4], flat[t * 6 + 5]];
    if (inCity((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, 200) && onHill(a, b, c)) split(a, b, c, kinds[t], 0);
    else emit(a, b, c, kinds[t]);
  }
  log('terrain max', TERRAIN.max.toFixed(0), 'm', TERRAIN.hasDem ? '' : '（无 DEM，仅越秀山）', 'road pts +', nDense, 'ground tris', kinds.length, '→', gKind.length);
}

// ====================================================================================
// 9. 输出
// ====================================================================================
// 两个数据文件：0 = 首屏（水系、道路、建筑、地块），1 = 植被与路灯（首屏之后加载）
const FILES = [
  { name: 'guangzhou.bin', bufs: [], offset: 0 },
  { name: 'guangzhou-veg.bin', bufs: [], offset: 0 },
];
const sections = {};
const packed = {};
function addSection(name, arr, file = 0) {
  const F = FILES[file];
  const type = arr.constructor.name;
  const pad = (4 - (F.offset % 4)) % 4;
  if (pad) {
    F.bufs.push(Buffer.alloc(pad));
    F.offset += pad;
  }
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  sections[name] = { type, offset: F.offset, length: arr.length, file };
  F.bufs.push(buf);
  F.offset += buf.length;
}
// 定长记录按 schema 量化成若干分段（name.0, name.1, …），运行端还原成同样的 Float32 布局
function addPacked(name, arr, quant, N, file = 0) {
  SCHEMA.packRecords(arr, N, SCHEMA.QUANT[quant]).forEach((g, i) => addSection(`${name}.${i}`, g, file));
  packed[name] = { quant, N };
}
addSection('sdfIn', sdIn.tex);
addSection('sdfOut', sdOut.tex);
// 道路
{
  let nPts = 0;
  for (const r of roads) nPts += r.out.length;
  const meta = new Float32Array(roads.length * SCHEMA.ROAD.N);
  const pts = new Float32Array(nPts * 4);
  let k = 0;
  roads.forEach((r, i) => {
    const flags = (r.bridge ? 1 : 0) | (r.river ? 2 : 0) | (r.link ? 4 : 0) | (r.pedestrian ? 8 : 0) | (r.oneway ? 16 : 0) | (r.qilou ? 32 : 0);
    meta.set(record(SCHEMA.ROAD, { P0: k, NPTS: r.out.length, W: r.w, CLS: r.cls, LANES: r.lanesPer, FLAGS: flags, NAME: nameId(r.name), LAYER: r.layer }), i * SCHEMA.ROAD.N);
    for (const p of r.out) {
      pts.set([p[0], p[1], p[2], p[3]], k * 4);
      k++;
    }
  });
  addSection('roadMeta', meta);
  addSection('roadPts', pts);
}
// 建筑
{
  const meta = new Float32Array(BLD.length * SCHEMA.BLD.N);
  let nRings = 0;
  let nPts = 0;
  for (const B of BLD) {
    nRings += 1 + B.b.holes.length;
    nPts += B.b.outer.length + B.b.holes.reduce((s, h) => s + h.length, 0);
  }
  const rings = new Uint32Array(nRings * 2);
  const pts = new Float32Array(nPts * 2);
  let ri = 0;
  let pi = 0;
  BLD.forEach((B, i) => {
    const rs = [B.b.outer, ...B.b.holes];
    const mr = minRect(B.b.outer) || { cx: B.b.c[0], cz: B.b.c[1], w: 10, d: 10, ux: 1, uz: 0 };
    meta.set(
      record(SCHEMA.BLD, {
        RING0: ri, NRINGS: rs.length, BASE: B.base, TOP: B.h, STYLE: B.style, FLOOR_H: B.floorH, CELL_W: B.cellW, LIT: B.lit, P1: B.p1, P2: B.p2, LED: B.led,
        COL_A: B.colA, COL_B: B.colB, SEED: B.seed, ROOF: B.roof, FLAGS: B.flags, CX: mr.cx, CZ: mr.cz, W: mr.w, D: mr.d, UX: mr.ux, UZ: mr.uz, AREA: B.b.a,
        ZONE: ZONE_IDS.indexOf(zoneAt(B.b.c[0], B.b.c[1])),
      }),
      i * SCHEMA.BLD.N,
    );
    for (const ring of rs) {
      rings[ri * 2] = pi;
      rings[ri * 2 + 1] = ring.length;
      ri++;
      for (const p of ring) {
        pts[pi * 2] = p[0];
        pts[pi * 2 + 1] = p[1];
        pi++;
      }
    }
  });
  addSection('bldMeta', meta);
  addSection('bldRings', rings);
  addSection('bldPts', pts);
  addSection('qilouEdges', new Uint32Array(qEdges));
  addPacked('fill', FILL.flat(), 'fill', SCHEMA.FILL.N);
}
addSection('groundTri', new Float32Array(gTri));
addSection('groundKind', new Uint8Array(gKind));
addSection('terrain', TERRAIN.grid.data);
// 铁路
{
  const meta = [];
  const pts = [];
  for (const w of RAILS.ways) {
    meta.push(...record(SCHEMA.RAIL, { P0: pts.length / 3, NPTS: w.pts.length, KIND: w.kind, BRIDGE: w.bridge ? 1 : 0 }));
    w.pts.forEach((p, i) => pts.push(+p[0].toFixed(2), +w.ys[i].toFixed(2), +p[1].toFixed(2)));
  }
  addSection('railMeta', new Float32Array(meta));
  addSection('railPts', new Float32Array(pts));
  const cm = [];
  const cp = [];
  for (const c of RAILS.chains) {
    cm.push(...record(SCHEMA.CHAIN, { P0: cp.length / 3, NPTS: c.pts.length, KIND: c.kind }));
    for (const p of c.pts) cp.push(+p[0].toFixed(2), +p[2].toFixed(2), +p[1].toFixed(2));
  }
  addSection('trainMeta', new Float32Array(cm));
  addSection('trainPts', new Float32Array(cp));
}
for (let s = 0; s < 5; s++) addPacked(`trees${s}`, trees[s], 'tree', SCHEMA.TREE_REC.N, 1);
addPacked('lamps', lamps, 'lamp', SCHEMA.LAMP.N, 1);
// 珠江游船航线：沿前航道逐列追踪深水区间中线（白鹅潭 → 琶洲）
{
  const track = (x0, x1, dir, start) => {
    const out = [];
    let zc = start;
    for (let x = x0; dir > 0 ? x <= x1 : x >= x1; x += 30 * dir) {
      const iv = [];
      let cur = null;
      for (let z = zc - 600; z <= zc + 600; z += 5) {
        if (sdMain(x, z) < -14) {
          if (!cur) cur = [z, z];
          else cur[1] = z;
        } else if (cur) {
          iv.push(cur);
          cur = null;
        }
      }
      if (cur) iv.push(cur);
      if (!iv.length) break;
      iv.sort((a, b) => Math.abs((a[0] + a[1]) / 2 - zc) - Math.abs((b[0] + b[1]) / 2 - zc));
      const best = iv[0];
      const c = (best[0] + best[1]) / 2;
      if (Math.abs(c - zc) > 120) break;
      zc = zc * 0.3 + c * 0.7;
      out.push([x, zc, (best[1] - best[0]) / 2]);
    }
    return out;
  };
  const [sx, sz0] = proj(113.275, 23.112);
  let sz = sz0;
  {
    let best = 1e9;
    for (let z = sz0 - 800; z <= sz0 + 800; z += 4) {
      const d = sdMain(sx, z);
      if (d < best) {
        best = d;
        sz = z;
      }
    }
  }
  const [wx] = proj(113.2385, 23.1);
  const [ex] = proj(113.385, 23.1);
  const west = track(sx, wx, -1, sz).reverse();
  const east = track(sx + 30, ex, 1, sz);
  const route = [...west, ...east];
  const flat = [];
  for (let i = 0; i < route.length; i++) {
    // 平滑
    let x = 0;
    let z = 0;
    let h = 0;
    let n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(route.length - 1, i + 3); k++) {
      x += route[k][0];
      z += route[k][1];
      h += route[k][2];
      n++;
    }
    flat.push(+(x / n).toFixed(1), +(z / n).toFixed(1), +(h / n).toFixed(1));
  }
  addSection('river', new Float32Array(flat));
  log('river route', route.length);
}
// 江岸线（全部水域的 0 等值线），供堤岸与栏杆
{
  const lines = contourSdf(0, sdIn.sAll).filter((l) => l.some((p) => inCity(p[0], p[1], 300)));
  const flat = [];
  for (const l of lines) {
    flat.push(l.length);
    for (const p of l) flat.push(+p[0].toFixed(2), +p[1].toFixed(2));
  }
  addSection('banks', new Float32Array(flat));
  log('bank lines', lines.length);
}
addPacked('pools', pools, 'pool', SCHEMA.POOL.N, 1);

const header = {
  version: 1,
  source: 'OpenStreetMap contributors (ODbL) · Overpass API',
  osmTimestamp: load('roads.json').ts,
  origin: { lon: LON0, lat: LAT0, kx: KX, kz: KZ },
  city: CITY,
  sdfIn: { x0: gIn.x0, z0: gIn.z0, cs: gIn.cs, nx: gIn.nx, nz: gIn.nz },
  sdfOut: { x0: gOut.x0, z0: gOut.z0, cs: gOut.cs, nx: gOut.nx, nz: gOut.nz },
  roadNames: names,
  bridges,
  landmarks,
  labels: LABELS,
  zones: ZONE_IDS,
  stats: { fill: FILL.length, buildings: BLD.length, qilou: nQilou, tall: nTall, trees: nTrees, roads: roads.length, roadKm: Math.round(roads.reduce((s, r) => s + r.len, 0) / 1000), lamps: lamps.length / 6 },
  terrain: { x0: TERRAIN.grid.x0, z0: TERRAIN.grid.z0, cs: TERRAIN.grid.cs, nx: TERRAIN.grid.nx, nz: TERRAIN.grid.nz },
  sections,
  packed,
};
// 数据文件以 gzip 形式写出，浏览器端用 DecompressionStream 自行解压：不依赖服务器的 Content-Encoding，
// GitHub Pages 这类纯静态托管也只需下载压缩后的体积。gzip 头的操作系统字节固定，保证跨平台逐字节一致。
fs.mkdirSync(OUT_DIR, { recursive: true });
const gzip = (buf) => {
  const gz = zlib.gzipSync(buf, { level: 9, memLevel: 9 });
  gz[9] = 255;
  return gz;
};
let rawSize = 0;
let gzSize = 0;
header.files = [];
for (const F of FILES) {
  const buf = Buffer.concat(F.bufs);
  const gz = gzip(buf);
  fs.writeFileSync(OUT_DIR + F.name + '.gz', gz);
  header.files.push({ name: F.name + '.gz', size: gz.length, raw: buf.length });
  rawSize += buf.length;
  gzSize += gz.length;
}
fs.writeFileSync(OUT_DIR + 'guangzhou.json', JSON.stringify(header));
log('wrote', (rawSize / 1048576).toFixed(1), 'MB（gzip', (gzSize / 1048576).toFixed(1), 'MB）', JSON.stringify(header.stats));

// ====================================================================================
// 调试图
// ====================================================================================
if (DEBUG) {
  const cs = 8;
  const W = Math.ceil((CITY.x1 - CITY.x0) / cs);
  const H = Math.ceil((CITY.z1 - CITY.z0) / cs);
  const img = new Uint8Array(W * H * 3);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = CITY.x0 + (i + 0.5) * cs;
    const z = CITY.z0 + (j + 0.5) * cs;
    const k = (j * W + i) * 3;
    const s = sdAll(x, z);
    const m = sdMain(x, z);
    if (s < 0) img.set(m < 0 ? [40, 90, 110] : [60, 120, 150], k);
    else img.set([38, 40, 38], k);
  }
  const plot = (x, z, c) => {
    const i = Math.floor((x - CITY.x0) / cs);
    const j = Math.floor((z - CITY.z0) / cs);
    if (i >= 0 && j >= 0 && i < W && j < H) img.set(c, (j * W + i) * 3);
  };
  for (const g of ground) {
    const c = g.kind === GK.GARDEN || g.kind === GK.GRASS ? [50, 100, 55] : g.kind === GK.FOREST ? [35, 75, 40] : null;
    if (!c) continue;
    const [x0, z0, x1, z1] = bbox(g.outer);
    for (let x = x0; x < x1; x += cs) for (let z = z0; z < z1; z += cs) if (pointInRing(x, z, g.outer)) plot(x, z, c);
  }
  for (const r of roads) {
    const c = r.bridge ? [255, 120, 200] : r.qilou ? [255, 150, 60] : r.cls === RC.LANE ? [110, 110, 110] : [200, 200, 200];
    for (let i = 0; i < r.out.length - 1; i++) {
      const a = r.out[i];
      const b = r.out[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= L; t += cs * 0.5) plot(a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L, c);
    }
  }
  for (const B of BLD) {
    const v = Math.min(255, 90 + B.h * 0.8);
    const c = B.style === ST.QILOU ? [255, 170, 60] : B.style === ST.CURTAIN ? [120, 170, 255] : B.style === ST.VILLAGE ? [220, 120, 120] : [v, v, v * 0.92];
    const [x0, z0, x1, z1] = B.b.bb;
    for (let x = x0; x < x1; x += cs) for (let z = z0; z < z1; z += cs) if (pointInRing(x, z, B.b.outer)) plot(x, z, c);
  }
  for (const F of FILL) {
    const c = F[7] === ST.QILOU ? [255, 200, 90] : F[7] === ST.BRICK ? [150, 150, 130] : [170, 130, 200];
    for (let a = -F[4] / 2; a <= F[4] / 2; a += cs * 0.5) for (let b = -F[5] / 2; b <= F[5] / 2; b += cs * 0.5) plot(F[0] + F[2] * a - F[3] * b, F[1] + F[3] * a + F[2] * b, c);
  }
  for (const br of bridges) {
    const L = Math.hypot(br.b[0] - br.a[0], br.b[1] - br.a[1]);
    for (let t = 0; t <= L; t += 2) plot(br.a[0] + ((br.b[0] - br.a[0]) * t) / L, br.a[1] + ((br.b[1] - br.a[1]) * t) / L, [255, 220, 80]);
  }
  writePNG('data/raw/debug-map.png', W, H, img);
  log('debug map', W, H);
}
void KZ;
void LAT0;
