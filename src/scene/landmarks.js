// 程序化精细地标（位置、朝向与尺度取自 OpenStreetMap 真实要素）：广州塔（双曲面扭转网格）、
// 广州大剧院（双砾石）、天河体育中心、越秀山广东电视塔。

import * as THREE from 'three';
import { GB } from './geometries.js';
import { patchMaterial } from './atmosphere.js';
import { RNG } from '../core/rng.js';

// ---------- 广州塔 ----------
function cantonTowerMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.45, metalness: 0.35 });
  return patchMaterial(m, {
    key: 'canton-tower',
    vPars: 'varying vec3 vWPos;',
    vMain: 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    fPars: 'varying vec3 vWPos; uniform float uTime; uniform float uTowerOn; uniform float uLights; uniform float uNight;',
    replace: [
      [
        'emissivemap_fragment',
        `{
          float h = vWPos.y / 600.0;
          float mode = mod(floor(uTime / 18.0), 3.0);
          vec3 c;
          if (mode < 0.5) c = gzHsv(fract(h * 0.7 - uTime * 0.04), 0.58, 1.0);
          else if (mode < 1.5) c = mix(vec3(1.0, 0.3, 0.5), vec3(0.62, 0.4, 1.0), smoothstep(0.1, 0.9, h + 0.15 * sin(uTime * 0.8)));
          else c = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.25, 0.1), h) * (0.75 + 0.25 * sin(vWPos.y * 0.08 - uTime * 3.0));
          float spark = step(0.985, gzH21(floor(vWPos.xz * 0.5) + floor(vWPos.y * 0.3) + floor(uTime * 6.0)));
          totalEmissiveRadiance += (c * 0.95 + vec3(1.0) * spark * 1.6) * uTowerOn * uLights;
        }`,
        'after',
      ],
    ],
  });
}

function buildCantonTower(x, z) {
  const g = new THREE.Group();
  const lat = new GB();
  const core = new GB();
  const H = 454;
  const a0 = 40;
  const b0 = 30;
  const a1 = 27;
  const b1 = 20.5;
  const phi = (135 * Math.PI) / 180;
  const N = 24;
  const P = (k, t) => {
    const th = (k / N) * Math.PI * 2;
    const p0 = [a0 * Math.cos(th), 0, b0 * Math.sin(th)];
    const p1 = [a1 * Math.cos(th + phi), H, b1 * Math.sin(th + phi)];
    return [x + p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, z + p0[2] + (p1[2] - p0[2]) * t];
  };
  for (let k = 0; k < N; k++) lat.tube(P(k, 0), P(k, 1), 1.1, 0.8, 6);
  const rings = 46;
  for (let j = 1; j <= rings; j++) {
    const t = j / rings;
    for (let k = 0; k < N; k++) lat.tube(P(k, t), P((k + 1) % N, t), 0.45, 0.45, 4);
  }
  for (let j = 0; j < rings; j += 2) {
    const t0 = j / rings;
    const t1 = (j + 2) / rings;
    for (let k = 0; k < N; k++) lat.tube(P(k, t0), P((k + 1) % N, t1), 0.3, 0.3, 3);
  }
  // 中央核心筒 + 楼层区
  const ell = (cy0, cy1, ra, rb, gb, segs = 20) => {
    for (let i = 0; i < segs; i++) {
      const t0 = (i / segs) * Math.PI * 2;
      const t1 = ((i + 1) / segs) * Math.PI * 2;
      const A = [x + ra * Math.cos(t0), cy0, z + rb * Math.sin(t0)];
      const B = [x + ra * Math.cos(t1), cy0, z + rb * Math.sin(t1)];
      const C = [x + ra * Math.cos(t1), cy1, z + rb * Math.sin(t1)];
      const D = [x + ra * Math.cos(t0), cy1, z + rb * Math.sin(t0)];
      gb.quad(B, A, D, C);
      gb.tri([x, cy1, z], C, D);
    }
  };
  ell(0, H, 8.5, 7, core);
  const rAt = (y) => {
    const t = y / H;
    let r = 1e9;
    for (let k = 0; k < N; k += 3) {
      const p = P(k, t);
      r = Math.min(r, Math.hypot(p[0] - x, p[2] - z));
    }
    return r;
  };
  for (const [y0, y1] of [[84, 168], [334, 404], [408, 450]]) {
    const r = Math.min(rAt(y0), rAt(y1)) * 0.82;
    ell(y0, y1, r * 1.12, r * 0.92, core, 24);
  }
  // 天线桅杆
  lat.tube([x, H, z], [x, 600, z], 5.5, 0.8, 8);
  for (let y = 470; y < 590; y += 16) {
    const r = 5.5 - ((y - H) / (600 - H)) * 4.7;
    lat.tube([x - r - 0.6, y, z], [x + r + 0.6, y, z], 0.35, 0.35, 4);
  }
  const latMesh = new THREE.Mesh(lat.build(), cantonTowerMaterial());
  latMesh.castShadow = true;
  latMesh.receiveShadow = true;
  g.add(latMesh);
  const coreMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x8e979c, roughness: 0.3, metalness: 0.6 }), {
    key: 'tower-core',
    fPars: 'uniform float uNight; uniform float uLights;',
    replace: [['emissivemap_fragment', 'totalEmissiveRadiance += vec3(1.0, 0.82, 0.6) * 0.8 * uNight * uLights;', 'after']],
  });
  const coreMesh = new THREE.Mesh(core.build(), coreMat);
  coreMesh.castShadow = true;
  g.add(coreMesh);
  // 塔基裙楼
  const base = new GB();
  ell(0, 9, 62, 48, base, 32);
  const baseMesh = new THREE.Mesh(base.build(), patchMaterial(new THREE.MeshStandardMaterial({ color: 0x9aa4a8, roughness: 0.3, metalness: 0.4 }), { key: 'tower-base' }));
  baseMesh.receiveShadow = true;
  g.add(baseMesh);
  // 航空障碍灯
  const redMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x550000 }), {
    key: 'aviation',
    fPars: 'uniform float uTime; uniform float uNight;',
    replace: [['emissivemap_fragment', 'totalEmissiveRadiance += vec3(1.0, 0.05, 0.02) * 12.0 * step(0.5, fract(uTime * 0.6)) * max(uNight, 0.25);', 'after']],
  });
  const red = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), redMat);
  red.position.set(x, 601, z);
  g.add(red);
  return g;
}

