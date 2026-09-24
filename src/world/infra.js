// 道路与桥梁：真实路网条带（按等级 / 车道 / 单行渲染标线）、高架与匝道（箱梁、防撞墙、簕杜鹃花槽、桥墩、灯带）、
// 珠江上的真实跨江桥（按实际结构类型：海印桥双塔单索面斜拉、猎德桥贝壳塔自锚悬索、海珠桥三跨钢拱、
// 解放大桥钢管拱、琶洲大桥 V 撑刚构、其余连续梁），以及海心桥。

import * as THREE from 'three';
import { GB } from '../scene/geometries.js';
import { makeGlowMaterial, makeRoadMaterial } from '../scene/materials.js';
import { WATER_Y } from './geo.js';
import { RC } from './data.js';

// ---------- 条带几何（索引四边形，法线朝上）----------
// roads: [{ pts: [[x, z, clear]], w, code, ys?: number[] }]
export function ribbon(roads, y0 = 0.08, deck = false) {
  let nq = 0;
  for (const r of roads) nq += Math.max(0, r.pts.length - 1);
  const pos = new Float32Array(nq * 4 * 3);
  const aRoad = new Float32Array(nq * 4 * 4);
  const aClr = new Float32Array(nq * 4 * 3);
  const idx = new Uint32Array(nq * 6);
  let k = 0;
  let q = 0;
  for (const r of roads) {
    const pts = r.pts;
    const n = pts.length;
    if (n < 2) continue;
    const hw = r.w / 2;
    const offs = [];
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
      offs.push([-tz * m, tx * m]);
    }
    let u = 0;
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const ya = r.ys ? r.ys[i] : y0;
      const yb = r.ys ? r.ys[i + 1] : y0;
      const cS = deck ? -1e6 : u + Math.max(0, a[2] || 0);
      const cE = deck ? 1e6 : u + L - Math.max(0, b[2] || 0);
      const jf = deck ? 0 : ((a[2] || 0) > 0 ? 1 : 0) + ((b[2] || 0) > 0 ? 2 : 0);
      const V = [
        [a[0] - offs[i][0] * hw, ya, a[1] - offs[i][1] * hw, u, -hw],
        [a[0] + offs[i][0] * hw, ya, a[1] + offs[i][1] * hw, u, hw],
        [b[0] + offs[i + 1][0] * hw, yb, b[1] + offs[i + 1][1] * hw, u + L, hw],
        [b[0] - offs[i + 1][0] * hw, yb, b[1] - offs[i + 1][1] * hw, u + L, -hw],
      ];
      for (const v of V) {
        pos[k * 3] = v[0];
        pos[k * 3 + 1] = v[1];
        pos[k * 3 + 2] = v[2];
        aRoad[k * 4] = v[3];
        aRoad[k * 4 + 1] = v[4];
        aRoad[k * 4 + 2] = r.w;
        aRoad[k * 4 + 3] = r.code;
        aClr[k * 3] = cS;
        aClr[k * 3 + 1] = cE;
        aClr[k * 3 + 2] = jf;
        k++;
      }
      const b0 = k - 4;
      // 朝上：A1, B2(=V[2]), B1(=V[3]) / A1, A2, B2
      idx.set([b0, b0 + 2, b0 + 3, b0, b0 + 1, b0 + 2], q * 6);
      q++;
      u += L;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
  const nor = new Int8Array(k * 3);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 127;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  g.setAttribute('aRoad', new THREE.BufferAttribute(aRoad.subarray(0, k * 4), 4));
  g.setAttribute('aClr', new THREE.BufferAttribute(aClr.subarray(0, k * 3), 3));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, q * 6), 1));
  g.computeBoundingSphere();
  return g;
}

// 道路绘制顺序：窄路先画、宽路后画（路面不写深度，重叠处由绘制顺序决定，不会闪烁）
const RANK = { [RC.LANE]: 0, [RC.STREET]: 1, [RC.SECONDARY]: 2, [RC.ONEWAY]: 3, [RC.ARTERIAL]: 4, [RC.EXPRESS]: 5 };
const TILE = 1500;

