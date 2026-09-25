// 入口：渲染器、真实城市数据加载与场景装配、预设场景（机位 + 时间 + 天气）、跟随视角的阴影、界面联动。

import * as THREE from 'three';
import { SCENES, SCENE_KEYS, DEFAULT_ATMOS } from './core/scenes.js';
import { clamp } from './core/rng.js';
import { Atmosphere, U } from './scene/atmosphere.js';
import { Water } from './scene/water.js';
import { Post } from './scene/post.js';
import { Rain } from './scene/rain.js';
import { Panel } from './ui/panel.js';
import { Hud } from './ui/hud.js';
import { CameraRig } from './ui/cameraRig.js';
import { loadCity } from './world/data.js';
import { World } from './world/city.js';
import {isDetailTrial,TRIAL_SCENES} from './world/detail-trial.js';
import { WATER_Y } from './world/geo.js';
import { TREE_REC, LAMP } from './world/schema.js';

const detailTrialEnabled=isDetailTrial(location.search);
if(detailTrialEnabled)SCENES.push(...TRIAL_SCENES);

const canvas = document.getElementById('viewport');
const loaderSub = document.getElementById('loader-sub');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  loaderSub.textContent = '当前浏览器不支持 WebGL2，无法渲染三维城市。';
  throw e;
}
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 1, 60000);
camera.layers.enable(1);
camera.position.set(2400, 1400, 2600);

const atmos = new Atmosphere(renderer, scene);
atmos.sun.shadow.camera.layers.enableAll();
atmos.sunNear.shadow.camera.layers.enableAll();
atmos.maxH = 620;
const world = new World(scene);
const water = new Water();
scene.add(water.mesh);
const post = new Post(renderer, scene, camera);
const rain = new Rain();
scene.add(rain.mesh);
const rig = new CameraRig(camera, canvas);

let params = { ...DEFAULT_ATMOS };
let D = null;
let current = null;
let wantShot = false;
let probe = null; // 测速采样（__gz.bench）
let captureCb = null; // 调试截图（__gz.capture）
let hashCam = ''; // 本页最近写入地址栏的 hash（用来区分用户粘贴的新链接）

const hud = new Hud({
  onMapClick: (x, z) => {
    const t = new THREE.Vector3(x, 0, z);
    const off = camera.position.clone().sub(rig.controls.target);
    off.setLength(Math.min(Math.max(off.length(), 600), 1600));
    if (off.y < 250) off.y = 250;
    rig.flyTo(t.clone().add(off), t, 1.6);
    setScene(null);
  },
});
const panel = new Panel({
  onScene: (id) => applyScene(id),
  onAction: (a) => {
    if (a === 'shot') wantShot = true;
    else if (a === 'trees') setTreeInspection(!world.treesHidden);
    else if (a === 'hide') {
      document.body.classList.toggle('ui-hidden');
      if (document.body.classList.contains('ui-hidden') && !matchMedia('(pointer: coarse)').matches) hud.toast('按 H 键或右下角按钮恢复界面');
    }
  },
});
rig.onInterrupt = () => setScene(null);
// 系统开启“减少动态效果”时：场景切换直接跳转、不做电影漫游与自动巡游
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function applyAtmos() {
  atmos.apply(params);
  post.apply(atmos.state);
  water.uniforms.uReflK.value = params.weather === 'rain' ? 0.8 : 1.0;
}
function setScene(id) {
  if(id&&id!==current)setTreeInspection(false);
  if (id && id !== current) startTier(id);
  current = id;
  panel.setScene(id);
  if (id) {
    hashCam = `scene=${id}`;
    history.replaceState(null, '', `#${hashCam}`);
  }
}

function setTreeInspection(hidden) {
  world.setTreesHidden(hidden);
  const button=document.getElementById('btn-trees');
  button.setAttribute('aria-pressed',String(hidden));button.textContent=hidden?'恢复树木':'暂隐树木';
  document.getElementById('tree-inspection-note').hidden=!hidden;
}

