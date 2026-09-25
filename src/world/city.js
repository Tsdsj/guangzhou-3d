// 真实广州场景装配：水系距离场 → 地面与地块 → 江堤 → 路网 / 高架 / 跨江桥 → 真实建筑（合并网格）
// → 补全街区与构件细节（实例化）→ 地标 → 行道树 / 公园林木 / 路灯 → 车流与游船。
// 图层：0 = 主相机 + 江面倒影；1 = 仅主相机（地面、道路、树、车等不参与倒影以节省开销）。

import * as THREE from 'three';
import { U } from '../scene/atmosphere.js';
import * as M from '../scene/materials.js';
import { makeUnitGeometries, makeTreeGeometries, makeLampGeometries, makeFrondTexture, makeFanTexture } from '../scene/geometries.js';
import { buildLandmarks } from '../scene/landmarks.js';
import { Traffic, Boats, Trains } from '../scene/traffic.js';
import { Geography, WATER_Y } from './geo.js';
import { buildFootprints } from './buildings.js';
import { Parts, GEOS, ST, ROOF, emitFillLot, osmRoofDetails, chenClan, pagoda, memorialHall, cathedral, zhenhai, trafficSignal, ctfTower } from './parts.js';
import { GB } from '../scene/geometries.js';
import { buildRoadMeshes, buildElevated, buildRiverBridges, buildHaixin, buildRails } from './infra.js';
import { buildTerrainMeshes } from './terrain.js';
import { buildTraffic, buildWalkers } from './traffic.js';
import { RC } from './data.js';
import { classifyDetails,emitRoutedParts } from './detail-spatial.js';
import { createDetailLayer } from './detail-layer.js';
import { RNG, hash32, lin } from '../core/rng.js';
import { BLD, TREE_REC as TR } from './schema.js';

export const TREE = { BANYAN: 0, PALM: 1, FANPALM: 2, KAPOK: 3, BROAD: 4 };
// 树木 LOD：相机附近换高精度树冠，TREE_LOD 米内画三维低模（按 700 m 分块），之外画公告板（按 2800 m 分块合并）
const TREE_LOD = 900;
// 小构件（屋顶设备、楼梯间、女儿墙、招牌、灯笼、信号灯杆、路灯等）只在一定距离内绘制：超出后不足数个像素
const SMALL_R = 1200;
const GEO_R = { cyl: 1200, arcade: 1800, crestArc: 1600, crestStep: 1600, crestTri: 1600, crestScroll: 1600, wokear: 2000 };
function partCullR(name, M, i) {
  if (GEO_R[name]) return GEO_R[name];
  const o = i * 16;
  const [a, b, c] = [Math.hypot(M[o], M[o + 2]), M[o + 5], Math.hypot(M[o + 8], M[o + 10])].sort((p, q) => p - q);
  if (c <= 3.5 || (b <= 1.0 && c <= 8)) return SMALL_R;
  // 屋顶上的小体量（楼梯间、水箱间、女儿墙段）
  if (name === 'box' && M[o + 13] > 2 && c <= 6.5) return 1600;
  return 0;
}

