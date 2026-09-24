// 铁路与地面 / 高架轨道交通（OSM railway：rail、light_rail、subway、tram；不含隧道段）。
// 每条 OSM 线路是一股道。桥梁 / 高架段按 layer 抬升，跨珠江时不低于通航净空；与之相连的地面段在两端
// 做 300 m 以内的坡道。另外把干线按端点串成长链，供运行端行驶列车。

export const RAIL_KIND = { MAIN: 0, YARD: 1, METRO: 2, TRAM: 3 };

export function buildRails({ misc, P, sdMain, inCity }) {
  const ways = [];
  for (const e of misc) {
    const t = e.t;
    if (e.k !== 'w' || !e.g || e.g.length < 2) continue;
    const rw = t.railway;
    if (rw !== 'rail' && rw !== 'light_rail' && rw !== 'subway' && rw !== 'tram') continue;
    if (t.tunnel || t.covered === 'yes' || +(t.layer || 0) < 0 || t.location === 'underground') continue;
    const pts = e.g.map(P);
    if (!pts.some((p) => inCity(p[0], p[1], 400))) continue;
    const kind =
      rw === 'tram' || rw === 'light_rail' ? RAIL_KIND.TRAM : rw === 'subway' ? RAIL_KIND.METRO : t.service === 'yard' || t.service === 'siding' || t.service === 'spur' || t.service === 'crossover' ? RAIL_KIND.YARD : RAIL_KIND.MAIN;
    const bridge = !!t.bridge && t.bridge !== 'no';
    const keys = e.g.map((p) => `${p[0]},${p[1]}`);
    ways.push({ pts, keys, kind, bridge, layer: Math.max(1, +(t.layer || 1)), name: t.name || '', electrified: !!t.electrified && t.electrified !== 'no' });
  }
  // 桥面高度：按 layer，跨越珠江主航道时不低于 12 m
  for (const w of ways) {
    if (!w.bridge) continue;
    let h = w.layer * 6.6;
    if (w.pts.some((p) => sdMain(p[0], p[1]) < 0)) h = Math.max(h, 12);
    w.h = h;
  }
  // 节点高度：与桥相连的节点取桥面高度
  const nodeH = new Map();
  for (const w of ways) if (w.bridge) for (const k of w.keys) nodeH.set(k, Math.max(nodeH.get(k) || 0, w.h));
  for (const w of ways) {
    const n = w.pts.length;
    const s = [0];
    for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]));
    w.len = s[n - 1];
    if (w.bridge) {
      w.ys = w.pts.map(() => w.h);
      continue;
    }
    // 地面段：两端若连着桥，在 300 m 内坡降到地面
    const h0 = nodeH.get(w.keys[0]) || 0;
    const h1 = nodeH.get(w.keys[n - 1]) || 0;
    const R = Math.min(300, w.len);
    w.ys = s.map((d) => Math.max(h0 * Math.max(0, 1 - d / R), h1 * Math.max(0, 1 - (w.len - d) / R)));
  }
  // 干线串链：同类（干线 / 地铁 / 有轨电车）按共用端点连接，得到尽量长的连续线路
  const chains = [];
  for (const kind of [RAIL_KIND.MAIN, RAIL_KIND.METRO, RAIL_KIND.TRAM]) {
    const list = ways.filter((w) => w.kind === kind);
    const byEnd = new Map();
    list.forEach((w, i) => {
      for (const k of [w.keys[0], w.keys[w.keys.length - 1]]) {
        if (!byEnd.has(k)) byEnd.set(k, []);
        byEnd.get(k).push(i);
      }
    });
    const used = new Set();
    const order = list.map((w, i) => i).sort((a, b) => list[b].len - list[a].len);
    for (const start of order) {
      if (used.has(start)) continue;
      used.add(start);
      let pts = list[start].pts.map((p, i) => [p[0], p[1], list[start].ys[i]]);
      let head = list[start].keys[0];
      let tail = list[start].keys[list[start].keys.length - 1];
      for (const dir of ['tail', 'head']) {
        for (;;) {
          const at = dir === 'tail' ? tail : head;
          const next = (byEnd.get(at) || []).find((i) => !used.has(i));
          if (next === undefined) break;
          used.add(next);
          const w = list[next];
          let seg = w.pts.map((p, i) => [p[0], p[1], w.ys[i]]);
          let ks = w.keys;
          if ((dir === 'tail' && ks[0] !== at) || (dir === 'head' && ks[ks.length - 1] !== at)) {
            seg = seg.reverse();
            ks = ks.slice().reverse();
          }
          if (dir === 'tail') {
            pts = pts.concat(seg.slice(1));
            tail = ks[ks.length - 1];
          } else {
            pts = seg.slice(0, -1).concat(pts);
            head = ks[0];
          }
        }
      }
      let L = 0;
      for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (L > (kind === RAIL_KIND.MAIN ? 1500 : 800)) chains.push({ kind, pts, len: L });
    }
  }
  return { ways, chains };
}