// ---------- 预设场景 ----------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function P3(ll) {
  const o = D.meta.origin;
  return V((ll[0] - o.lon) * o.kx, ll[2], -(ll[1] - o.lat) * o.kz);
}
const routeAt = (lon) => {
  const o = D.meta.origin;
  const x = (lon - o.lon) * o.kx;
  const R = world.boats.P;
  let best = R[0];
  for (const p of R) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  return best;
};
// 人眼高度的机位：附近没有树（树冠会挡住视线）、也不在水里
function treeFree(x, z, r = 12) {
  if (D.geo.sdAll(x, z) < 2) return false;
  if (!D.trees) return true;
  return D.trees.every((L) => {
    for (let i = 0; i < L.length; i += TREE_REC.N) if (Math.abs(L[i] - x) < r && Math.abs(L[i + 1] - z) < r) return false;
    return true;
  });
}
// 视线前方 30 m 内没有树冠或灯柱挡在镜头前（dx, dz 为水平视线方向）
function viewClear(x, z, dx, dz) {
  const blocked = (px, pz, lat) => {
    const ax = px - x;
    const az = pz - z;
    const along = ax * dx + az * dz;
    return along > -2 && along < 30 && Math.abs(ax * dz - az * dx) < lat;
  };
  for (const L of D.trees || []) for (let i = 0; i < L.length; i += TREE_REC.N) if (Math.abs(L[i] - x) < 32 && Math.abs(L[i + 1] - z) < 32 && blocked(L[i], L[i + 1], 6)) return false;
  const M = D.lamps || [];
  for (let i = 0; i < M.length; i += LAMP.N) if (Math.abs(M[i] - x) < 32 && Math.abs(M[i + 2] - z) < 32 && blocked(M[i], M[i + 2], 1.5)) return false;
  return true;
}
function applyScene(id, instant = false) {
  const s = SCENES.find((q) => q.id === id);
  if (!s || !D) return;
  params = { ...s.atmos };
  applyAtmos();
  setScene(id);
  let pos;
  let tgt;
  if (s.cam) {
    pos = P3(s.cam);
    tgt = P3(s.tgt);
    // 江边机位（bank）：在 200 m 内找紧贴江堤栏杆的一点（离水 2–4.5 m），视线越过江面
    if (s.bank) {
      for (let k = 0; k < 900; k++) {
        const a = k * 2.4;
        const r = Math.sqrt(k) * 6.5;
        const x = pos.x + Math.cos(a) * r;
        const z = pos.z + Math.sin(a) * r;
        const d = D.geo.sdAll(x, z);
        const vx = tgt.x - x;
        const vz = tgt.z - z;
        const vl = Math.hypot(vx, vz) || 1;
        if (d > 2.2 && d < 4.5 && viewClear(x, z, vx / vl, vz / vl)) {
          pos.x = x;
          pos.z = z;
          break;
        }
      }
    } else if (s.group === 'street' && D.trees && !treeFree(pos.x, pos.z)) {
      // 街景机位：在 150 m 内按螺旋找一处没有树冠遮挡的位置
      for (let k = 1; k < 400; k++) {
        const a = k * 2.4;
        const r = Math.sqrt(k) * 7.5;
        if (treeFree(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r)) {
          pos.x += Math.cos(a) * r;
          pos.z += Math.sin(a) * r;
          break;
        }
      }
    }
  } else if (s.river) {
    const a = routeAt(s.river.from);
    const b = routeAt(s.river.to);
    pos = V(a.x, s.river.h, a.z + a.hw * 0.15);
    tgt = V(b.x, s.river.th, b.z - b.hw * 0.4);
  } else if (s.street) {
    // 在真实的街道上取最长的一段，站在街心平视（walk：车行道路则站在人行道上）
    // near：取离指定经纬度最近的路段，否则取最长的一段
    let best = null;
    const anyPed = D.roads.some((r) => r.ped && s.street.includes(r.name));
    const nearP = s.near && P3([s.near[0], s.near[1], 0]);
    for (const r of D.roads) {
      if (!s.street.includes(r.name) || (anyPed && !r.ped)) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i];
        const b = r.pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const key = nearP ? -Math.hypot((a[0] + b[0]) / 2 - nearP.x, (a[1] + b[1]) / 2 - nearP.z) : L;
        if (L > 20 && (!best || key > best.key)) best = { a, b, L, r, key };
      }
    }
    // 沿街每 6 m 取样，选前方 60 m 内两侧骑楼开间最多的位置
    const Q = world.qfront;
    let bestS = null;
    for (const r of D.roads) {
      if (!s.street.includes(r.name)) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i];
        const b = r.pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const tx = (b[0] - a[0]) / L;
        const tz = (b[1] - a[1]) / L;
        for (let t = 0; t < L; t += 6) {
          for (const dir of [1, -1]) {
            const x = a[0] + tx * t;
            const z = a[1] + tz * t;
            let score = 0;
            for (let k = 0; k < Q.length; k += 2) {
              const dx = Q[k] - x;
              const dz = Q[k + 1] - z;
              const along = (dx * tx + dz * tz) * dir;
              const lat = Math.abs(-dx * tz + dz * tx);
              if (along > 3 && along < 60 && lat < 16) score++;
            }
            if (!bestS || score > bestS.score) bestS = { x, z, tx: tx * dir, tz: tz * dir, score };
          }
        }
      }
    }
    if (bestS && bestS.score > 0) best = bestS;
    if (best && best.score !== undefined) {
      pos = V(best.x - best.tx * 4, 1.75, best.z - best.tz * 4);
      tgt = V(best.x + best.tx * 30, 5.0, best.z + best.tz * 30);
    } else if (best) {
      const tx = (best.b[0] - best.a[0]) / best.L;
      const tz = (best.b[1] - best.a[1]) / best.L;
      // 人行道：沿道路右侧法线偏出半个路宽再加 2.5 m；尽量避开树冠正下方
      const o = s.walk ? best.r.w / 2 + 2.5 : 0;
      const at = (f) => [best.a[0] + tx * best.L * f - tz * o, best.a[1] + tz * best.L * f + tx * o];
      const m = [0.3, 0.2, 0.4, 0.5, 0.15, 0.6, 0.1, 0.7].map(at).find(([x, z]) => treeFree(x, z)) || at(0.3);
      const eye = s.eye || 1.75;
      pos = V(m[0], eye, m[1]);
      tgt = V(m[0] + tx * 40, eye + 2.2, m[1] + tz * 40);
    }
    if (pos) {
      const g = D.geo.height(pos.x, pos.z);
      pos.y += g;
      tgt.y += g;
    }
  } else if (s.cinematic && !reduceMotion.matches) {
    const R = world.boats.P;
    const pts = [];
    const looks = [];
    const n = 7;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(((k + 0.3) / n) * (R.length - 1));
      const p = R[i];
      const q = R[Math.min(R.length - 1, i + 22)];
      pts.push(V(p.x, 90 + (k % 3) * 45, p.z + p.hw * 0.25));
      looks.push(V(q.x, 70, q.z - q.hw * 0.6));
    }
    const ct = D.landmarks.find((l) => l.kind === 'cantonTower');
    const e = R[R.length - 1];
    pts.push(V(e.x, 700, e.z - 1600));
    looks.push(V(ct.x, 150, ct.z - 600));
    pts.push(V(R[0].x + 1500, 900, R[0].z - 1800));
    looks.push(V(R[0].x + 2600, 80, R[0].z - 400));
    rig.cinematic(pts, looks, 110);
    hud.toast(`${s.name}：拖动鼠标即可退出`);
    return;
  }
  if (!pos && s.cinematic) {
    // 减少动态效果：电影漫游改为白鹅潭上空东望一江两岸的静止机位
    const R = world.boats.P;
    pos = V(R[0].x - 200, 320, R[0].z + 600);
    tgt = V(R[0].x + 2600, 60, R[0].z - 400);
  }
  if (!pos) return;
  if (instant || reduceMotion.matches) {
    // 立即落位要取消尚未结束的飞行，否则下一帧飞行插值会把相机拉回原路径
    rig.tween = null;
    rig.cine = null;
    camera.position.copy(pos);
    rig.controls.target.copy(tgt);
    rig.controls.update();
  } else {
    rig.flyTo(pos, tgt, 2.2);
    hud.toast(`场景：${s.name}`);
  }
}

