// 视口叠加层：统计胶囊、三维地标 / 片区标注、城市小地图（真实水系、绿地、路网与建筑）、状态与提示。

import * as THREE from 'three';
import { RC } from '../world/data.js';
import { BLD, FILL } from '../world/schema.js';
import { ST } from '../world/parts.js';

const fmtN = (n) => n.toLocaleString('zh-CN');

export class Hud {
  constructor(opts) {
    this.o = opts;
    this.chips = document.getElementById('chips');
    this.labelsEl = document.getElementById('labels');
    this.mm = document.getElementById('mm-canvas');
    this.mmCtx = this.mm.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.mm.width;
    this.base.height = this.mm.height;
    this.status = document.getElementById('status');
    this.statusText = document.getElementById('status-text');
    this.toastEl = document.getElementById('toast');
    this.labels = [];
    this.v = new THREE.Vector3();
    // 统计胶囊的屏幕区域只在尺寸或内容变化时重新读取（每帧读取会强制浏览器重排）
    this.chipsR = null;
    window.addEventListener('resize', () => (this.chipsR = null));
    this.mm.addEventListener('click', (e) => {
      if (!this.map) return;
      const r = this.mm.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      this.o.onMapClick?.(this.map.x0 + u * this.map.sx, this.map.z0 + v * this.map.sz);
    });
    const legend = document.getElementById('mm-legend');
    const items = [
      ['珠江水系', '#3a7d96'],
      ['公园绿地', '#4f9a5a'],
      ['真实建筑', '#c9c4ba'],
      ['超高层', '#7fb0ff'],
      ['骑楼街', '#ffb35c'],
      ['高架 / 桥', '#ff8fc8'],
    ];
    legend.innerHTML = items.map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  }

  setStats(s) {
    const items = [
      ['建筑', s.buildings, '#e8e2d4'],
      ['骑楼', s.qilou, '#ffb35c'],
      ['超高层', s.tall, '#7fb0ff'],
      ['树木', s.trees, '#5fc28a'],
      ['跨江桥', s.bridges, '#ffb86b'],
      ['道路', `${s.roadKm} km`, '#cfd3d6'],
    ];
    this.chips.innerHTML =
      items.map(([t, v, c]) => `<span class="chip"><i style="background:${c}"></i>${t} <b>${typeof v === 'number' ? fmtN(v) : v}</b></span>`).join('') +
      `<span class="chip" id="chip-fps" title="帧率 / 绘制调用">帧率 <b>--</b></span>`;
  }
  setPerf(fps, calls) {
    const el = document.getElementById('chip-fps');
    if (el) el.innerHTML = `帧率 <b>${Math.round(fps)}</b> · ${fmtN(calls)} DC`;
    this.chipsR = null;
  }

