// 车流：沿真实道路的车道展开（单行路只有顺行车道，双向路靠右行驶），高架与跨江桥按纵断面行驶。
// 车辆沿整条车道折线连续前进，同一车道同速、间距均匀；桥梁、高架与主干道优先分配车辆。

import { RNG } from '../core/rng.js';
import { RC } from './data.js';

const CAR_COLORS = 10;
const MAX = 7000;

function offsetLine(pts, ys, o) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    let m = 1;
    if (i > 0 && i < n - 1) {
      const d0x = pts[i][0] - pts[i - 1][0];
      const d0z = pts[i][1] - pts[i - 1][1];
      const l0 = Math.hypot(d0x, d0z) || 1;
      m = 1 / Math.max(0.55, -tz * (-d0z / l0) + tx * (d0x / l0));
    }
    out.push([pts[i][0] - tz * o * m, ys[i], pts[i][1] + tx * o * m]);
  }
  return out;
}

export function buildTraffic(D, density = 0.55) {
  const rng = new RNG(20260924);
  const t = density;
  const perKm = 30 * (t * t * 0.4 + t * 0.6);
  const lanes = [];
  for (const r of D.roads) {
    if (r.cls === RC.LANE || r.ped) continue;
    const P = r.pts;
    if (P.length < 2) continue;
    let len = 0;
    for (let i = 1; i < P.length; i++) len += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    if (len < 30) continue;
    const mid = P[Math.floor(P.length / 2)];
    const inCity = D.geo.inCity(mid[0], mid[1], 0);
    const ys = r.ys.map((y) => y + (r.bridge ? 0.14 : 0.08));
    const prio = r.bridge ? 0 : r.cls === RC.ARTERIAL || r.cls === RC.EXPRESS || r.cls === RC.ONEWAY ? 1 : r.cls === RC.SECONDARY ? 2 : 3;
    const speed = r.cls === RC.EXPRESS ? 19 : r.cls === RC.ARTERIAL || r.cls === RC.ONEWAY ? 13 : r.cls === RC.SECONDARY ? 11 : 8;
    const heavy = r.cls !== RC.STREET;
    const nL = Math.max(1, Math.round(r.lanes));
    if (r.oneway) {
      const lw = (r.w - 1.2) / nL;
      for (let l = 0; l < nL; l++) {
        const o = -r.w / 2 + 0.6 + (l + 0.5) * lw;
        lanes.push({ pts: offsetLine(P, ys, o), speed: speed * (1 - l * 0.06), prio: inCity ? prio : prio + 2, len, heavy });
      }
    } else {
      const med = r.cls === RC.ARTERIAL ? 1.6 : 0;
      const lw = (r.w / 2 - med - 0.6) / nL;
      const revP = P.slice().reverse();
      const revY = ys.slice().reverse();
      for (let l = 0; l < nL; l++) {
        const o = med + (l + 0.5) * lw;
        const sp = speed * (1 - l * 0.06);
        lanes.push({ pts: offsetLine(P, ys, o), speed: sp, prio: inCity ? prio : prio + 2, len, heavy });
        lanes.push({ pts: offsetLine(revP, revY, o), speed: sp, prio: inCity ? prio : prio + 2, len, heavy });
      }
    }
  }
  lanes.sort((p, q) => p.prio - q.prio);
  const weight = (pr) => (pr === 0 ? 1.5 : pr === 1 ? 1.1 : pr === 2 ? 0.75 : pr === 3 ? 0.35 : 0.15);
  let exp = 0;
  for (const l of lanes) exp += (l.len / 1000) * perKm * weight(l.prio);
  const k = exp > MAX ? MAX / exp : 1;
  let nPts = 0;
  for (const l of lanes) nPts += l.pts.length;
  const pts = new Float32Array(nPts * 3);
  const cum = new Float32Array(nPts);
  const laneOff = new Int32Array(lanes.length);
  const laneN = new Int32Array(lanes.length);
  const laneLen = new Float32Array(lanes.length);
  const cars = [];
  let o = 0;
  let n = 0;
  lanes.forEach((l, li) => {
    laneOff[li] = o;
    laneN[li] = l.pts.length;
    let s = 0;
    for (let i = 0; i < l.pts.length; i++) {
      const p = l.pts[i];
      if (i > 0) s += Math.hypot(p[0] - l.pts[i - 1][0], p[1] - l.pts[i - 1][1], p[2] - l.pts[i - 1][2]);
      pts[(o + i) * 3] = p[0];
      pts[(o + i) * 3 + 1] = p[1];
      pts[(o + i) * 3 + 2] = p[2];
      cum[o + i] = s;
    }
    laneLen[li] = s;
    o += l.pts.length;
    if (n >= MAX) return;
    const e = (l.len / 1000) * perKm * weight(l.prio) * k;
    let c = Math.floor(e);
    if (rng.next() < e - c) c++;
    c = Math.min(c, Math.floor(s / 16), MAX - n);
    if (c <= 0) return;
    const v = l.speed * rng.float(0.85, 1.15);
    const ph = rng.next();
    for (let i = 0; i < c; i++) {
      const kind = l.heavy ? rng.pickW([0, 1, 2, 3], [70, 18, 5, 7]) : rng.pickW([0, 1, 3], [74, 22, 4]);
      const pos = ((i + ph + (rng.next() - 0.5) * 0.45) / c) * s;
      cars.push(li, ((pos % s) + s) % s, v, Math.floor(rng.next() * CAR_COLORS), kind);
      n++;
    }
  });
  return { pts, cum, laneOff, laneN, laneLen, cars: new Float32Array(cars), count: n };
}