// 双击聚焦地面点
canvas.addEventListener('dblclick', (e) => {
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) {
    const off = camera.position.clone().sub(rig.controls.target).multiplyScalar(0.55);
    if (off.length() < 40) off.setLength(40);
    rig.flyTo(hit.clone().add(off), hit, 1.2);
    setScene(null);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  const si = SCENE_KEYS.indexOf(k);
  if (k === 'h') document.body.classList.toggle('ui-hidden');
  else if (SCENES[si]) applyScene(SCENES[si].id);
});

// 视图偏移：让画面焦点落在右侧面板左边的可视区域中央
function applyViewOffset() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const collapsed = document.getElementById('panel').classList.contains('collapsed');
  const hidden = document.body.classList.contains('ui-hidden');
  const p = !collapsed && !hidden && w > 900 ? 380 : 0;
  camera.aspect = (w + p) / h;
  // 竖屏（手机）时保持接近横屏的水平视角，否则预设机位的主体会被裁到画面外；垂直视角最多放宽到 75°
  const vt = Math.tan(THREE.MathUtils.degToRad(21)) * Math.max(1, 1.25 / camera.aspect);
  camera.fov = Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(vt)));
  if (p) camera.setViewOffset(w + p, h, p, 0, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  applyViewOffset();
  post.setSize(w, h);
  const pr = renderer.getPixelRatio();
  water.setSize(w * pr, h * pr);
}
window.addEventListener('resize', () => applyTier(tier));
new MutationObserver(applyViewOffset).observe(document.getElementById('panel'), { attributes: true, attributeFilter: ['class'] });
new MutationObserver(applyViewOffset).observe(document.body, { attributes: true, attributeFilter: ['class'] });