  showStatus(text) {
    this.statusText.textContent = text;
    this.status.classList.remove('hidden');
  }
  hideStatus() {
    this.status.classList.add('hidden');
  }
  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.toastEl.classList.add('hidden'), 2200);
  }

  // ---------- 标注 ----------
  setLabels(list) {
    this.labelsEl.innerHTML = '';
    this.labels = list.map((l) => {
      const el = document.createElement('div');
      el.className = `lbl t${l.tier ?? 3}${l.district ? ' district' : ''}`;
      el.innerHTML = `<div class="card"><span class="nm">${l.name}</span>${l.sub ? `<span class="sb">${l.sub}</span>` : ''}</div>${l.district ? '' : '<div class="pin"></div>'}`;
      this.labelsEl.appendChild(el);
      const pri = l.priority ?? (l.tier === 0 ? 0 : l.district ? 1 : l.tier === 2 ? 2 : 3);
      return { ...l, el, pri, bw: el.offsetWidth || 120, bh: el.offsetHeight || 40, p: new THREE.Vector3(l.x, l.y, l.z) };
    });
  }
  // 精细建筑标注随所属精细块切换说明：未显示精细模型（加载中、失败或远离释放）时说明当前是基础体量
  setDetailActive(active) {
    for (const l of this.labels || []) {
      if (!l.detailTile) continue;
      const text = active.has(l.detailTile) ? l.sub : l.subFallback;
      const sb = l.el.querySelector('.sb');
      if (sb && sb.textContent !== text) sb.textContent = text;
    }
  }
  // 按优先级贪心放置，互相遮挡的低优先级标注自动隐藏
  updateLabels(camera, w, h) {
    const cp = camera.position;
    const cands = [];
    for (const l of this.labels) {
      const d = cp.distanceTo(l.p);
      const maxD = l.maxDistance ?? (l.tier === 0 ? 16000 : l.district ? 6500 : l.tier === 2 ? 3200 : 1500);
      const minD = l.minDistance ?? (l.district ? 800 : l.tier === 0 ? 60 : 90);
      let a = 1 - smooth(maxD * 0.7, maxD, d);
      a *= smooth(minD * 0.5, minD, d);
      this.v.copy(l.p).project(camera);
      l.d = d;
      if (this.v.z > 1 || a <= 0.03 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) {
        l.show = false;
        continue;
      }
      l.sx = (this.v.x * 0.5 + 0.5) * w;
      l.sy = (-this.v.y * 0.5 + 0.5) * h;
      l.a = a;
      cands.push(l);
    }
    cands.sort((p, q) => p.pri - q.pri || p.d - q.d);
    // 预留区域：左上标题与统计胶囊、左下小地图
    const cr = this.chipsR || (this.chipsR = this.chips.getBoundingClientRect());
    const placed = [[0, 0, Math.max(cr.right + 6, 360), Math.max(cr.bottom + 6, 100)]];
    const mm = document.getElementById('minimap');
    if (mm.style.display !== 'none') placed.push([0, h - 270, 380, h]);
    for (const l of this.labels) l.show = false;
    for (const l of cands) {
      const r = [l.sx - l.bw / 2 - 4, l.sy - l.bh - 4, l.sx + l.bw / 2 + 4, l.sy + 2];
      if (r[2] > w - 390 && r[1] < h - 20 && l.pri > 0) continue; // 不压在右侧面板下
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) continue;
      placed.push(r);
      l.show = true;
    }
    for (const l of this.labels) {
      if (!l.show) {
        if (l.vis !== false) {
          l.el.style.opacity = '0';
          l.vis = false;
        }
        continue;
      }
      l.el.style.transform = `translate(${l.sx.toFixed(1)}px, ${l.sy.toFixed(1)}px) translate(-50%, -100%)`;
      l.el.style.opacity = l.a.toFixed(2);
      l.vis = true;
    }
  }

  // ---------- 小地图 ----------
  drawMap(D) {
    const c = D.city;
    const x0 = c.x0;
    const z0 = c.z0;
    const sx = c.x1 - c.x0;
    const sz = c.z1 - c.z0;
    this.map = { x0, z0, sx, sz };
    const W = this.base.width = this.mm.width;
    const H = this.base.height = this.mm.height;
    const g = this.base.getContext('2d');
    const img = g.createImageData(W, H);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = x0 + ((i + 0.5) / W) * sx;
        const z = z0 + ((j + 0.5) / H) * sz;
        const k = (j * W + i) * 4;
        const w = D.geo.sdAll(x, z) < 0;
        img.data[k] = w ? 40 : 30;
        img.data[k + 1] = w ? 92 : 32;
        img.data[k + 2] = w ? 112 : 31;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const tx = (x) => ((x - x0) / sx) * W;
    const tz = (z) => ((z - z0) / sz) * H;
    // 绿地（groundTri 每顶点 x, y, z）
    const tri = D.S.groundTri;
    const kind = D.S.groundKind;
    g.fillStyle = 'rgba(79,154,90,0.75)';
    g.beginPath();
    for (let t = 0; t < kind.length; t++) {
      const k = kind[t];
      if (k !== 0 && k !== 3 && k !== 11) continue;
      const o = t * 9;
      g.moveTo(tx(tri[o]), tz(tri[o + 2]));
      g.lineTo(tx(tri[o + 3]), tz(tri[o + 5]));
      g.lineTo(tx(tri[o + 6]), tz(tri[o + 8]));
    }
    g.fill();
    // 补全街区（淡）
    const F = D.S.fill;
    g.fillStyle = 'rgba(150,146,138,0.35)';
    for (let k = 0; k < D.nFill; k++) {
      const o = k * FILL.N;
      const px = tx(F[o + FILL.X]);
      const pz = tz(F[o + FILL.Z]);
      g.fillRect(px - 0.5, pz - 0.5, 1.2, 1.2);
    }
    // 道路
    g.lineCap = 'round';
    for (const r of D.roads) {
      if (r.cls === RC.LANE || r.cls === RC.STREET) continue;
      g.strokeStyle = r.bridge ? 'rgba(255,143,200,0.8)' : r.qilou ? 'rgba(255,179,92,0.9)' : 'rgba(255,255,255,0.22)';
      g.lineWidth = r.bridge || r.cls === RC.EXPRESS ? 1.1 : 0.7;
      g.beginPath();
      r.pts.forEach((p, i) => (i ? g.lineTo(tx(p[0]), tz(p[1])) : g.moveTo(tx(p[0]), tz(p[1]))));
      g.stroke();
    }
    // 真实建筑轮廓
    const bm = D.S.bldMeta;
    const R = D.S.bldRings;
    const Pt = D.S.bldPts;
    for (let i = 0; i < D.nBuildings; i++) {
      const o = i * BLD.N;
      const ri = bm[o + BLD.RING0];
      const p0 = R[ri * 2];
      const n = R[ri * 2 + 1];
      const tall = bm[o + BLD.TOP] > 100;
      g.fillStyle = bm[o + BLD.STYLE] === ST.QILOU ? '#ffb35c' : tall ? '#7fb0ff' : 'rgba(201,196,186,0.75)';
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const X = tx(Pt[(p0 + k) * 2]);
        const Z = tz(Pt[(p0 + k) * 2 + 1]);
        if (k) g.lineTo(X, Z);
        else g.moveTo(X, Z);
      }
      g.fill();
    }
    // 跨江桥
    g.strokeStyle = '#ffd166';
    g.lineWidth = 1.6;
    for (const br of D.bridges) {
      if (!br.name) continue;
      g.beginPath();
      g.moveTo(tx(br.a[0]), tz(br.a[1]));
      g.lineTo(tx(br.b[0]), tz(br.b[1]));
      g.stroke();
    }
    // 广州塔
    const ct = D.landmarks.find((l) => l.kind === 'cantonTower');
    if (ct) {
      g.fillStyle = '#ff6a45';
      g.beginPath();
      g.arc(tx(ct.x), tz(ct.z), 4, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.2;
      g.stroke();
    }
    document.getElementById('mm-scale').textContent = `${(sx / 1000).toFixed(1)} × ${(sz / 1000).toFixed(1)} km`;
  }
  drawCamera(camera, target) {
    if (!this.map) return;
    const g = this.mmCtx;
    const N = this.mm.width;
    g.drawImage(this.base, 0, 0);
    const { x0, z0, sx, sz } = this.map;
    const NH = this.mm.height;
    const tx = (x) => ((x - x0) / sx) * N;
    const tz = (z) => ((z - z0) / sz) * NH;
    const cx = tx(camera.position.x);
    const cz = tz(camera.position.z);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const ang = Math.atan2(dir.z, dir.x);
    const fov = (camera.fov * camera.aspect * Math.PI) / 180 / 2;
    const len = 34;
    g.fillStyle = 'rgba(255,184,107,0.22)';
    g.beginPath();
    g.moveTo(cx, cz);
    g.lineTo(cx + Math.cos(ang - fov) * len, cz + Math.sin(ang - fov) * len);
    g.lineTo(cx + Math.cos(ang + fov) * len, cz + Math.sin(ang + fov) * len);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffb86b';
    g.beginPath();
    g.arc(cx, cz, 4.5, 0, Math.PI * 2);
    g.fill();
    if (target) {
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(tx(target.x), tz(target.z), 4, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