// 行人：步行街、骑楼廊下与珠江滨江步道上的人流（双向，约 1.1–1.5 m/s）
export function buildWalkers(D) {
  const rng = new RNG(8802);
  const lanes = [];
  const push = (pts, ys, o, spacing) => {
    lanes.push({ pts: offsetLine(pts, ys, o), spacing });
    const rp = pts.slice().reverse();
    lanes.push({ pts: offsetLine(rp, ys.slice().reverse(), o), spacing });
  };
  for (const r of D.roads) {
    if (r.bridge) continue;
    const mid = r.pts[Math.floor(r.pts.length / 2)];
    if (!D.geo.inCity(mid[0], mid[1], 0)) continue;
    const ys = r.ys.map((y) => y + 0.1);
    if (r.ped) {
      push(r.pts, ys, r.w / 2 - 1.2, 9);
      if (r.w > 6) push(r.pts, ys, r.w / 4 - 0.5, 12);
    } else if (r.qilou) push(r.pts, ys, r.w / 2 + 2.6, 11);
  }
  // 滨江步道：沿珠江岸线向陆地一侧偏移 6 m
  for (const l of D.banks) {
    if (l.length < 6) continue;
    const m = l[Math.floor(l.length / 2)];
    if (!D.geo.inCity(m[0], m[1], 0) || D.geo.sdMain(m[0], m[1]) > 4) continue;
    const pts = l.map((p) => {
      const e = 3;
      let gx = D.geo.sdAll(p[0] + e, p[1]) - D.geo.sdAll(p[0] - e, p[1]);
      let gz = D.geo.sdAll(p[0], p[1] + e) - D.geo.sdAll(p[0], p[1] - e);
      const gl = Math.hypot(gx, gz) || 1;
      gx /= gl;
      gz /= gl;
      return [p[0] + gx * 6, p[1] + gz * 6];
    });
    push(pts, pts.map(() => 0.1), 0.8, 22);
  }
  let nPts = 0;
  for (const l of lanes) nPts += l.pts.length;
  const pts = new Float32Array(nPts * 3);
  const cum = new Float32Array(nPts);
  const laneOff = new Int32Array(lanes.length);
  const laneN = new Int32Array(lanes.length);
  const laneLen = new Float32Array(lanes.length);
  const cars = [];
  let o = 0;
  let n = 0;
  const MAXP = 9000;
  lanes.forEach((l, li) => {
    laneOff[li] = o;
    laneN[li] = l.pts.length;
    let s = 0;
    for (let i = 0; i < l.pts.length; i++) {
      const p = l.pts[i];
      if (i > 0) s += Math.hypot(p[0] - l.pts[i - 1][0], p[2] - l.pts[i - 1][2]);
      pts[(o + i) * 3] = p[0];
      pts[(o + i) * 3 + 1] = p[1];
      pts[(o + i) * 3 + 2] = p[2];
      cum[o + i] = s;
    }
    laneLen[li] = s;
    o += l.pts.length;
    if (s < 8 || n >= MAXP) return;
    const c = Math.min(MAXP - n, Math.max(1, Math.floor(s / (l.spacing * rng.float(0.7, 1.3)))));
    for (let i = 0; i < c; i++) {
      // 行人各自速度不同，但同一车道的错位足以避免明显重叠
      const kind = rng.pickW([0, 1, 2], [70, 18, 12]);
      cars.push(li, rng.next() * s, rng.float(1.05, 1.5) * (kind === 2 ? 0.85 : 1), Math.floor(rng.next() * 10), kind);
      n++;
    }
  });
  return { pts, cum, laneOff, laneN, laneLen, cars: new Float32Array(cars), count: n };
}