// ---------- 画质：渲染分辨率按像素预算决定（大屏 / 高分屏不再按固定像素比渲染数百万像素），
// 持续低帧率时逐档降低分辨率、倒影与后期；帧率富余时回升。每个场景记住曾经跑不动的档位，下次直接从可行档位开始。
const PIXEL_BUDGET = 2.5e6;
const TIERS = [
  { k: 1, water: 0.5 },
  { k: 0.8, water: 0.4 },
  { k: 0.66, water: 0.3 },
  // 省电档：再降分辨率，并缩短树木 / 屋顶细节 / 路灯的绘制距离
  { k: 0.6, water: 0.25, lite: true },
];
let tier = 0;
const tierFail = new Map();
// 手机、平板与集成显卡：从第 2 档起步（仍会按实际帧率升降）
const TIER_MIN = (() => {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
  const weak = /SwiftShader|llvmpipe|Mali|Adreno|PowerVR|Apple GPU|Intel/i.test(gpu) || (navigator.deviceMemory && navigator.deviceMemory <= 4) || matchMedia('(pointer: coarse)').matches;
  return weak ? 2 : 0;
})();
tier = TIER_MIN;
function basePixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  return clamp(Math.sqrt(PIXEL_BUDGET / (window.innerWidth * window.innerHeight)), Math.min(1, dpr), Math.min(dpr, 1.5));
}
function applyTier(t) {
  tier = t;
  renderer.setPixelRatio(basePixelRatio() * TIERS[t].k);
  water.scale = TIERS[t].water;
  post.setTier(Math.min(t, 2));
  world.setLite(!!TIERS[t].lite);
  resize();
}
function startTier(id) {
  const f = tierFail.get(id);
  const t = Math.max(TIER_MIN, f === undefined ? 0 : Math.min(TIERS.length - 1, f + 1));
  if (t !== tier) applyTier(t);
  qAcc = qN = qGood = 0;
}
let qAcc = 0;
let qN = 0;
let qT = 0;
let qGood = 0;
function adaptQuality(now, dt) {
  if (rig.busy || probe) {
    qAcc = qN = 0;
    qT = now;
    return;
  }
  qAcc += dt;
  qN++;
  if (now - qT < 2000) return;
  const ms = (qAcc / qN) * 1000;
  qAcc = qN = 0;
  qT = now;
  const fail = tierFail.get(current) ?? -1;
  if (ms > 34 && tier < TIERS.length - 1) {
    tierFail.set(current, Math.max(fail, tier));
    applyTier(tier + 1);
    qGood = 0;
  } else if (tier > TIER_MIN && tier - 1 > fail) {
    // 按像素数比例估算升档后的帧时，连续两个窗口都有富余才升档
    const ratio = (TIERS[tier - 1].k / TIERS[tier].k) ** 2;
    qGood = ms * ratio < 22 ? qGood + 1 : 0;
    if (qGood >= 2) {
      applyTier(tier - 1);
      qGood = 0;
    }
  }
}

