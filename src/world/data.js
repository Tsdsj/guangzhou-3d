// 城市数据加载：data/guangzhou.json（元数据）+ guangzhou.bin（首屏：水系、道路、建筑、地块）
// + guangzhou-veg.bin（树木、路灯、灯光投影，首屏数据到齐后再下载，D.vegReady 完成时可用）。
// 数据由 tools/build-city.mjs 从 OpenStreetMap 离线构建（© OpenStreetMap contributors, ODbL）。

import { QUANT, unpackRecords, BLD, FILL, ROAD, RAIL, CHAIN } from './schema.js';

const TYPES = { Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array, Int16Array, Int8Array };

export async function loadCity(onProgress) {
  const meta = await fetch('./data/guangzhou.json').then((r) => r.json());
  const files = meta.files;
  const S = {};
  addSections(meta, S, 0, await fetchData(files[0], onProgress));
  const D = decode(meta, S);
  D.vegReady = fetchData(files[1]).then((bin) => {
    addSections(meta, S, 1, bin);
    decodeVeg(D);
    return D;
  });
  return D;
}

// 取出属于第 file 个数据文件的分段；量化分段（name.0, name.1, …）还原成定长 Float32 记录
function addSections(meta, S, file, bin) {
  for (const [name, s] of Object.entries(meta.sections)) if ((s.file || 0) === file) S[name] = new TYPES[s.type](bin, s.offset, s.length);
  for (const [name, p] of Object.entries(meta.packed || {})) {
    if (!S[`${name}.0`] || S[name]) continue;
    const spec = QUANT[p.quant];
    S[name] = unpackRecords(spec.map((_, g) => S[`${name}.${g}`]), p.N, spec);
  }
}

// 数据文件是 gzip 压缩的 .gz，在浏览器里用 DecompressionStream 解压，因此任何静态托管都只传输压缩体积。
// 进度按已收到的字节数 / 压缩大小计算。若托管方自作主张以 Content-Encoding 发送（浏览器已解压），
// 收到的就不再以 gzip 魔数开头，直接使用。
async function fetchData(f, onProgress) {
  const r = await fetch(`./data/${f.name}`);
  if (!r.ok) throw new Error(`${f.name}: HTTP ${r.status}`);
  const chunks = [];
  let got = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(1, got / f.size));
  }
  const blob = new Blob(chunks);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return blob.arrayBuffer();
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

export const RC = { ARTERIAL: 0, SECONDARY: 1, STREET: 2, LANE: 3, ONEWAY: 6, EXPRESS: 7 };
export const RF = { BRIDGE: 1, RIVER: 2, LINK: 4, PED: 8, ONEWAY: 16, QILOU: 32 };

function decode(meta, S) {
  // 道路
  const roads = [];
  const rm = S.roadMeta;
  const rp = S.roadPts;
  for (let i = 0; i < rm.length / ROAD.N; i++) {
    const o = i * ROAD.N;
    const p0 = rm[o + ROAD.P0];
    const n = rm[o + ROAD.NPTS];
    const pts = [];
    const ys = [];
    let maxY = 0;
    for (let k = 0; k < n; k++) {
      const q = (p0 + k) * 4;
      pts.push([rp[q], rp[q + 1], rp[q + 3]]);
      ys.push(rp[q + 2]);
      if (rp[q + 2] > maxY) maxY = rp[q + 2];
    }
    const flags = rm[o + ROAD.FLAGS];
    roads.push({
      pts,
      ys,
      maxY,
      w: rm[o + ROAD.W],
      cls: rm[o + ROAD.CLS],
      lanes: rm[o + ROAD.LANES],
      flags,
      bridge: !!(flags & RF.BRIDGE),
      river: !!(flags & RF.RIVER),
      oneway: !!(flags & RF.ONEWAY),
      ped: !!(flags & RF.PED),
      qilou: !!(flags & RF.QILOU),
      name: rm[o + ROAD.NAME] >= 0 ? meta.roadNames[rm[o + ROAD.NAME]] : '',
    });
  }
  // 江岸线
  const banks = [];
  {
    const b = S.banks;
    let k = 0;
    while (k < b.length) {
      const n = b[k++];
      const l = [];
      for (let i = 0; i < n; i++) l.push([b[k + i * 2], b[k + i * 2 + 1]]);
      k += n * 2;
      banks.push(l);
    }
  }
  // 铁路股道与列车线路：点为 [x, y, z]
  const polyOf = (m, pts, o, F) => {
    const out = [];
    for (let k = 0; k < m[o + F.NPTS]; k++) {
      const q = (m[o + F.P0] + k) * 3;
      out.push([pts[q], pts[q + 1], pts[q + 2]]);
    }
    return out;
  };
  const rails = [];
  if (S.railMeta) for (let o = 0; o < S.railMeta.length; o += RAIL.N) rails.push({ pts: polyOf(S.railMeta, S.railPts, o, RAIL), kind: S.railMeta[o + RAIL.KIND], bridge: !!S.railMeta[o + RAIL.BRIDGE] });
  const trains = [];
  if (S.trainMeta) for (let o = 0; o < S.trainMeta.length; o += CHAIN.N) trains.push({ pts: polyOf(S.trainMeta, S.trainPts, o, CHAIN), kind: S.trainMeta[o + CHAIN.KIND] });
  return {
    meta,
    S,
    roads,
    rails,
    trains,
    banks,
    nBuildings: S.bldMeta.length / BLD.N,
    nFill: S.fill.length / FILL.N,
    bridges: meta.bridges,
    landmarks: meta.landmarks,
    labels: meta.labels,
    city: meta.city,
    trees: null,
    lamps: null,
    pools: null,
  };
}

function decodeVeg(D) {
  const S = D.S;
  D.trees = [0, 1, 2, 3, 4].map((k) => S[`trees${k}`]);
  D.lamps = S.lamps;
  D.pools = S.pools;
  return D;
}