// ---------- 广州大剧院：灰黑与白色的双砾石 ----------
function buildOpera(spec) {
  const g = new THREE.Group();
  const rng = new RNG(1234);
  const mk = (sx, sy, sz, col, ox, oz) => {
    const geo = new THREE.IcosahedronGeometry(1, 2);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      const k = 1 + 0.08 * Math.sin(x * 5.1 + z * 3.7) + 0.05 * Math.cos(y * 7.3);
      y = Math.max(y, -0.05);
      p.setXYZ(i, x * sx * k, (y + 0.05) * sy * k, z * sz * k);
    }
    geo.computeVertexNormals();
    const mat = patchMaterial(new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.15, flatShading: true }), {
      key: 'opera',
      vPars: 'varying vec3 vWPos;',
      vMain: 'vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      fPars: 'varying vec3 vWPos; uniform float uStreetOn; uniform float uLights;',
      replace: [['emissivemap_fragment', 'totalEmissiveRadiance += vec3(1.0, 0.8, 0.55) * 1.2 * step(0.93, gzH21(floor(vWPos.xz * 0.25) + floor(vWPos.y * 0.3))) * uStreetOn * uLights;', 'after']],
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(spec.x + ox * Math.cos(spec.rot) + oz * Math.sin(spec.rot), 0, spec.z - ox * Math.sin(spec.rot) + oz * Math.cos(spec.rot));
    m.rotation.y = spec.rot + rng.float(-0.3, 0.3);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  const s = spec.s;
  mk(46 * s, 36 * s, 34 * s, 0x3b3e41, -18 * s, 6 * s);
  mk(28 * s, 22 * s, 22 * s, 0xd9d8d2, 36 * s, -16 * s);
  return g;
}

// ---------- 天河体育中心 ----------
function buildStadium(spec) {
  const g = new THREE.Group();
  const shell = new GB();
  const field = new GB();
  const N = 72;
  const P = (t, rx, rz, y) => {
    const lx = Math.cos(t) * rx;
    const lz = Math.sin(t) * rz;
    return [spec.x + lx * Math.cos(spec.rot) + lz * Math.sin(spec.rot), y, spec.z - lx * Math.sin(spec.rot) + lz * Math.cos(spec.rot)];
  };
  const rx = spec.rx;
  const rz = spec.rz;
  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * Math.PI * 2;
    const t1 = ((i + 1) / N) * Math.PI * 2;
    shell.quad(P(t1, rx, rz, 0), P(t0, rx, rz, 0), P(t0, rx, rz, 21), P(t1, rx, rz, 21));
    shell.quad(P(t1, rx, rz, 21), P(t0, rx, rz, 21), P(t0, rx * 0.8, rz * 0.78, 24), P(t1, rx * 0.8, rz * 0.78, 24));
    shell.quad(P(t1, rx * 0.8, rz * 0.78, 24), P(t0, rx * 0.8, rz * 0.78, 24), P(t0, rx * 0.8, rz * 0.78, 18), P(t1, rx * 0.8, rz * 0.78, 18));
    shell.quad(P(t0, rx * 0.8, rz * 0.78, 12), P(t1, rx * 0.8, rz * 0.78, 12), P(t1, rx * 0.62, rz * 0.56, 1), P(t0, rx * 0.62, rz * 0.56, 1));
    field.tri(P(0, 0, 0, 0.6), P(t1, rx * 0.62, rz * 0.56, 0.6), P(t0, rx * 0.62, rz * 0.56, 0.6));
  }
  const sm = new THREE.Mesh(shell.build(), patchMaterial(new THREE.MeshStandardMaterial({ color: 0xdcdcd6, roughness: 0.6, side: THREE.DoubleSide }), { key: 'stadium' }));
  sm.castShadow = true;
  sm.receiveShadow = true;
  g.add(sm);
  const fm = new THREE.Mesh(
    field.build(),
    patchMaterial(new THREE.MeshStandardMaterial({ color: 0x2f6b2a, roughness: 0.9 }), {
      key: 'field',
      fPars: 'uniform float uStreetOn; uniform float uLights;',
      replace: [['emissivemap_fragment', 'totalEmissiveRadiance += vec3(0.12, 0.3, 0.1) * 1.4 * uStreetOn * uLights;', 'after']],
    }),
  );
  fm.receiveShadow = true;
  g.add(fm);
  return g;
}