// ---------- 阴影：两级阴影贴图按需更新 ----------
// 远级跟随视角中心、范围随观察距离缩放；近级覆盖相机前方的一小片区域（街景与中低空的高精度阴影）。
// 两级各自判断是否需要重绘，同一帧最多重绘一张，避免移动时的周期性卡顿。
const shadowFar = { c: new THREE.Vector3(1e9, 0, 0), r: 1, t: 0, key: '' };
const shadowNear = { c: new THREE.Vector3(1e9, 0, 0), r: 1, t: 0, key: '' };
const _nc = new THREE.Vector3();
function updateShadow(now, both = false) {
  const tgt = rig.controls.target;
  const p = camera.position;
  const dist = p.distanceTo(tgt);
  const key = `${params.timeOfDay}|${params.weather}`;
  const R = clamp(dist * 1.2, 300, 5200);
  const Rn = clamp(Math.max(p.y, 0) * 1.1 + 180, 200, 900);
  // 近级中心：相机在地面的投影沿视线水平方向前移
  const fx = tgt.x - p.x;
  const fz = tgt.z - p.z;
  const fl = Math.hypot(fx, fz) || 1;
  const ahead = Math.min(Rn * 0.7, fl);
  _nc.set(p.x + (fx / fl) * ahead, 0, p.z + (fz / fl) * ahead);
  const place = (s) => {
    if (s === shadowFar) {
      atmos.cityCenter.set(tgt.x, 0, tgt.z);
      atmos.cityRadius = R;
      atmos.updateSunShadow();
      atmos.sun.shadow.needsUpdate = true;
      s.c.copy(tgt);
      s.r = R;
    } else {
      atmos.nearCenter.copy(_nc);
      atmos.nearRadius = Rn;
      atmos.updateNearShadow();
      atmos.sunNear.shadow.needsUpdate = true;
      s.c.copy(_nc);
      s.r = Rn;
    }
    s.t = now;
    s.key = key;
    renderer.shadowMap.needsUpdate = true;
  };
  // 首帧两张贴图都要生成：着色器按两张阴影贴图编译，缺一张会导致绘制失败
  if (both) {
    place(shadowFar);
    place(shadowNear);
    return;
  }
  const stale = (s, c, r, move) => s.key !== key || Math.hypot(c.x - s.c.x, c.z - s.c.z) > r * move || r / s.r > 1.3 || r / s.r < 0.75;
  const farStale = stale(shadowFar, tgt, R, 0.2) && now - shadowFar.t > 180;
  const nearStale = stale(shadowNear, _nc, Rn, 0.15) && now - shadowNear.t > 60;
  if (farStale && (!nearStale || shadowFar.t <= shadowNear.t)) place(shadowFar);
  else if (nearStale) place(shadowNear);
}

// ---------- 视野内是否可能有水面：屏幕网格射线与水面求交，查水系距离场；没有水时跳过江面倒影渲染 ----------
const _wm = new THREE.Matrix4();
const _wp = new THREE.Vector3();
let waterVis = true;
function waterInView() {
  if (_wm.equals(camera.matrixWorld)) return waterVis;
  _wm.copy(camera.matrixWorld);
  const o = camera.position;
  const cellK = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / 16;
  for (let j = 0; j < 16; j++) {
    for (let i = 0; i < 24; i++) {
      _wp.set(((i + 0.5) / 24) * 2 - 1, ((j + 0.5) / 16) * 2 - 1, 0.5).unproject(camera).sub(o).normalize();
      if (_wp.y > -1e-4) continue;
      const t = (WATER_Y - o.y) / _wp.y;
      if (t > camera.far) continue;
      // 相邻射线的地面间距（掠射角越小越大）；距离场在 85 m 处饱和，间距更大时饱和值视为“可能有水”
      const cell = (t * cellK) / Math.max(0.15, -_wp.y);
      const sd = D.geo.sdAll(o.x + _wp.x * t, o.z + _wp.z * t);
      if (sd < Math.max(15, cell) || (sd > 84 && cell > 84)) return (waterVis = true);
    }
  }
  return (waterVis = false);
}