// 按空间网格拆分实例：每块是独立的 InstancedMesh，可被视锥剔除
function splitChunks(n, xOf, zOf, size) {
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const k = `${Math.floor(xOf(i) / size)},${Math.floor(zOf(i) / size)}`;
    let a = map.get(k);
    if (!a) map.set(k, (a = []));
    a.push(i);
  }
  return [...map.values()];
}
function gather(src, idx, k) {
  const out = new Float32Array(idx.length * k);
  idx.forEach((i, j) => out.set(src.subarray(i * k, i * k + k), j * k));
  return out;
}
function trsArray(x, y, z, rot, s) {
  const c = Math.cos(rot);
  const n = Math.sin(rot);
  return [c * s, 0, -n * s, 0, 0, s, 0, 0, n * s, 0, c * s, 0, x, y, z, 1];
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    const steel = M.makeConcreteMaterial(0xe6e8ea, 'steel');
    steel.roughness = 0.4;
    steel.metalness = 0.45;
    const archSteel = M.makeConcreteMaterial(0x8e9ba3, 'archsteel');
    archSteel.roughness = 0.45;
    archSteel.metalness = 0.5;
    const rail = M.makeConcreteMaterial(0xc9c6bf, 'rail');
    rail.side = THREE.DoubleSide;
    const cable = M.makeGlowMaterial(0xdfefff, 1.2, 'cable');
    cable.color.set(0xd8dadc);
    this.mats = {
      facade: M.makeFacadeMaterial(),
      ground: M.makeGroundMaterial(),
      terrain: M.makeTerrainMaterial(false),
      terrainFar: M.makeTerrainMaterial(true),
      parcel: Object.assign(M.makeParcelMaterial(), { depthWrite: false }),
      road: Object.assign(M.makeRoadMaterial(false), { depthWrite: false }),
      deck: Object.assign(M.makeRoadMaterial(true), { polygonOffsetFactor: -4, polygonOffsetUnits: -12 }),
      rail: M.makeRailMaterial(),
      wall: M.makeWallMaterial(),
      lampHead: M.makeLampHeadMaterial(),
      pool: M.makePoolMaterial(),
      pole: M.makeConcreteMaterial(0x3a3e41, 'pole'),
      bridgeConc: M.makeConcreteMaterial(0xb8b5ad, 'bconc'),
      bridgeRail: rail,
      bridgeSteel: steel,
      bridgeArch: archSteel,
      cable,
      flower: M.makeFlowerMaterial(),
    };
    this.treeMats = {
      banyan: M.makeTreeMaterial('banyan'),
      broad: M.makeTreeMaterial('broad'),
      kapok: M.makeTreeMaterial('kapok'),
      trunk: M.makeTreeMaterial('trunk'),
      frond: M.makeFrondMaterial(makeFrondTexture(), 'palm'),
      fan: M.makeFrondMaterial(makeFanTexture(), 'fan'),
      billboard: M.makeTreeBillboardMaterial(),
    };
    this.unit = makeUnitGeometries();
    this.treeGeo = makeTreeGeometries();
    this.lampGeo = makeLampGeometries();
    const gg = new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(gg, this.mats.ground);
    this.ground.receiveShadow = true;
    this.ground.layers.set(1);
    this.root.add(this.ground);
    this.labels = [];
    this.traffic = null;
    this.boats = null;
    this.treeLod = [];
    this.treeChunks = [];
    this.treeBB = [];
    this.culled = [];
    this.liteK = 1;
    this._v = new THREE.Vector3();
    this.stats = {};
    this.detailFallbacks=new Map();
    this.details=null;
  }

  async build(D, step = () => {}) {
    const geo = (this.geo = D.geo = new Geography(D));
    U.uSdf.value = geo.texIn;
    U.uSdfBox.value.copy(geo.boxOf(geo.gIn));
    U.uSdf2.value = geo.texOut;
    U.uSdfBox2.value.copy(geo.boxOf(geo.gOut));
    U.uProm.value = geo.PROM;
    const c = D.city;
    U.uCityBox.value.set(c.x0, c.z0, c.x1, c.z1);
    this.D = D;
    D.detailGroups=classifyDetails(D,D.detailManifest);
    for(const tile of D.detailManifest?.tiles||[])if(tile.kind==='buildings'){
      const group=new THREE.Group();group.name=`fallback-${tile.id}`;this.detailFallbacks.set(tile.id,group);this.root.add(group);
    }

    step('地面与水系');
    await nextFrame();
    this.root.add(this.buildParcels(D));
    this.root.add(buildTerrainMeshes(geo, this.mats.terrain, this.mats.terrainFar, D.city));
    this.root.add(this.buildWalls(D));

    step('路网与跨江桥');
    await nextFrame();
    const baseRoads=buildRoadMeshes(D,this.mats);this.root.add(baseRoads);
    this.detailRoadPaint=new THREE.Group();this.detailRoadPaint.visible=false;this.root.add(this.detailRoadPaint);
    if(D.detailManifest){
      const paint=Object.assign(M.makeRoadMaterial(false,true),{depthWrite:false,polygonOffsetFactor:-4,polygonOffsetUnits:-24});
      for(const m of baseRoads.children)if(m.material===this.mats.road){
        const overlay=new THREE.Mesh(m.geometry,paint);overlay.renderOrder=5;overlay.layers.set(1);this.detailRoadPaint.add(overlay);
      }
    }
    this.root.add(buildElevated(D, this.mats));
    this.root.add(buildRails(D, this.mats));
    const rb = buildRiverBridges(D, this.mats);
    this.root.add(rb.group);
    this.bridgeLamps = rb.lampPts;
    for (const lm of D.landmarks) if (lm.kind === 'haixin') this.root.add(buildHaixin(lm, this.mats));

    step('真实建筑轮廓');
    await nextFrame();
    const fp = buildFootprints(D);
    this.mats.facadeMerged = M.makeFacadeMaterial({ merged: true, btex: fp.btex });
    for (const [i,g] of fp.geos.entries()) {
      const m = new THREE.Mesh(g, this.mats.facadeMerged);
      m.castShadow = true;
      m.receiveShadow = true;
      (this.detailFallbacks.get(fp.detailTiles[i])||this.root).add(m);
    }

    step('街区补全与建筑细节');
    await nextFrame();
    const P = new Parts();
    const fallbackParts=new Map([...this.detailFallbacks.keys()].map(id=>[id,new Parts()]));
    const bm = D.S.bldMeta;
    for (let i = 0; i < D.nBuildings; i++) {
      const target=fallbackParts.get(D.detailGroups.sourceTiles.get(D.buildingSourceIds[i]))||P;
      emitRoutedParts(P,target,p=>osmRoofDetails(p,bm,i,fp.qEdgesOf,fp.outerOf));
    }
    const fill = D.S.fill;
    for (let k = 0; k < D.nFill; k++) {
      const target=fallbackParts.get(D.detailGroups.fillTiles.get(k))||P;
      emitRoutedParts(P,target,p=>emitFillLot(p,fill,k));
    }
    for(const parts of fallbackParts.values()){
      P.pools.push(...parts.pools);P.qfront.push(...parts.qfront);
      P.stats.qilou+=parts.stats.qilou;P.stats.lingnan+=parts.stats.lingnan;
    }
    for (const lm of D.landmarks) {
      P.y0 = lm.y || 0;
      if (lm.kind === 'chen') chenClan(P, lm);
      else if (lm.kind === 'pagoda') pagoda(P, lm.x, lm.z, lm.h, hash32(Math.round(lm.x), Math.round(lm.z)));
      else if (lm.kind === 'memorial') memorialHall(P, lm);
      else if (lm.kind === 'cathedral') cathedral(P, lm);
      else if (lm.kind === 'zhenhai') zhenhai(P, lm);
      else if (lm.kind === 'ctf') ctfTower(P, lm);
    }
    P.y0 = 0;
    this.citicMasts(P, D);
    this.signals(P, D);
    this.root.add(this.buildParts(P));
    for(const[id,parts]of fallbackParts)this.detailFallbacks.get(id).add(this.buildParts(parts));
    // 数据范围外的远景体块单独成组，按 3 km 大块合并绘制
    const far = new Parts();
    this.farCity(far, D);
    this.root.add(this.buildParts(far, 3000));
    this.root.add(this.waveRoofs(D));
    this.qilouPools = P.pools;
    this.qfront = P.qfront;

    step('地标');
    await nextFrame();
    this.root.add(buildLandmarks(D.landmarks));

    step('车流与游船');
    await nextFrame();
    this.traffic = new Traffic(buildTraffic(D));
    this.traffic.group.traverse((o) => o.layers.set(1));
    this.root.add(this.traffic.group);
    this.boats = new Boats(D.S.river);
    this.root.add(this.boats.group);
    this.trains = new Trains(D.trains);
    this.root.add(this.trains.group);
    this.walkers = new Traffic(buildWalkers(D), { people: true });
    this.walkers.group.traverse((o) => o.layers.set(1));
    this.root.add(this.walkers.group);

    const names={B1:'台湾银行旧址',B2:'沙面一街3号',B3:'露德圣母堂',C01:'沙面会堂 · 试落位',C02:'正金银行 · 试落位'};
    this.labels = [...D.labels,...(D.detailManifest?.tiles||[]).flatMap(t=>(t.buildings||[]).map(b=>({
      name:names[b.sampleId],sub:b.heightReference?`文献檐高 ${b.heightReference.value}m · 其余尺寸估计`:'精细外观参考 · 尺寸估计',x:b.position[0],y:b.sampleId==='B3'?23:b.heightReference?b.heightReference.value+2:14,z:b.position[2],tier:3,priority:-1,minDistance:8,maxDistance:600,
    })))];
    const st = D.meta.stats;
    this.stats = {
      buildings: st.buildings + st.fill,
      osm: st.buildings,
      qilou: P.stats.qilou,
      tall: st.tall,
      trees: st.trees,
      bridges: D.bridges.filter((b) => b.name).length + 1,
      roadKm: st.roadKm,
    };
    this.details=createDetailLayer(this,D);
    if(!this.details){const el=document.getElementById('detail-status');if(el){el.textContent='精细片区暂不可用 · 显示基础场景';el.title=D.detailManifestError||'No detail metadata';}}
  }

  // ---------- 地块铺装（按优先级顺序绘制，不写深度；顶点带高度，山地上已细分贴地）----------
  buildParcels(D) {
    const kind = D.S.groundKind;
    const n = kind.length;
    const pos = new Float32Array(D.S.groundTri);
    const kk = new Float32Array(n * 3);
    for (let t = 0; t < n; t++) {
      for (let v = 0; v < 3; v++) kk[t * 3 + v] = kind[t];
      // 统一朝上
      const o = t * 9;
      const cy = (pos[o + 5] - pos[o + 2]) * (pos[o + 6] - pos[o]) - (pos[o + 3] - pos[o]) * (pos[o + 8] - pos[o + 2]);
      if (cy < 0) {
        for (let q = 0; q < 3; q++) {
          const a = pos[o + 3 + q];
          pos[o + 3 + q] = pos[o + 6 + q];
          pos[o + 6 + q] = a;
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // 法线：平地朝上，山地取地形坡面法线
    const nr = new Float32Array(pos.length);
    for (let i = 0; i < nr.length; i += 3) {
      if (pos[i + 1] < 0.2) {
        nr[i + 1] = 1;
        continue;
      }
      const x = pos[i];
      const z = pos[i + 2];
      const gx = D.geo.height(x + 4, z) - D.geo.height(x - 4, z);
      const gz = D.geo.height(x, z + 4) - D.geo.height(x, z - 4);
      const l = Math.hypot(gx, 8, gz);
      nr[i] = -gx / l;
      nr[i + 1] = 8 / l;
      nr[i + 2] = -gz / l;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
    g.setAttribute('aKind', new THREE.BufferAttribute(kk, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mats.parcel);
    m.receiveShadow = true;
    m.renderOrder = 1;
    m.layers.set(1);
    return m;
  }

  // ---------- 江堤：花岗岩条石驳岸 + 石栏杆 ----------
  buildWalls(D) {
    const geo = D.geo;
    const pos = [];
    const nor = [];
    const aS = [];
    const yb = WATER_Y - 0.05;
    const yt = 1.0;
    const push = (p, n, s) => {
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
      aS.push(s);
    };
    for (const pts of D.banks) {
      let s = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        let p = pts[i];
        let q = pts[i + 1];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 0.01) continue;
        const mx = (p[0] + q[0]) / 2;
        const mz = (p[1] + q[1]) / 2;
        let gx = geo.sdAll(mx + 3, mz) - geo.sdAll(mx - 3, mz);
        let gz = geo.sdAll(mx, mz + 3) - geo.sdAll(mx, mz - 3);
        const gl = Math.hypot(gx, gz) || 1;
        gx /= gl;
        gz /= gl;
        let s0 = s;
        let s1 = s + L;
        let tx = (q[0] - p[0]) / L;
        let tz = (q[1] - p[1]) / L;
        if (-tz * -gx + tx * -gz < 0) {
          [p, q] = [q, p];
          [s0, s1] = [s1, s0];
          tx = -tx;
          tz = -tz;
        }
        const n = [-tz, 0, tx];
        const a = [p[0], yb, p[1]];
        const b = [q[0], yb, q[1]];
        const c = [q[0], yt, q[1]];
        const d = [p[0], yt, p[1]];
        push(a, n, s0); push(b, n, s1); push(c, n, s1);
        push(a, n, s0); push(c, n, s1); push(d, n, s0);
        const o = 0.42;
        const pc = [p[0] + gx * o, yt, p[1] + gz * o];
        const qc = [q[0] + gx * o, yt, q[1] + gz * o];
        const up = [0, 1, 0];
        push(d, up, s0); push(c, up, s1); push(qc, up, s1);
        push(d, up, s0); push(qc, up, s1); push(pc, up, s0);
        const inn = [tz, 0, -tx];
        const pb = [pc[0], 0, pc[2]];
        const qb = [qc[0], 0, qc[2]];
        push(qb, inn, s1); push(pb, inn, s0); push(pc, inn, s0);
        push(qb, inn, s1); push(pc, inn, s0); push(qc, inn, s1);
        s += L;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mats.wall);
    m.receiveShadow = true;
    return m;
  }

  // 广交会展馆：沿长边起伏的波浪形金属屋面，四周出挑形成檐下灰空间
  waveRoofs(D) {
    const bm = D.S.bldMeta;
    const gb = new GB();
    for (let i = 0; i < D.nBuildings; i++) {
      const o = i * BLD.N;
      if (bm[o + BLD.ROOF] !== ROOF.WAVE) continue;
      const top = bm[o + BLD.TOP];
      let ux = bm[o + BLD.UX];
      let uz = bm[o + BLD.UZ];
      let L = bm[o + BLD.W];
      let W = bm[o + BLD.D];
      if (W > L) {
        [L, W] = [W, L];
        [ux, uz] = [-uz, ux];
      }
      const vx = -uz;
      const vz = ux;
      const cx = bm[o + BLD.CX];
      const cz = bm[o + BLD.CZ];
      const ov = 6;
      const n = Math.max(8, Math.round(L / 6));
      const hAt = (a) => top + 2.5 + 4.2 * Math.abs(Math.sin((a / 56) * Math.PI));
      const P = (a, b, y) => [cx + ux * a + vx * b, y, cz + uz * a + vz * b];
      for (let k = 0; k < n; k++) {
        const a0 = -L / 2 - ov + ((L + 2 * ov) * k) / n;
        const a1 = -L / 2 - ov + ((L + 2 * ov) * (k + 1)) / n;
        const b0 = -W / 2 - ov;
        const b1 = W / 2 + ov;
        gb.quad(P(a0, b1, hAt(a0)), P(a1, b1, hAt(a1)), P(a1, b0, hAt(a1) + 1.2), P(a0, b0, hAt(a0) + 1.2));
        gb.quad(P(a1, b1, hAt(a1) - 0.6), P(a0, b1, hAt(a0) - 0.6), P(a0, b0, hAt(a0) + 0.6), P(a1, b0, hAt(a1) + 0.6));
      }
      // 细柱支撑出挑檐口
      for (let a = -L / 2; a <= L / 2; a += 24) {
        for (const b of [-W / 2 - ov + 1, W / 2 + ov - 1]) gb.tube(P(a, b, 0), P(a, b, hAt(a)), 0.35, 0.3, 6);
      }
    }
    const g = new THREE.Group();
    if (!gb.empty) {
      const m = new THREE.Mesh(gb.build(), this.mats.bridgeSteel);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  // 中信广场：双天线（塔顶取 OSM 构件最高点）
  citicMasts(P, D) {
    const bm = D.S.bldMeta;
    let best = -1;
    for (let i = 0; i < D.nBuildings; i++) {
      const o = i * BLD.N;
      if (bm[o + BLD.TOP] < 300 || bm[o + BLD.TOP] > 420) continue;
      const lm = D.labels.find((l) => l.name === '中信广场');
      if (lm && Math.hypot(bm[o + BLD.CX] - lm.x, bm[o + BLD.CZ] - lm.z) < 90 && (best < 0 || bm[o + BLD.TOP] > bm[best * BLD.N + BLD.TOP])) best = i;
    }
    if (best < 0) return;
    const o = best * BLD.N;
    const top = bm[o + BLD.TOP];
    const rot = Math.atan2(-bm[o + BLD.UZ], bm[o + BLD.UX]);
    for (const sg of [-1, 1]) {
      const x = bm[o + BLD.CX] + bm[o + BLD.UX] * sg * 6;
      const z = bm[o + BLD.CZ] + bm[o + BLD.UZ] * sg * 6;
      P.add('cyl', x, top, z, rot, 1.8, 70, 1.8, ST.METAL, lin('#d8dadc'), lin('#f2efe8'), 3, 1, 0, 0, 0, 3);
    }
  }

  // 数据范围之外：连绵的远景城区（低细节体块），让天际线延续到地平线
  farCity(P, D) {
    const c = D.city;
    const r = new RNG(20260925);
    const R = 3600;
    const step = 90;
    const pal = [lin('#d9d4ca'), lin('#cfc9bd'), lin('#e2dccf'), lin('#b9b6ae'), lin('#c9ccc6')];
    for (let x = c.x0 - R; x <= c.x1 + R; x += step) {
      for (let z = c.z0 - R; z <= c.z1 + R; z += step) {
        if (x > c.x0 - 60 && x < c.x1 + 60 && z > c.z0 - 60 && z < c.z1 + 60) continue;
        if (r.next() > 0.62) continue;
        const px = x + r.float(-30, 30);
        const pz = z + r.float(-30, 30);
        if (D.geo.sdAll(px, pz) < 45) continue;
        // 山上不建楼；山脚的体块随地形抬升
        const gy = D.geo.height(px, pz);
        if (gy > 8) continue;
        P.y0 = gy;
        const d = Math.max(c.x0 - px, px - c.x1, c.z0 - pz, pz - c.z1);
        const tall = r.chance(0.3 * Math.exp(-d / 3000));
        const h = tall ? r.float(50, 120) : r.float(12, 36);
        const w = tall ? r.float(18, 28) : r.float(22, 50);
        const dd = tall ? r.float(16, 26) : r.float(14, 36);
        const col = r.pick(pal);
        P.add('box', px, 0, pz, r.float(-0.3, 0.3), w, h, dd, tall ? ST.RESI : ST.WALKUP, col, lin('#8a7b6b'), 3, 3.4, r.float(0.4, 0.7));
      }
    }
  }

  buildParts(P, chunk = 0) {
    const g = new THREE.Group();
    for (const name of GEOS) {
      const buf = P.parts[name];
      const n = buf.n;
      if (!n) continue;
      // 按剔除距离分组：不剔除的大体量按原尺度分块；按距离剔除的小构件用 600 m 小分块。
      // 落地的方盒换用无底面的单元几何（补全地块的楼体占绝大多数，可省下约六分之一的顶点）
      const groups = new Map();
      for (let i = 0; i < n; i++) {
        const r = partCullR(name, buf.M, i);
        const unit = name === 'box' && buf.M[i * 16 + 13] < 0.05 ? 'block' : name;
        const key = `${r}|${unit}`;
        if (!groups.has(key)) groups.set(key, { r, unit, list: [] });
        groups.get(key).list.push(i);
      }
      const size = chunk || (name === 'box' ? 900 : n > 20000 ? 1500 : n > 3000 ? 3000 : 1e9);
      const chunks = [];
      for (const { r, unit, list } of groups.values()) {
        for (const c of splitChunks(list.length, (k) => buf.M[list[k] * 16 + 12], (k) => buf.M[list[k] * 16 + 14], r ? 600 : size)) chunks.push({ r, unit, idx: c.map((k) => list[k]) });
      }
      for (const { r, unit, idx } of chunks) {
        const geo = this.unit[unit].clone();
        geo.setAttribute('aColA', new THREE.InstancedBufferAttribute(gather(buf.CA, idx, 3), 3));
        geo.setAttribute('aColB', new THREE.InstancedBufferAttribute(gather(buf.CB, idx, 3), 3));
        geo.setAttribute('aFA', new THREE.InstancedBufferAttribute(gather(buf.FA, idx, 4), 4));
        geo.setAttribute('aFB', new THREE.InstancedBufferAttribute(gather(buf.FB, idx, 4), 4));
        const mesh = new THREE.InstancedMesh(geo, this.mats.facade, idx.length);
        mesh.instanceMatrix = new THREE.InstancedBufferAttribute(gather(buf.M, idx, 16), 16);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        g.add(mesh);
        if (r) {
          // 小构件不参与江面倒影（倒影只有半分辨率，看不出来）
          mesh.layers.set(1);
          this.addCull(mesh, idx.map((i) => [buf.M[i * 16 + 12], buf.M[i * 16 + 13], buf.M[i * 16 + 14]]), r);
        }
      }
    }
    return g;
  }

  // 登记按距离显隐的分块：相机到分块包围盒的距离超过 r 时隐藏
  addCull(m, pts, r) {
    const box = new THREE.Box3();
    for (const p of pts) box.expandByPoint(this._v.set(p[0], p[1], p[2]));
    box.expandByScalar(4);
    m.visible = false;
    this.culled.push({ m, box, r });
  }

  // ---------- 植被、路灯与灯光投影（数据在首屏之后到达，单独构建）----------
  addVegetation(D) {
    this.root.add(this.buildVeg(D));
    this.lodAt = null;
  }

  setTreesHidden(hidden) {
    this.treesHidden=!!hidden;
    if(this.treeRoot)this.treeRoot.visible=!this.treesHidden;
    this.detailDirty=true;
  }

  buildVeg(D) {
    const g = new THREE.Group();
    const treeRoot=new THREE.Group();treeRoot.name='trees';treeRoot.visible=!this.treesHidden;
    this.treeRoot=treeRoot;g.add(treeRoot);
    const TG = this.treeGeo;
    const tintOf = (sp, t) => {
      switch (sp) {
        case TREE.BANYAN: return [0.82 + 0.25 * t, 0.88 + 0.22 * t, 0.78 + 0.2 * t];
        case TREE.BROAD: return [1.08 + 0.3 * t, 1.12 + 0.18 * t, 0.9 + 0.2 * t];
        case TREE.KAPOK: return t < 0.15 ? [3.0, 0.78, 0.5] : [1.0 + 0.2 * t, 1.05, 0.9];
        case TREE.PALM: return [0.92 + 0.18 * t, 1.0 + 0.1 * t, 0.82];
        default: return [0.9 + 0.12 * t, 1.0, 0.85];
      }
    };
    const inst = (geoBase, mat, list, yOff, sp, geoHi) => {
      const n = list.length / TR.N;
      if (!n) return;
      const Mx = new Float32Array(n * 16);
      const T = new Float32Array(n * 3);
      const XZ = new Float32Array(n * 2);
      const Y = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const o = i * TR.N;
        const x = list[o + TR.X];
        const z = list[o + TR.Z];
        const s = list[o + TR.S];
        Y[i] = list[o + TR.Y];
        Mx.set(trsArray(x, Y[i] + yOff * s, z, list[o + TR.ROT], s), i * 16);
        T.set(tintOf(sp, list[o + TR.T]), i * 3);
        XZ[i * 2] = x;
        XZ[i * 2 + 1] = z;
      }
      const chunkOf = new Int32Array(n);
      const localOf = new Int32Array(n);
      const chunks = splitChunks(n, (i) => XZ[i * 2], (i) => XZ[i * 2 + 1], 700).map((idx, c) => {
        const geo = geoBase.clone();
        geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(gather(T, idx, 3), 3));
        if (!geo.getAttribute('aLeaf')) geo.setAttribute('aLeaf', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(1), 1));
        const m = new THREE.InstancedMesh(geo, mat, idx.length);
        m.instanceMatrix = new THREE.InstancedBufferAttribute(gather(Mx, idx, 16), 16);
        m.castShadow = true;
        m.receiveShadow = true;
        m.layers.set(1);
        m.computeBoundingSphere();
        m.visible = false;
        treeRoot.add(m);
        const box = new THREE.Box3();
        idx.forEach((i, j) => {
          chunkOf[i] = c;
          localOf[i] = j;
          box.expandByPoint(this._v.set(XZ[i * 2], Y[i], XZ[i * 2 + 1]));
        });
        box.max.y += yOff * 1.4;
        this.treeChunks.push({ m, box });
        return m;
      });
      if (geoHi) {
        const cap = Math.min(n, 700);
        const hg = geoHi.clone();
        hg.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
        const hm = new THREE.InstancedMesh(hg, mat, cap);
        hm.count = 0;
        hm.visible = false;
        hm.castShadow = true;
        hm.receiveShadow = true;
        hm.frustumCulled = false;
        hm.layers.set(1);
        treeRoot.add(hm);
        this.treeLod.push({ chunks, chunkOf, localOf, hi: hm, orig: Mx, tint: T, xz: XZ, n, cap, cur: [] });
      }
    };
    const split = (arr, nv) => {
      const out = Array.from({ length: nv }, () => []);
      for (let i = 0; i < arr.length / TR.N; i++) out[i % nv].push(...arr.subarray(i * TR.N, (i + 1) * TR.N));
      return out.map((a) => new Float32Array(a));
    };
    split(D.trees[TREE.BANYAN], 3).forEach((l, k) => inst(TG.banyan[k], this.treeMats.banyan, l, 0, TREE.BANYAN, TG.hi.banyan[k]));
    split(D.trees[TREE.BROAD], 3).forEach((l, k) => inst(TG.broad[k], this.treeMats.broad, l, 0, TREE.BROAD, TG.hi.broad[k]));
    split(D.trees[TREE.KAPOK], 2).forEach((l, k) => inst(TG.kapok[k], this.treeMats.kapok, l, 0, TREE.KAPOK, TG.hi.kapok[k]));
    inst(TG.palmTrunk, this.treeMats.trunk, D.trees[TREE.PALM], 0, TREE.PALM, null);
    inst(TG.frond, this.treeMats.frond, D.trees[TREE.PALM], TG.palmTop, TREE.PALM, null);
    inst(TG.fanTrunk, this.treeMats.trunk, D.trees[TREE.FANPALM], 0, TREE.FANPALM, null);
    inst(TG.fan, this.treeMats.fan, D.trees[TREE.FANPALM], TG.fanTop, TREE.FANPALM, null);

    // 远景公告板：全部树种合并，每块一次绘制；只接收阴影、不投射阴影
    {
      const quad = new THREE.BufferGeometry();
      quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
      quad.setIndex([0, 1, 2, 0, 2, 3]);
      const all = [];
      for (let sp = 0; sp < 5; sp++) {
        const L = D.trees[sp];
        for (let i = 0; i < L.length / TR.N; i++) all.push([sp, L, i * TR.N]);
      }
      const chunks = splitChunks(all.length, (k) => all[k][1][all[k][2] + TR.X], (k) => all[k][1][all[k][2] + TR.Z], 2800);
      for (const idx of chunks) {
        const n = idx.length;
        const B0 = new Float32Array(n * 4);
        const B1 = new Float32Array(n * 2);
        const TT = new Float32Array(n * 3);
        const box = new THREE.Box3();
        idx.forEach((k, j) => {
          const [sp, L, o] = all[k];
          const x = L[o + TR.X];
          const z = L[o + TR.Z];
          B0.set([x, L[o + TR.Y], z, L[o + TR.S]], j * 4);
          B1.set([sp, (hash32(o / TR.N, sp) % 1000) / 1000], j * 2);
          TT.set(tintOf(sp, L[o + TR.T]), j * 3);
          box.expandByPoint(this._v.set(x, L[o + TR.Y], z));
        });
        box.max.y += 30;
        const geo = new THREE.InstancedBufferGeometry();
        geo.setIndex(quad.getIndex());
        geo.setAttribute('position', quad.getAttribute('position'));
        geo.setAttribute('aB0', new THREE.InstancedBufferAttribute(B0, 4));
        geo.setAttribute('aB1', new THREE.InstancedBufferAttribute(B1, 2));
        geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(TT, 3));
        geo.instanceCount = n;
        geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
        geo.boundingSphere.radius += 25;
        const m = new THREE.Mesh(geo, this.treeMats.billboard);
        m.receiveShadow = true;
        m.layers.set(1);
        treeRoot.add(m);
        this.treeBB.push({ m, box });
      }
    }

    // 路灯（街道 / 滨江 / 高架 / 跨江桥）
    const lampsA = D.lamps;
    const bl = this.bridgeLamps || [];
    const lamps = new Float32Array(lampsA.length + bl.length);
    lamps.set(lampsA);
    lamps.set(bl, lampsA.length);
    const street = [];
    const prom = [];
    for (let i = 0; i < lamps.length; i += 6) (lamps[i + 5] === 1 ? prom : street).push(i);
    const lampMesh = (geo, mat, idxs, scaleFn, layer, r) => {
      if (!idxs.length) return;
      const chunks = splitChunks(idxs.length, (k) => lamps[idxs[k]], (k) => lamps[idxs[k] + 2], 700);
      for (const ch of chunks) {
        const m = new THREE.InstancedMesh(geo, mat, ch.length);
        const Mx = new Float32Array(ch.length * 16);
        ch.forEach((k, j) => {
          const i = idxs[k];
          Mx.set(trsArray(lamps[i], lamps[i + 1], lamps[i + 2], lamps[i + 3], scaleFn(i)), j * 16);
        });
        m.instanceMatrix = new THREE.InstancedBufferAttribute(Mx, 16);
        m.computeBoundingSphere();
        m.layers.set(layer);
        g.add(m);
        this.addCull(m, ch.map((k) => [lamps[idxs[k]], lamps[idxs[k] + 1], lamps[idxs[k] + 2]]), r);
      }
    };
    lampMesh(this.lampGeo.pole, this.mats.pole, street, (i) => lamps[i + 4] / 10, 1, 1000);
    lampMesh(this.lampGeo.head, this.mats.lampHead, street, (i) => lamps[i + 4] / 10, 0, 1500);
    lampMesh(this.lampGeo.post, this.mats.pole, prom, () => 1, 1, 1000);
    lampMesh(this.lampGeo.globe, this.mats.lampHead, prom, () => 1, 0, 1500);
    // 灯光投影（路灯 + 骑楼廊下）
    const extra = this.qilouPools || [];
    const pools = new Float32Array(D.pools.length + extra.length);
    pools.set(D.pools);
    pools.set(extra, D.pools.length);
    const np = pools.length / 5;
    if (np) {
      const chunks = splitChunks(np, (i) => pools[i * 5], (i) => pools[i * 5 + 2], 2200);
      for (const ch of chunks) {
        const pgeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        const types = new Float32Array(ch.length);
        const Mx = new Float32Array(ch.length * 16);
        ch.forEach((i, j) => {
          const r = pools[i * 5 + 3] * 2;
          Mx.set([r, 0, 0, 0, 0, 1, 0, 0, 0, 0, r, 0, pools[i * 5], pools[i * 5 + 1], pools[i * 5 + 2], 1], j * 16);
          types[j] = pools[i * 5 + 4];
        });
        pgeo.setAttribute('aType', new THREE.InstancedBufferAttribute(types, 1));
        const pm = new THREE.InstancedMesh(pgeo, this.mats.pool, ch.length);
        pm.instanceMatrix = new THREE.InstancedBufferAttribute(Mx, 16);
        pm.computeBoundingSphere();
        pm.renderOrder = 8;
        pm.layers.set(1);
        g.add(pm);
        this.addCull(pm, ch.map((i) => [pools[i * 5], pools[i * 5 + 1], pools[i * 5 + 2]]), 5000);
      }
    }
    return g;
  }

  tick(dt, cam) {
    if (this.boats && this.boats.group.visible) this.boats.update(dt);
    if (this.trains) this.trains.update(dt);
    if (this.traffic && dt > 0 && this.traffic.group.visible) this.traffic.update(dt, cam);
    // 行人只在贴近地面的视角下可见，远景时跳过更新
    if (this.walkers && dt > 0) {
      const near = !cam || cam.position.y < 420;
      this.walkers.group.visible = near;
      if (near) this.walkers.update(dt, cam);
    }
  }

  // 路口信号灯：干道与次干道驶入较大路口处，立于右侧路缘、悬臂伸向车道
  signals(P, D) {
    for (const r of D.roads) {
      if (r.bridge || r.cls === RC.LANE || r.ped || r.w < 9) continue;
      const Q = r.pts;
      const n = Q.length;
      if (n < 2) continue;
      const ends = [[Q[n - 1], Q[n - 2]]];
      if (!r.oneway) ends.push([Q[0], Q[1]]);
      for (const [at, prev] of ends) {
        if (!(at[2] > 6)) continue;
        let tx = at[0] - prev[0];
        let tz = at[1] - prev[1];
        const L = Math.hypot(tx, tz);
        if (L < at[2] + 10) continue;
        tx /= L;
        tz /= L;
        const back = at[2] + 7;
        const o = r.w / 2 + 1.1;
        const x = at[0] - tx * back - tz * o;
        const z = at[1] - tz * back + tx * o;
        if (!D.geo.inCity(x, z, 0) || D.geo.sdAll(x, z) < 3) continue;
        P.y0 = D.geo.height(x, z);
        trafficSignal(P, x, z, tz, -tx, Math.min(r.oneway ? r.w * 0.7 : r.w * 0.42, 9));
      }
    }
    P.y0 = 0;
  }

  // 省电画质：树木、屋顶细节与路灯的绘制距离缩短到约 60%
  setLite(on) {
    const k = on ? 0.6 : 1;
    if (k !== this.liteK) this.lodAt = null;
    this.liteK = k;
  }

  // 按相机位置更新 LOD：小构件 / 路灯分块按距离显隐；树木在切换距离内的分块画三维低模
  // （逐棵在着色器里按距离取舍），之外由公告板补齐，公告板最远画到雾几乎完全吞没的距离；相机附近的树换成高精度树冠
  updateLod(cam, force = false) {
    const p = cam.position;
    const k = this.liteK;
    const lod = TREE_LOD * k;
    const far = Math.min(cam.far, 9000 + Math.max(p.y, 0) * 1.6) * (0.4 + 0.6 * k);
    U.uTreeLod.value.set(lod, far);
    if (!force && this.lodAt && Math.hypot(p.x - this.lodAt.x, p.z - this.lodAt.z) < 14 && Math.abs(p.y - this.lodAt.y) < 20) return;
    this.lodAt = p.clone();
    for (const ch of this.culled) ch.m.visible = ch.box.distanceToPoint(p) < ch.r * k;
    for (const ch of this.treeChunks) ch.m.visible = ch.box.distanceToPoint(p) < lod + 25;
    for (const ch of this.treeBB) {
      const d0 = ch.box.distanceToPoint(p);
      // 盒子最远角点
      const dx = Math.max(Math.abs(p.x - ch.box.min.x), Math.abs(p.x - ch.box.max.x));
      const dy = Math.max(Math.abs(p.y - ch.box.min.y), Math.abs(p.y - ch.box.max.y));
      const dz = Math.max(Math.abs(p.z - ch.box.min.z), Math.abs(p.z - ch.box.max.z));
      ch.m.visible = d0 < far && Math.hypot(dx, dy, dz) > lod;
    }
    const R = p.y < 480 ? 170 + p.y * 0.35 : 0;
    const R2 = R * R;
    for (const e of this.treeLod) {
      let near = [];
      if (R > 0) {
        const d2s = [];
        for (let i = 0; i < e.n; i++) {
          const dx = e.xz[i * 2] - p.x;
          const dz = e.xz[i * 2 + 1] - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < R2) {
            near.push(i);
            d2s.push(d2);
          }
        }
        if (near.length > e.cap) {
          const idx = near.map((i, k) => k).sort((a, b) => d2s[a] - d2s[b]).slice(0, e.cap);
          near = idx.map((k) => near[k]);
        }
      }
      const dirty = new Set();
      for (const i of e.cur) {
        const m = e.chunks[e.chunkOf[i]];
        m.instanceMatrix.array.set(e.orig.subarray(i * 16, i * 16 + 16), e.localOf[i] * 16);
        dirty.add(m);
      }
      for (const i of near) {
        const m = e.chunks[e.chunkOf[i]];
        m.instanceMatrix.array.fill(0, e.localOf[i] * 16, e.localOf[i] * 16 + 16);
        dirty.add(m);
      }
      for (const m of dirty) m.instanceMatrix.needsUpdate = true;
      const ha = e.hi.instanceMatrix.array;
      const ht = e.hi.geometry.getAttribute('aTint');
      near.forEach((i, k) => {
        ha.set(e.orig.subarray(i * 16, i * 16 + 16), k * 16);
        ht.array.set(e.tint.subarray(i * 3, i * 3 + 3), k * 3);
      });
      e.hi.count = near.length;
      e.hi.visible = near.length > 0;
      e.hi.instanceMatrix.needsUpdate = true;
      ht.needsUpdate = true;
      e.cur = near;
    }
  }
}