export function buildRoadMeshes(D, mats) {
  const group = new THREE.Group();
  const tiles = new Map();
  const decks = [];
  for (const r of D.roads) {
    const code = r.cls + 10 * Math.max(1, Math.round(r.lanes));
    if (r.bridge && r.maxY > 0.5) {
      decks.push({ pts: r.pts, w: r.w, code, ys: r.ys.map((y) => y + 0.14) });
      continue;
    }
    const m = r.pts[Math.floor(r.pts.length / 2)];
    const key = `${Math.floor(m[0] / TILE)},${Math.floor(m[1] / TILE)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push({ pts: r.pts, w: r.w, code, rank: RANK[r.cls] ?? 1 });
  }
  for (const [, list] of tiles) {
    list.sort((a, b) => a.rank - b.rank);
    const m = new THREE.Mesh(ribbon(list, 0.08, false), mats.road);
    m.receiveShadow = true;
    m.renderOrder = 2;
    m.layers.set(1);
    group.add(m);
  }
  if (decks.length) {
    decks.sort((a, b) => (RANK[a.code % 10] ?? 1) - (RANK[b.code % 10] ?? 1));
    const dm = new THREE.Mesh(ribbon(decks, 0, true), mats.deck);
    dm.receiveShadow = true;
    dm.layers.set(1);
    group.add(dm);
  }
  return group;
}

// ---------- 高架与匝道（按 3 km 分块，便于视锥剔除）----------
const ELEV_TILE = 3000;
export function buildElevated(D, mats) {
  const tiles = new Map();
  const tileAt = (x, z) => {
    const key = `${Math.floor(x / ELEV_TILE)},${Math.floor(z / ELEV_TILE)}`;
    if (!tiles.has(key)) tiles.set(key, { conc: new GB(), rail: new GB(), flower: new GB(), led: new GB() });
    return tiles.get(key);
  };
  for (const r of D.roads) {
    if (!r.bridge || r.river || r.maxY < 1.5) continue;
    const P = r.pts;
    const n = P.length;
    // 路径：累计弧长
    const path = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(n - 1, i + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      path.push({ x: P[i][0], z: P[i][1], y: r.ys[i] + 0.14, tx: (b[0] - a[0]) / l, tz: (b[1] - a[1]) / l, s });
    }
    const w = r.w;
    const hw = w / 2;
    for (let i = 0; i < n - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (a.y < 1.2 && b.y < 1.2) continue;
      const { conc, rail, flower, led } = tileAt((a.x + b.x) / 2, (a.z + b.z) / 2);
      const na = [-a.tz, a.tx];
      const nb = [-b.tz, b.tx];
      const Pa = (side, dy, o = hw) => [a.x + na[0] * o * side, a.y + dy, a.z + na[1] * o * side];
      const Pb = (side, dy, o = hw) => [b.x + nb[0] * o * side, b.y + dy, b.z + nb[1] * o * side];
      const th = 1.6;
      // 箱梁腹板与底板
      conc.quad(Pa(1, -th), Pb(1, -th), Pb(1, 0), Pa(1, 0));
      conc.quad(Pb(-1, -th), Pa(-1, -th), Pa(-1, 0), Pb(-1, 0));
      conc.quad(Pa(-1, -th, hw * 0.8), Pb(-1, -th, hw * 0.8), Pb(1, -th, hw * 0.8), Pa(1, -th, hw * 0.8));
      // 防撞墙
      for (const side of [-1, 1]) {
        const o = hw - 0.2;
        const q0 = [Pa(side, 0, o), Pb(side, 0, o), Pb(side, 1.05, o), Pa(side, 1.05, o)];
        if (side > 0) rail.quad(q0[1], q0[0], q0[3], q0[2]);
        else rail.quad(q0[0], q0[1], q0[2], q0[3]);
        rail.quad(Pa(side, 1.05, o), Pb(side, 1.05, o), Pb(side, 1.05, hw + 0.05), Pa(side, 1.05, hw + 0.05));
        // 外侧簕杜鹃花槽
        if (a.y > 3 && b.y > 3) {
          const o1 = hw + 0.95;
          const f = [Pa(side, -0.55, o1), Pb(side, -0.55, o1), Pb(side, 0.7, o1), Pa(side, 0.7, o1)];
          if (side > 0) flower.quad(f[0], f[1], f[2], f[3]);
          else flower.quad(f[1], f[0], f[3], f[2]);
          flower.quad(Pa(side, 0.7, hw), Pa(side, 0.7, o1), Pb(side, 0.7, o1), Pb(side, 0.7, hw));
        }
        // 夜间外侧轮廓灯带
        const L = [Pa(side, -0.35, hw + 0.06), Pb(side, -0.35, hw + 0.06), Pb(side, -0.15, hw + 0.06), Pa(side, -0.15, hw + 0.06)];
        if (side > 0) led.quad(L[0], L[1], L[2], L[3]);
        else led.quad(L[1], L[0], L[3], L[2]);
      }
    }
    // 桥墩：单柱 + 盖梁
    const total = path[n - 1].s;
    for (let s2 = 18; s2 < total - 8; s2 += 30) {
      const p = samplePath(path, s2);
      if (p.y < 4.5) continue;
      const ry = Math.atan2(-p.tz, p.tx);
      const grounded = D.geo.sdAll(p.x, p.z) > 0;
      const { conc } = tileAt(p.x, p.z);
      conc.tube([p.x, grounded ? 0 : WATER_Y - 1, p.z], [p.x, p.y - 2.2, p.z], w > 16 ? 1.5 : 1.1, w > 16 ? 1.35 : 1.0, 8);
      conc.box(p.x, p.y - 2.3, p.z, 2.4, 1.2, w * 0.82, ry);
    }
  }
  const group = new THREE.Group();
  const add = (gb, mat, cast = true) => {
    if (gb.empty) return;
    const m = new THREE.Mesh(gb.build(), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    m.layers.set(1);
    group.add(m);
  };
  const ledMat = makeGlowMaterial(0x7fb4ff, 1.1, 'elev');
  for (const t of tiles.values()) {
    add(t.conc, mats.bridgeConc);
    add(t.rail, mats.bridgeRail, false);
    add(t.flower, mats.flower, false);
    if (!t.led.empty) {
      const m = new THREE.Mesh(t.led.build(), ledMat);
      m.layers.set(1);
      group.add(m);
    }
  }
  return group;
}

function samplePath(path, s) {
  if (s <= 0) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (path[i].s >= s) {
      const a = path[i - 1];
      const b = path[i];
      const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, tx: a.tx, tz: a.tz, s, onWater: a.onWater && b.onWater };
    }
  }
  return path[path.length - 1];
}

// ---------- 跨江大桥 ----------
function straightPath(a, b, y, step = 6) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const tx = (b[0] - a[0]) / L;
  const tz = (b[1] - a[1]) / L;
  const n = Math.max(2, Math.ceil(L / step));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * L;
    out.push({ x: a[0] + tx * s, y, z: a[1] + tz * s, tx, tz, s, onWater: true });
  }
  return out;
}

function deckBody(conc, rail, led, path, w, th) {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const nx = -a.tz;
    const nz = a.tx;
    const hw = w / 2;
    const P = (p, side, dy) => [p.x + nx * hw * side, p.y + dy, p.z + nz * hw * side];
    conc.quad(P(a, 1, -th), P(b, 1, -th), P(b, 1, 0), P(a, 1, 0));
    conc.quad(P(b, -1, -th), P(a, -1, -th), P(a, -1, 0), P(b, -1, 0));
    conc.quad(P(a, -1, -th), P(b, -1, -th), P(b, 1, -th), P(a, 1, -th));
    for (const side of [-1, 1]) {
      const o = side * (hw - 0.2);
      const q = (p, dy) => [p.x + nx * o, p.y + dy, p.z + nz * o];
      if (side > 0) rail.quad(q(a, 0), q(b, 0), q(b, 1.1), q(a, 1.1));
      else rail.quad(q(b, 0), q(a, 0), q(a, 1.1), q(b, 1.1));
      const L = (p, dy) => [p.x + nx * (hw + 0.05) * side, p.y + dy, p.z + nz * (hw + 0.05) * side];
      if (side > 0) led.quad(L(a, -0.55), L(b, -0.55), L(b, -0.25), L(a, -0.25));
      else led.quad(L(b, -0.55), L(a, -0.55), L(a, -0.25), L(b, -0.25));
    }
  }
}

function pier(conc, p, w, top, bottom, twin = true) {
  const nx = -p.tz;
  const nz = p.tx;
  const ry = Math.atan2(-p.tz, p.tx);
  if (twin) {
    for (const s of [-0.3, 0.3]) conc.box(p.x + nx * w * s, (top + bottom) / 2, p.z + nz * w * s, 2.4, top - bottom, 2.4, ry);
  } else conc.box(p.x, (top + bottom) / 2, p.z, 2.8, top - bottom, w * 0.5, ry);
  conc.box(p.x, top - 0.8, p.z, 3.0, 1.6, w * 0.95, ry);
}

const PALETTE = { 海印大桥: 0x6fb7ff, 猎德大桥: 0xffd166, 海珠桥: 0xffb347, 解放大桥: 0xc77dff, 江湾大桥: 0x4dd6c4, 广州大桥: 0xff7aa2, 人民桥: 0xffd8a8, 华南大桥: 0x8fd3ff, 琶洲大桥: 0xb8f28f };

export function buildRiverBridges(D, mats) {
  const group = new THREE.Group();
  const conc = new GB();
  const rail = new GB();
  const steel = new GB();
  const cable = new GB();
  const arch = new GB();
  const leds = [];
  const lampPts = [];
  for (const br of D.bridges) {
    const deckY = br.deckH + 0.14;
    const path = straightPath(br.a, br.b, deckY);
    const total = path[path.length - 1].s;
    const w = Math.max(12, br.w);
    const ledB = new GB();
    deckBody(conc, rail, ledB, path, w, 2.2);
    leds.push({ gb: ledB, color: PALETTE[br.name] || 0xffe2b0 });
    const along = (s, lat, y) => {
      const p = samplePath(path, s);
      return [p.x - p.tz * lat, y ?? p.y, p.z + p.tx * lat];
    };
    // 江中桥墩
    const spanN = br.kind === 'liede' || br.kind === 'cable' || br.kind === 'cable1' ? 2 : br.kind === 'arch' || br.kind === 'tubearch' ? 2 : Math.max(2, Math.round(total / 85));
    for (let k = 1; k <= spanN; k++) {
      const p = samplePath(path, (total * k) / (spanN + 1));
      if (br.kind === 'vstrut') {
        // 琶洲大桥：V 形撑刚构
        for (const side of [-0.28, 0.28]) {
          const base = along(p.s, side * w, WATER_Y - 1);
          for (const dir of [-1, 1]) conc.tube(base, along(p.s + dir * 22, side * w, deckY - 2.2), 1.3, 1.1, 6);
        }
      } else pier(conc, p, w, deckY - 2.2, WATER_Y - 1, true);
    }
    // 桥面灯柱
    for (let s = 12; s < total - 12; s += 30) {
      for (const side of [-1, 1]) {
        const p = samplePath(path, s);
        const o = w / 2 - 0.5;
        lampPts.push(p.x - p.tz * o * side, p.y, p.z + p.tx * o * side, Math.atan2(p.tx * side, p.tz * side), 9, 0);
      }
    }
    const sm = total / 2;
    if (br.kind === 'cable1') {
      // 海印大桥：双塔单索面，倒 Y 形塔立于中央分隔带，扇形拉索
      const top = deckY + 57.4 - 6;
      for (const st of [total * 0.36, total * 0.64]) {
        for (const side of [-1, 1]) steel.tube(along(st, side * 5.5, WATER_Y - 1), along(st, 0, deckY + 18), 1.6, 1.3, 8);
        steel.tube(along(st, 0, deckY + 16), along(st, 0, top), 1.3, 0.9, 8);
        for (let k = 1; k <= 11; k++) {
          const ay = deckY + 24 + k * ((top - deckY - 26) / 11);
          for (const dir of [-1, 1]) cable.tube(along(st, 0, ay), along(st + dir * k * 9.5, 0, deckY + 0.4), 0.16, 0.16, 4);
        }
      }
    } else if (br.kind === 'cable') {
      const top = deckY + 72;
      for (const side of [-1, 1]) steel.tube(along(sm, side * (w / 2 + 1.6), WATER_Y - 1), along(sm, side * (w / 2 - 1.5), top), 1.5, 1.1, 8);
      for (const yy of [deckY - 2.5, deckY + 44, top - 3]) steel.tube(along(sm, -(w / 2 + 1.4), yy), along(sm, w / 2 + 1.4, yy), 0.9, 0.9, 6);
      for (const side of [-1, 1]) {
        for (let k = 1; k <= 11; k++) {
          const ay = deckY + 28 + k * 3.8;
          const lat = side * (w / 2 - 1.2);
          for (const dir of [-1, 1]) cable.tube(along(sm, lat, ay), along(sm + dir * k * 13, side * (w / 2 - 0.6)), 0.2, 0.2, 4);
        }
      }
    } else if (br.kind === 'liede') {
      // 猎德大桥：贝壳形独塔（两肢合拢）+ 中央吊索 / 主缆
      const top = deckY + 96;
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 14; i++) {
          const t = i / 14;
          pts.push(along(sm, side * (w / 2 + 1) * (1 - Math.pow(t, 1.6)) * (1 + 0.15 * Math.sin(t * Math.PI)), WATER_Y - 1 + (top - WATER_Y + 1) * t));
        }
        steel.polyTube(pts, 1.7, 8);
      }
      steel.tube(along(sm, 0, top - 2), along(sm, 0, top + 18), 1.2, 0.2, 8);
      for (const side of [-1, 1]) {
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const s = t * total;
          const d = Math.abs(s - sm) / (total / 2);
          pts.push(along(s, side * 1.2, deckY + 2 + (top - 8 - deckY) * Math.pow(1 - d, 1.8) + 6 * d * d));
        }
        cable.polyTube(pts, 0.5, 5);
        for (let i = 1; i < 24; i++) {
          const p = pts[i];
          const q = samplePath(path, (i / 24) * total);
          if (p[1] - q.y > 3) cable.tube(p, [p[0], q.y + 0.3, p[2]], 0.1, 0.1, 3);
        }
      }
    } else if (br.kind === 'arch' || br.kind === 'tubearch') {
      // 海珠桥：三跨下承式钢拱；解放大桥：三组钢管装饰拱
      const tube = br.kind === 'tubearch';
      const spans = [[0.08, 0.36, tube ? 14 : 16], [0.36, 0.64, tube ? 20 : 26], [0.64, 0.92, tube ? 14 : 16]];
      for (const [f0, f1, hgt] of spans) {
        const s0 = total * f0;
        const s1 = total * f1;
        for (const side of [-1, 1]) {
          const pts = [];
          for (let i = 0; i <= 18; i++) {
            const t = i / 18;
            const s = s0 + (s1 - s0) * t;
            const p = samplePath(path, s);
            pts.push([p.x + -p.tz * side * (w / 2 + 0.6), p.y + 4 * hgt * t * (1 - t), p.z + p.tx * side * (w / 2 + 0.6)]);
          }
          arch.polyTube(pts, tube ? 0.55 : 0.75, 6);
          for (let s = s0 + 6; s < s1 - 3; s += 6) {
            const t = (s - s0) / (s1 - s0);
            const p = samplePath(path, s);
            const a0 = [p.x + -p.tz * side * (w / 2 + 0.6), p.y, p.z + p.tx * side * (w / 2 + 0.6)];
            cable.tube(a0, [a0[0], p.y + 4 * hgt * t * (1 - t), a0[2]], 0.12, 0.12, 3);
          }
        }
        if (!tube) {
          for (let s = s0 + 10; s < s1 - 8; s += 12) {
            const t = (s - s0) / (s1 - s0);
            const hh = 4 * hgt * t * (1 - t);
            if (hh < 9) continue;
            const p = samplePath(path, s);
            arch.tube([p.x - p.tz * (w / 2 + 0.6), p.y + hh, p.z + p.tx * (w / 2 + 0.6)], [p.x + p.tz * (w / 2 + 0.6), p.y + hh, p.z - p.tx * (w / 2 + 0.6)], 0.35, 0.35, 4);
          }
        }
      }
    } else if (br.kind === 'truss') {
      // 珠江大桥：钢桁梁
      for (const side of [-1, 1]) {
        const top = [];
        for (let s = 0; s <= total; s += 8) {
          const a = along(s, side * (w / 2 + 0.4), deckY);
          const b = along(s, side * (w / 2 + 0.4), deckY + 7);
          arch.tube(a, b, 0.25, 0.25, 4);
          if (s + 8 <= total) arch.tube(a, along(s + 8, side * (w / 2 + 0.4), deckY + 7), 0.2, 0.2, 4);
          top.push(b);
        }
        arch.polyTube(top, 0.35, 4);
      }
    }
  }
  const add = (gb, mat, cast = true) => {
    if (gb.empty) return;
    const m = new THREE.Mesh(gb.build(), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    group.add(m);
  };
  add(conc, mats.bridgeConc);
  add(rail, mats.bridgeRail, false);
  add(steel, mats.bridgeSteel);
  add(arch, mats.bridgeArch);
  add(cable, mats.cable, false);
  for (const l of leds) {
    if (l.gb.empty) continue;
    group.add(new THREE.Mesh(l.gb.build(), makeGlowMaterial(l.color, 2.4, 'chase')));
  }
  return { group, lampPts };
}

// ---------- 海心桥：中轴线上的人行桥，倾斜白色钢拱 ----------
export function buildHaixin(spec, mats) {
  const group = new THREE.Group();
  const conc = new GB();
  const rail = new GB();
  const cable = new GB();
  const L = Math.hypot(spec.b[0] - spec.a[0], spec.b[1] - spec.a[1]);
  const ap = Math.min(55, L * 0.12);
  const tx = (spec.b[0] - spec.a[0]) / L;
  const tz = (spec.b[1] - spec.a[1]) / L;
  const path = [];
  const n = Math.ceil(L / 4);
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * L;
    const e = Math.min(s, L - s);
    const t = Math.max(0, Math.min(1, e / ap));
    const y = 7.5 * t * t * (3 - 2 * t);
    path.push({ x: spec.a[0] + tx * s, y, z: spec.a[1] + tz * s, tx, tz, s });
  }
  const w = Math.max(10, Math.min(16, spec.w || 12));
  const led = new GB();
  deckBody(conc, rail, led, path.filter((p) => p.y > 0.5), w, 1.4);
  const decks = [{ pts: path.map((p) => [p.x, p.z, 0]), ys: path.map((p) => p.y + 0.1), w, code: RC.LANE + 10 }];
  for (let s = 12; s < L - 12; s += 22) {
    const p = samplePath(path, s);
    if (p.y < 2.5) continue;
    pier(conc, p, w, p.y - 1.4, WATER_Y - 1, false);
  }
  const s0 = 40;
  const s1 = L - 40;
  const tilt = 0.42;
  const peak = 62;
  const pts = [];
  for (let i = 0; i <= 44; i++) {
    const t = i / 44;
    const s = s0 + (s1 - s0) * t;
    const p = samplePath(path, s);
    const hgt = 4 * peak * t * (1 - t);
    const lat = 9 + Math.sin(tilt) * hgt;
    const pt = [p.x - p.tz * lat, WATER_Y + 3 + Math.cos(tilt) * hgt, p.z + p.tx * lat];
    pts.push(pt);
    if (i % 2 === 0 && hgt > p.y + 6) cable.tube(pt, [p.x - p.tz * (w / 2), p.y + 1, p.z + p.tx * (w / 2)], 0.1, 0.1, 3);
  }
  const arcMesh = new GB();
  arcMesh.polyTube(pts, 1.4, 8);
  const m = new THREE.Mesh(arcMesh.build(), haixinArchMaterial());
  m.castShadow = true;
  group.add(m);
  for (const [gb, mat] of [[conc, mats.bridgeConc], [rail, mats.bridgeRail], [cable, mats.cable]]) {
    if (gb.empty) continue;
    const mm = new THREE.Mesh(gb.build(), mat);
    mm.castShadow = gb === conc;
    mm.receiveShadow = true;
    group.add(mm);
  }
  if (!led.empty) group.add(new THREE.Mesh(led.build(), makeGlowMaterial(0xfff1d6, 2.0, 'chase')));
  const dm = new THREE.Mesh(ribbon(decks, 0, true), mats.deck);
  dm.receiveShadow = true;
  group.add(dm);
  return group;
}

// 海心桥拱：白天白色钢构，夜间彩虹渐变灯光
function haixinArchMaterial() {
  const m = makeGlowMaterial(0xffffff, 0, 'haixin');
  m.color.set(0xf2f2ef);
  m.roughness = 0.35;
  m.metalness = 0.25;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      'totalEmissiveRadiance += uGlowC * uGlowK * uStreetOn * uLights;',
      'totalEmissiveRadiance += gzHsv(fract(vWPos.x * 0.002 + vWPos.y * 0.004 - uTime * 0.05), 0.42, 1.0) * 1.9 * uStreetOn * uLights;',
    );
  };
  m.customProgramCacheKey = () => 'gz-haixin-arch';
  return m;
}

export { makeRoadMaterial };

// ---------- 铁路：道床（碎石、轨枕、钢轨由着色器绘制）、高架段的箱梁与桥墩、干线接触网立柱 ----------
const RAIL_TILE = 3000;
export function buildRails(D, mats) {
  const group = new THREE.Group();
  const tiles = new Map();
  const tileAt = (x, z) => {
    const key = `${Math.floor(x / RAIL_TILE)},${Math.floor(z / RAIL_TILE)}`;
    if (!tiles.has(key)) tiles.set(key, { pos: [], uv: [], idx: [], conc: new GB(), pole: new GB() });
    return tiles.get(key);
  };
  const HW = 1.7; // 道床半宽
  for (const r of D.rails) {
    const P = r.pts;
    const n = P.length;
    if (n < 2) continue;
    const mid = P[Math.floor(n / 2)];
    const T = tileAt(mid[0], mid[2]);
    // 各点的水平法线（转角处按斜接补偿）
    const offs = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[2] - a[2];
      const l = Math.hypot(tx, tz) || 1;
      offs.push([-tz / l, tx / l]);
    }
    const base = T.pos.length / 3;
    let u = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) u += Math.hypot(P[i][0] - P[i - 1][0], P[i][2] - P[i - 1][2]);
      const [nx, nz] = offs[i];
      for (const side of [-1, 1]) {
        T.pos.push(P[i][0] + nx * HW * side, P[i][1] + 0.1, P[i][2] + nz * HW * side);
        T.uv.push(u, side * HW);
      }
      if (i > 0) {
        const k = base + i * 2;
        T.idx.push(k - 2, k + 1, k, k - 2, k - 1, k + 1);
      }
    }
    // 高架段：箱梁、挡墙与桥墩
    let s = 0;
    for (let i = 0; i < n - 1; i++) {
      const a = P[i];
      const b = P[i + 1];
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const ga = D.geo.height(a[0], a[2]);
      const gb = D.geo.height(b[0], b[2]);
      if (a[1] - ga > 2 && b[1] - gb > 2) {
        const [nax, naz] = offs[i];
        const [nbx, nbz] = offs[i + 1];
        const W = HW + 0.9;
        const pa = (side, dy, o = W) => [a[0] + nax * o * side, a[1] + dy, a[2] + naz * o * side];
        const pb = (side, dy, o = W) => [b[0] + nbx * o * side, b[1] + dy, b[2] + nbz * o * side];
        T.conc.quad(pa(1, -1.9), pb(1, -1.9), pb(1, 0.9), pa(1, 0.9));
        T.conc.quad(pb(-1, -1.9), pa(-1, -1.9), pa(-1, 0.9), pb(-1, 0.9));
        T.conc.quad(pa(-1, -1.9), pb(-1, -1.9), pb(1, -1.9), pa(1, -1.9));
        T.conc.quad(pa(1, 0.9, W - 0.25), pb(1, 0.9, W - 0.25), pb(1, 0.9), pa(1, 0.9));
        T.conc.quad(pb(-1, 0.9, W - 0.25), pa(-1, 0.9, W - 0.25), pa(-1, 0.9), pb(-1, 0.9));
        for (let t = (32 - (s % 32)) % 32; t < L; t += 32) {
          const f = t / L;
          const x = a[0] + (b[0] - a[0]) * f;
          const z = a[2] + (b[2] - a[2]) * f;
          const y = a[1] + (b[1] - a[1]) * f;
          const g = D.geo.sdAll(x, z) < 0 ? WATER_Y - 1 : D.geo.height(x, z);
          T.conc.tube([x, g, z], [x, y - 1.9, z], 1.0, 0.9, 6);
        }
      }
      // 干线接触网立柱：每 50 m 一根，立于道床外侧，悬臂伸向线路上方
      if (r.kind === 0) {
        const [nx, nz] = offs[i];
        for (let t = (50 - (s % 50)) % 50; t < L; t += 50) {
          const f = t / L;
          const x = a[0] + (b[0] - a[0]) * f;
          const z = a[2] + (b[2] - a[2]) * f;
          const y = a[1] + (b[1] - a[1]) * f;
          const o = HW + 0.9;
          T.pole.tube([x + nx * o, y, z + nz * o], [x + nx * o, y + 7.6, z + nz * o], 0.16, 0.13, 5);
          T.pole.tube([x + nx * o, y + 7.1, z + nz * o], [x - nx * 0.4, y + 6.9, z - nz * 0.4], 0.06, 0.05, 4);
        }
      }
      s += L;
    }
  }
  for (const T of tiles.values()) {
    if (T.idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(T.pos, 3));
      const nor = new Int8Array(T.pos.length);
      for (let i = 1; i < nor.length; i += 3) nor[i] = 127;
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
      g.setAttribute('aRail', new THREE.Float32BufferAttribute(T.uv, 2));
      g.setIndex(T.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats.rail);
      m.receiveShadow = true;
      m.renderOrder = 1;
      m.layers.set(1);
      group.add(m);
    }
    for (const [gb, mat] of [[T.conc, mats.bridgeConc], [T.pole, mats.pole]]) {
      if (gb.empty) continue;
      const m = new THREE.Mesh(gb.build(), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.layers.set(1);
      group.add(m);
    }
  }
  return group;
}