// ---------- 视角分享：手动浏览停下后，地址栏记录相机与目标点的经纬度、高度、时间与天气（#cam=…），
// 复制链接打开即回到同一视角；选择预设场景时地址为 #scene=id ----------
const WEATHERS = ['clear', 'humid', 'rain', 'huinan'];
const _lastM = new THREE.Matrix4();
let stillSince = 0;
function syncHash(now) {
  if (current || rig.busy) {
    stillSince = now;
    return;
  }
  if (!_lastM.equals(camera.matrixWorld)) {
    _lastM.copy(camera.matrixWorld);
    stillSince = now;
    return;
  }
  if (now - stillSince < 600) return;
  const o = D.meta.origin;
  const ll = (v) => [(v.x / o.kx + o.lon).toFixed(5), (-v.z / o.kz + o.lat).toFixed(5), v.y.toFixed(1)];
  const h = `cam=${[...ll(camera.position), ...ll(rig.controls.target)].join(',')}&t=${params.timeOfDay}&w=${params.weather}`;
  if (h !== hashCam) {
    hashCam = h;
    history.replaceState(null, '', `#${h}`);
  }
}
function applyHash(instant) {
  const q = new URLSearchParams(location.hash.slice(1));
  const c = (q.get('cam') || '').split(',').map(Number);
  if (c.length === 6 && !c.some(Number.isNaN)) {
    const base = SCENES[0].atmos;
    const t = +q.get('t');
    params = { ...base, timeOfDay: t >= 0 && t < 24 ? t : base.timeOfDay, weather: WEATHERS.includes(q.get('w')) ? q.get('w') : base.weather };
    applyAtmos();
    camera.position.copy(P3(c.slice(0, 3)));
    rig.controls.target.copy(P3(c.slice(3)));
    rig.controls.update();
    setScene(null);
    hashCam = location.hash.slice(1);
    return;
  }
  // 试落位阶段的旧链接在两栋样件纳入默认主城后指向对应的正式场景
  const legacy = { 'trial-c01': 'detail-christchurch', 'trial-c02': 'detail-specie', 'trial-overview': 'detail-shamian-west' };
  const id = legacy[q.get('scene')] || q.get('scene');
  applyScene(SCENES.find((s) => s.id === id) ? id : SCENES[0].id, instant);
}
window.addEventListener('hashchange', () => D && location.hash.slice(1) !== hashCam && applyHash(false));

// ---------- 展示模式：60 秒无操作后依次巡游各预设场景（每个约 16 秒），任意操作即退出 ----------
let lastInput = performance.now();
let tourAt = 0;
let tourIdx = -1;
const touch = () => {
  lastInput = performance.now();
  if (tourIdx >= 0) {
    tourIdx = -1;
    hud.toast('已退出展示模式');
  }
};
for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, touch, { passive: true, capture: true });
function tour(now) {
  if (reduceMotion.matches || probe || document.hidden || SCENES.some(s=>s.id===current&&s.group==='detail')) {
    lastInput = now;
    return;
  }
  if (now - lastInput < 60000) return;
  if (tourIdx < 0) {
    tourIdx = Math.max(0, SCENES.findIndex((s) => s.id === current));
    tourAt = 0;
  }
  if (now - tourAt < 16000) return;
  tourAt = now;
  do tourIdx = (tourIdx + 1) % SCENES.length;
  while (SCENES[tourIdx].cinematic);
  applyScene(SCENES[tourIdx].id);
  hud.toast(`展示模式 · ${SCENES[tourIdx].name}（任意操作退出）`);
}