// ---------- 广东电视塔（越秀山）：四柱钢桁架塔 + 平台 + 天线 ----------
function buildTVTower(spec) {
  const g = new THREE.Group();
  const white = new GB();
  const red = new GB();
  const H = spec.h;
  const legTop = H * 0.72;
  const halfAt = (y) => 12 * (1 - y / legTop) + 1.8 * (y / legTop);
  const corner = (k, y) => {
    const r = halfAt(y);
    const sx = k === 0 || k === 3 ? -1 : 1;
    const sz = k < 2 ? -1 : 1;
    return [spec.x + sx * r, y, spec.z + sz * r];
  };
  const seg = 12;
  for (let j = 0; j < seg; j++) {
    const y0 = (j / seg) * legTop;
    const y1 = ((j + 1) / seg) * legTop;
    const gb = j % 2 ? red : white;
    for (let k = 0; k < 4; k++) {
      gb.tube(corner(k, y0), corner(k, y1), 0.7, 0.6, 5);
      gb.tube(corner(k, y0), corner((k + 1) % 4, y1), 0.22, 0.22, 3);
      gb.tube(corner((k + 1) % 4, y0), corner(k, y1), 0.22, 0.22, 3);
      gb.tube(corner(k, y1), corner((k + 1) % 4, y1), 0.25, 0.25, 3);
    }
  }
  for (const [y, r] of [[H * 0.42, 7], [H * 0.6, 5.5]]) {
    white.box(spec.x, y, spec.z, r * 2, 3.2, r * 2);
  }
  for (let j = 0; j < 6; j++) {
    const y0 = legTop + (j / 6) * (H - legTop);
    const y1 = legTop + ((j + 1) / 6) * (H - legTop);
    (j % 2 ? red : white).tube([spec.x, y0, spec.z], [spec.x, y1, spec.z], 1.2 - j * 0.15, 1.05 - j * 0.15, 6);
  }
  const mk = (gb, color) => {
    const m = new THREE.Mesh(gb.build(), patchMaterial(new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.4 }), { key: `tv-${color}` }));
    m.castShadow = true;
    g.add(m);
  };
  mk(white, 0xe8e8e4);
  mk(red, 0xb8322a);
  const redMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x550000 }), {
    key: 'aviation',
    fPars: 'uniform float uTime; uniform float uNight;',
    replace: [['emissivemap_fragment', 'totalEmissiveRadiance += vec3(1.0, 0.05, 0.02) * 12.0 * step(0.5, fract(uTime * 0.6)) * max(uNight, 0.25);', 'after']],
  });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), redMat);
  lamp.position.set(spec.x, H + 1, spec.z);
  g.add(lamp);
  return g;
}

export function buildLandmarks(list) {
  const group = new THREE.Group();
  for (const lm of list) {
    let o = null;
    switch (lm.kind) {
      case 'cantonTower':
        o = buildCantonTower(lm.x, lm.z);
        break;
      case 'opera':
        o = buildOpera({ x: lm.x, z: lm.z, rot: lm.rot, s: Math.max(0.8, Math.min(1.35, Math.max(lm.w, lm.d) / 160)) });
        break;
      case 'stadium':
        o = buildStadium({ x: lm.x, z: lm.z, rot: lm.rot, rx: lm.rx * 0.98, rz: lm.rz * 0.98 });
        break;
      case 'tvTower':
        o = buildTVTower(lm);
        break;
    }
    if (!o) continue;
    // 立于山上的地标（广东电视塔）随地形抬升
    o.position.y += lm.y || 0;
    group.add(o);
  }
  return group;
}