// ---------- 主循环 ----------
let last = performance.now();
let frameN = 0;
let perfFrames = 0;
let perfT = performance.now();
renderer.info.autoReset = false;
function frame(now) {
  requestAnimationFrame(frame);
  const cpu0 = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  renderer.info.reset();
  frameN++;
  if (frameN > 60) adaptQuality(now, dt);
  U.uTime.value += dt;
  rig.update(dt);
  // 相机不钻进山体
  const gh = D.geo.height(camera.position.x, camera.position.z);
  if (camera.position.y < gh + 2) camera.position.y = gh + 2;
  world.tick(dt, camera);
  world.updateLod(camera);
  // 近裁剪面随高度自适应，兼顾街景与全城远景的深度精度
  const h = Math.max(0.5, camera.position.y);
  const dist = camera.position.distanceTo(rig.controls.target);
  const near = clamp(Math.min(h, dist) * 0.04, 0.25, 60);
  // 远裁剪面随高度放宽：贴地视角下远处已被湿润大气吞没，不必绘制；中高空要看到北面的白云山
  const far = clamp(9000 + h * 4, h > 60 ? 18000 : 9000, 60000);
  if (Math.abs(near - camera.near) > near * 0.1 || Math.abs(far - camera.far) > far * 0.1) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
  U.uPxAng.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (window.innerHeight * renderer.getPixelRatio());
  atmos.sky.position.copy(camera.position);
  atmos.updateEnv(now);
  rain.update(camera, params.weather === 'rain' ? 1 : 0);
  if(world.details)world.details.update(camera.position.x,camera.position.z,camera.position.y);
  updateShadow(now,!!world.detailDirty);
  world.detailDirty=false;
  if (waterInView()) water.update(renderer, scene, camera);
  const pre = probe && [renderer.info.render.calls, renderer.info.render.triangles];
  post.update(camera, rig.controls.target);
  post.render(dt);
  if (probe) {
    const r = renderer.info.render;
    probe.push([dt * 1000, performance.now() - cpu0, r.calls - pre[0], r.triangles - pre[1], pre[0], pre[1]]);
  }
  perfFrames++;
  if (now - perfT > 1000) {
    hud.setPerf((perfFrames * 1000) / (now - perfT), renderer.info.render.calls);
    perfFrames = 0;
    perfT = now;
  }
  if (captureCb) {
    const cb = captureCb;
    captureCb = null;
    renderer.domElement.toBlob(cb, 'image/jpeg', 0.86);
  }
  if (wantShot) {
    wantShot = false;
    const a = document.createElement('a');
    let output=renderer.domElement;
    if(world.treesHidden){
      output=document.createElement('canvas');output.width=renderer.domElement.width;output.height=renderer.domElement.height;
      const ctx=output.getContext('2d');ctx.drawImage(renderer.domElement,0,0);
      const size=Math.max(18,Math.round(output.width/60));ctx.font=`${size}px sans-serif`;
      const caption='树木暂隐 · 仅供模型检查';ctx.fillStyle='rgba(20,25,30,.82)';ctx.fillRect(12,12,ctx.measureText(caption).width+32,size+24);
      ctx.fillStyle='#fff';ctx.fillText(caption,28,size+20);
    }
    a.href = output.toDataURL('image/png');
    a.download = `guangzhou-${current || 'view'}.png`;
    a.click();
    hud.toast('已导出当前视角截图');
  }
  hud.updateLabels(camera, window.innerWidth, window.innerHeight);
  if (frameN % 3 === 0) hud.drawCamera(camera, rig.controls.target);
  syncHash(now);
  tour(now);
}

// ---------- 启动 ----------
async function boot() {
  applyTier(TIER_MIN);
  applyAtmos();
  loaderSub.textContent = '下载城市数据…';
  const tl = performance.now();
  D = await loadCity((f) => (loaderSub.textContent = `下载城市数据… ${Math.round(f * 100)}%`),{detailTrial:detailTrialEnabled});
  const t0 = performance.now();
  const steps = [`下载 ${Math.round(t0 - tl)}`];
  let ts = t0;
  let sn = '';
  await world.build(D, (s) => {
    const now = performance.now();
    if (sn) steps.push(`${sn} ${Math.round(now - ts)}`);
    sn = s;
    ts = now;
    loaderSub.textContent = `构建：${s}`;
  });
  if(detailTrialEnabled){const {mountDetailTrial}=await import('./ui/detail-trial.js');mountDetailTrial(world,D,applyScene);}
  steps.push(`${sn} ${Math.round(performance.now() - ts)}`);
  hud.setLabels(world.labels);
  D.onDetailActive = (active) => hud.setDetailActive(active);
  hud.setDetailActive(new Set((world.details?.status() || []).filter((s) => s.active).map((s) => s.id)));
  hud.drawMap(D);
  hud.setStats(world.stats);
  rig.controls.maxTargetRadius = 14000;
  const date = (D.meta.osmTimestamp || '').slice(0, 10);
  document.getElementById('attrib').textContent = `地图数据 © OpenStreetMap 贡献者（ODbL）· ${date}`;
  applyHash(true);
  rig.controls.update();
  updateShadow(performance.now(), true);
  loaderSub.textContent = '编译着色器…';
  const tc = performance.now();
  try {
    await renderer.compileAsync(scene, camera);
  } catch (e) {
    console.warn('compileAsync failed', e);
  }
  console.info(`city built in ${Math.round(performance.now() - t0)} ms（${steps.join(' / ')} / 编译着色器 ${Math.round(performance.now() - tc)} ms）`);
  requestAnimationFrame(frame);
  setTimeout(() => document.getElementById('loader').classList.add('done'), 200);
  // 树木、路灯与灯光投影随后到达
  D.vegReady.then(() => {
    const tv = performance.now();
    world.addVegetation(D);
    console.info(`vegetation added in ${Math.round(performance.now() - tv)} ms`);
    // 街景机位要避开树冠：树木数据到齐后重新定位一次
    const sc = SCENES.find((q) => q.id === current);
    if (sc && sc.group === 'street' && !rig.busy) applyScene(current, true);
  });
}
boot();

// 调试入口（控制台 window.__gz）
window.__gz = {
  world, camera, rig, renderer, scene, atmos, post, water, SCENES,
  get D() {
    return D;
  },
  get params() {
    return params;
  },
  set: (k, v) => {
    params[k] = v;
    applyAtmos();
  },
  view: (id) => {
    lastInput = performance.now();
    applyScene(id, true);
  },
  bench,
  get tier() {
    return tier;
  },
  setTier: (t) => applyTier(Math.max(0, Math.min(TIERS.length - 1, t))),
  // 取下一帧画面（不含 HTML 界面）为 JPEG Blob
  capture: () => new Promise((r) => (captureCb = r)),
};

// 测速：依次切换预设场景，静置后统计帧时间、绘制调用与三角形数（主画面 / 阴影 + 倒影分开计）。
// 用法：await __gz.bench() 或 await __gz.bench({ ids: ['baietan'], move: true })
// atmos 在场景自带的时间 / 天气之上覆盖（如 { timeOfDay: 21 }），用于同一机位的昼夜、雨天对照。
async function bench({ ids = SCENES.filter((s) => !s.cinematic).map((s) => s.id), settle = 1800, frames = 60, move = false, atmos = null } = {}) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pct = (a, q) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const rows = [];
  for (const id of ids) {
    lastInput = performance.now();
    applyScene(id, true);
    if (atmos) {
      params = { ...params, ...atmos };
      applyAtmos();
    }
    await wait(settle);
    rig.controls.autoRotate = move;
    rig.controls.autoRotateSpeed = 8;
    probe = [];
    while (probe.length < frames) await wait(50);
    const S = probe;
    probe = null;
    rig.controls.autoRotate = false;
    rig.controls.autoRotateSpeed = 0.35;
    const ms = S.map((s) => s[0]);
    rows.push({
      id,
      fps: Math.round(1000 / avg(ms)),
      ms: +avg(ms).toFixed(1),
      p50: +pct(ms, 0.5).toFixed(1),
      p95: +pct(ms, 0.95).toFixed(1),
      cpu: +avg(S.map((s) => s[1])).toFixed(1),
      calls: Math.round(avg(S.map((s) => s[2]))),
      tris: +(avg(S.map((s) => s[3])) / 1e6).toFixed(2),
      auxCalls: Math.round(avg(S.map((s) => s[4]))),
      auxTris: +(avg(S.map((s) => s[5])) / 1e6).toFixed(2),
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      tier,
      h: Math.round(camera.position.y),
    });
  }
  console.table(rows);
  return rows;
}
