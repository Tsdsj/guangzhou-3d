// 几何体：建筑单位构件（底部中心为原点，x/z ∈ [-0.5,0.5]，y ∈ [0,1]）、树木、车辆、灯具，
// 以及通用网格构建器与程序化贴图。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../core/rng.js';

// ---------- 通用网格构建器 ----------
export class GB {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
    this.extra = {};
  }
  vert(x, y, z, nx, ny, nz, u = 0, v = 0, col = null, ex = null) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    if (col) this.c.push(col[0], col[1], col[2]);
    if (ex) for (const k in ex) (this.extra[k] ||= []).push(...(Array.isArray(ex[k]) ? ex[k] : [ex[k]]));
  }
  // 平面四边形（a,b,c,d 逆时针），法线由叉积得到
  quad(a, b, c, d, col = null, ex = null, uvs = null) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const U = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [q, t] of [[a, U[0]], [b, U[1]], [c, U[2]], [a, U[0]], [c, U[2]], [d, U[3]]]) this.vert(q[0], q[1], q[2], nx, ny, nz, t[0], t[1], col, ex);
  }
  tri(a, b, c, col = null, ex = null) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const q of [a, b, c]) this.vert(q[0], q[1], q[2], nx / l, ny / l, nz / l, 0, 0, col, ex);
  }
  // 长方体（中心 c，尺寸 s，绕 y 旋转 ry）
  box(cx, cy, cz, sx, sy, sz, ry = 0, col = null, ex = null) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const P = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const v = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz), P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz)];
    this.quad(v[4], v[5], v[6], v[7], col, ex);
    this.quad(v[1], v[0], v[3], v[2], col, ex);
    this.quad(v[5], v[1], v[2], v[6], col, ex);
    this.quad(v[0], v[4], v[7], v[3], col, ex);
    this.quad(v[3], v[7], v[6], v[2], col, ex);
    this.quad(v[0], v[1], v[5], v[4], col, ex);
  }
  // 两点之间的管（sides 边形），用于斜拉索、桁架、塔柱
  tube(a, b, r0, r1 = r0, sides = 6, col = null, ex = null, caps = false) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = d.length();
    if (L < 1e-6) return;
    d.divideScalar(L);
    const up = Math.abs(d.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(d, up).normalize();
    const e2 = new THREE.Vector3().crossVectors(e1, d).normalize();
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const n0 = e1.clone().multiplyScalar(Math.cos(a0)).addScaledVector(e2, Math.sin(a0));
      const n1 = e1.clone().multiplyScalar(Math.cos(a1)).addScaledVector(e2, Math.sin(a1));
      const p00 = [a[0] + n0.x * r0, a[1] + n0.y * r0, a[2] + n0.z * r0];
      const p01 = [a[0] + n1.x * r0, a[1] + n1.y * r0, a[2] + n1.z * r0];
      const p10 = [b[0] + n0.x * r1, b[1] + n0.y * r1, b[2] + n0.z * r1];
      const p11 = [b[0] + n1.x * r1, b[1] + n1.y * r1, b[2] + n1.z * r1];
      for (const [q, n] of [[p00, n0], [p01, n1], [p11, n1], [p00, n0], [p11, n1], [p10, n0]]) this.vert(q[0], q[1], q[2], n.x, n.y, n.z, 0, 0, col, ex);
    }
    if (caps) {
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2;
        const a1 = ((i + 1) / sides) * Math.PI * 2;
        const q0 = e1.clone().multiplyScalar(Math.cos(a0) * r1).addScaledVector(e2, Math.sin(a0) * r1);
        const q1 = e1.clone().multiplyScalar(Math.cos(a1) * r1).addScaledVector(e2, Math.sin(a1) * r1);
        this.tri(b, [b[0] + q0.x, b[1] + q0.y, b[2] + q0.z], [b[0] + q1.x, b[1] + q1.y, b[2] + q1.z], col, ex);
      }
    }
  }
  // 沿折线的管（逐段）
  polyTube(pts, r, sides = 6, col = null, ex = null) {
    for (let i = 0; i < pts.length - 1; i++) this.tube(pts[i], pts[i + 1], r, r, sides, col, ex);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.c.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    for (const k in this.extra) {
      const arr = this.extra[k];
      const n = this.p.length / 3;
      g.setAttribute(k, new THREE.Float32BufferAttribute(arr, arr.length / n));
    }
    g.computeBoundingSphere();
    return g;
  }
  get empty() {
    return this.p.length === 0;
  }
}

// ---------- 建筑单位构件 ----------
function faceUFromNormals(g, mode = 'plane') {
  const n = g.getAttribute('normal');
  const arr = new Float32Array(n.count * 4);
  for (let i = 0; i < n.count; i++) {
    const nx = n.getX(i);
    const ny = n.getY(i);
    const nz = n.getZ(i);
    if (Math.abs(ny) > 0.9) continue;
    if (mode === 'ang') arr[i * 4 + 2] = 1;
    else if (Math.abs(nz) >= Math.abs(nx)) arr[i * 4] = 1;
    else arr[i * 4 + 1] = 1;
  }
  g.setAttribute('aFaceU', new THREE.BufferAttribute(arr, 4));
  return g;
}

// 棱柱：由底面多边形（逆时针，xz 平面）拉伸到 y∈[0,1]，可指定顶面缩放
function prism(poly, { top = 1, smooth = false, capTop = true } = {}) {
  const b = new GB();
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % n];
    const A0 = [a[0], 0, a[1]];
    const C0 = [c[0], 0, c[1]];
    const A1 = [a[0] * top, 1, a[1] * top];
    const C1 = [c[0] * top, 1, c[1] * top];
    if (smooth) {
      const na = Math.hypot(a[0], a[1]);
      const nc = Math.hypot(c[0], c[1]);
      const ex = [a[0] / na, 0, a[1] / na];
      const ec = [c[0] / nc, 0, c[1] / nc];
      for (const [q, m] of [[A0, ex], [C0, ec], [C1, ec], [A0, ex], [C1, ec], [A1, ex]]) b.vert(q[0], q[1], q[2], m[0], m[1], m[2]);
    } else b.quad(A0, C0, C1, A1);
  }
  if (capTop) for (let i = 1; i < n - 1; i++) b.tri([poly[0][0] * top, 1, poly[0][1] * top], [poly[i][0] * top, 1, poly[i][1] * top], [poly[i + 1][0] * top, 1, poly[i + 1][1] * top]);
  return b.build();
}

function ccw(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  // xz 平面上（z 朝南），需要从上往下看为逆时针：面积符号为负
  return a > 0 ? poly.slice().reverse() : poly;
}

function shapeXY(shape, depth = 1) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  return ng;
}

export function makeUnitGeometries() {
  const G = {};
  G.box = faceUFromNormals(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  // 落地体块：去掉永远看不到的底面（BoxGeometry 面序 +x −x +y −y +z −z，每面 6 个索引）
  G.block = G.box.clone();
  {
    const ix = Array.from(G.box.index.array);
    G.block.setIndex([...ix.slice(0, 18), ...ix.slice(24)]);
  }
  const c = 0.32;
  G.octo = faceUFromNormals(prism(ccw([[-0.5, -c], [-c, -0.5], [c, -0.5], [0.5, -c], [0.5, c], [c, 0.5], [-c, 0.5], [-0.5, c]])));
  const circ = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    circ.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]);
  }
  G.cyl = faceUFromNormals(prism(ccw(circ), { smooth: true }), 'ang');
  const rr = [];
  const R = 0.2;
  for (const [cx, cz, a0] of [[0.5 - R, 0.5 - R, 0], [-0.5 + R, 0.5 - R, 90], [-0.5 + R, -0.5 + R, 180], [0.5 - R, -0.5 + R, 270]]) {
    for (let k = 0; k <= 4; k++) {
      const a = ((a0 + (k / 4) * 90) * Math.PI) / 180;
      rr.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]);
    }
  }
  G.rrect = faceUFromNormals(prism(ccw(rr)));
  G.taper = faceUFromNormals(prism(ccw([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]), { top: 0.55 }));
  {
    // 斜顶：前高后低
    const b = new GB();
    const P = (x, y, z) => [x, y, z];
    const yB = 0.3;
    b.quad(P(-0.5, 0, 0.5), P(0.5, 0, 0.5), P(0.5, 1, 0.5), P(-0.5, 1, 0.5));
    b.quad(P(0.5, 0, -0.5), P(-0.5, 0, -0.5), P(-0.5, yB, -0.5), P(0.5, yB, -0.5));
    b.quad(P(0.5, 0, 0.5), P(0.5, 0, -0.5), P(0.5, yB, -0.5), P(0.5, 1, 0.5));
    b.quad(P(-0.5, 0, -0.5), P(-0.5, 0, 0.5), P(-0.5, 1, 0.5), P(-0.5, yB, -0.5));
    b.quad(P(-0.5, 1, 0.5), P(0.5, 1, 0.5), P(0.5, yB, -0.5), P(-0.5, yB, -0.5));
    G.wedge = faceUFromNormals(b.build());
  }
  {
    // 双坡屋面：屋脊沿 x，山墙三角（aFaceU.w = 1）
    const b = new GB();
    b.quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0], null, { aFaceU: [0, 0, 0, 0] });
    b.quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0], null, { aFaceU: [0, 0, 0, 0] });
    b.tri([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0], null, { aFaceU: [0, 0, 0, 1] });
    b.tri([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], null, { aFaceU: [0, 0, 0, 1] });
    G.gable = b.build();
  }
  {
    // 四坡屋面（歇山 / 攒尖简化）
    const b = new GB();
    const r = 0.18;
    const ex = { aFaceU: [0, 0, 0, 0] };
    b.quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [r, 1, 0], [-r, 1, 0], null, ex);
    b.quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-r, 1, 0], [r, 1, 0], null, ex);
    b.tri([0.5, 0, 0.5], [0.5, 0, -0.5], [r, 1, 0], null, ex);
    b.tri([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-r, 1, 0], null, ex);
    G.hip = b.build();
  }
  {
    // 镬耳墙：矩形墙身 + 高耸的半椭圆“镬耳”
    const e = 0.6;
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.lineTo(0.5, 0);
    s.lineTo(0.5, e);
    for (let i = 1; i <= 20; i++) {
      const x = 0.5 - i / 20;
      const y = e + (1 - e) * Math.sqrt(Math.max(0, 1 - 4 * x * x));
      s.lineTo(x, y);
    }
    s.lineTo(-0.5, 0);
    G.wokear = faceUFromNormals(shapeXY(s));
  }
  {
    // 骑楼廊柱拱券单元：半柱 + 拱顶开口 + 上部横梁
    const pw = 0.09;
    const spring = 0.6;
    const topB = 0.84;
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.lineTo(-0.5 + pw, 0);
    s.lineTo(-0.5 + pw, spring);
    const hwO = 0.5 - pw;
    for (let i = 1; i < 16; i++) {
      const a = Math.PI - (i / 16) * Math.PI;
      s.lineTo(Math.cos(a) * hwO, spring + Math.sin(a) * (topB - spring));
    }
    s.lineTo(0.5 - pw, spring);
    s.lineTo(0.5 - pw, 0);
    s.lineTo(0.5, 0);
    s.lineTo(0.5, 1);
    s.lineTo(-0.5, 1);
    s.lineTo(-0.5, 0);
    G.arcade = faceUFromNormals(shapeXY(s));
  }
  {
    // 女儿墙山花四式
    const arc = new THREE.Shape();
    arc.moveTo(-0.5, 0);
    for (let i = 0; i <= 18; i++) {
      const a = Math.PI - (i / 18) * Math.PI;
      arc.lineTo(Math.cos(a) * 0.5, 0.18 + Math.sin(a) * 0.82);
    }
    arc.lineTo(0.5, 0);
    arc.lineTo(-0.5, 0);
    G.crestArc = faceUFromNormals(shapeXY(arc));
    const st = new THREE.Shape();
    const pts = [[-0.5, 0], [0.5, 0], [0.5, 0.34], [0.3, 0.34], [0.3, 0.66], [0.12, 0.66], [0.12, 1], [-0.12, 1], [-0.12, 0.66], [-0.3, 0.66], [-0.3, 0.34], [-0.5, 0.34]];
    st.moveTo(...pts[0]);
    for (const p of pts.slice(1)) st.lineTo(...p);
    st.lineTo(...pts[0]);
    G.crestStep = faceUFromNormals(shapeXY(st));
    const tr = new THREE.Shape();
    tr.moveTo(-0.5, 0);
    tr.lineTo(0.5, 0);
    tr.lineTo(0.5, 0.2);
    tr.lineTo(0, 1);
    tr.lineTo(-0.5, 0.2);
    tr.lineTo(-0.5, 0);
    G.crestTri = faceUFromNormals(shapeXY(tr));
    const sc = new THREE.Shape();
    sc.moveTo(-0.5, 0);
    sc.lineTo(0.5, 0);
    sc.bezierCurveTo(0.45, 0.25, 0.2, 0.3, 0.22, 0.55);
    sc.bezierCurveTo(0.24, 0.8, 0.1, 0.9, 0.0, 1.0);
    sc.bezierCurveTo(-0.1, 0.9, -0.24, 0.8, -0.22, 0.55);
    sc.bezierCurveTo(-0.2, 0.3, -0.45, 0.25, -0.5, 0);
    G.crestScroll = faceUFromNormals(shapeXY(sc));
  }
  {
    const cone = new THREE.ConeGeometry(0.5, 1, 12, 1, true).translate(0, 0.5, 0);
    const ng = cone.toNonIndexed();
    ng.computeVertexNormals();
    const n = ng.getAttribute('position').count;
    ng.setAttribute('aFaceU', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    G.cone = ng;
  }
  {
    // 八角飞檐
    const oct = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      oct.push([Math.cos(a) * 0.54, Math.sin(a) * 0.54]);
    }
    const g = prism(ccw(oct), { top: 0.62 });
    const n = g.getAttribute('position').count;
    g.setAttribute('aFaceU', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
    G.eave8 = g;
  }
  for (const k in G) {
    const g = G[k];
    if (!g.getAttribute('aFaceU')) faceUFromNormals(g);
    g.deleteAttribute('uv');
    g.computeBoundingSphere();
  }
  return G;
}

// ---------- 树木 ----------
// 树冠团块：detail 0 为远景低模，detail 2 为近景高模（顶点起伏形成叶簇）；两者共用同一布局，切换时不跳变
function blob(b, cx, cy, cz, rx, ry, rz, col, seed, detail = 0, dark = 0.55) {
  const ico = new THREE.IcosahedronGeometry(1, detail);
  const pos = ico.getAttribute('position');
  const lump = detail > 0 ? 0.16 : 0.0;
  const jit = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let k = jit.get(key);
    if (k === undefined) {
      // 叶簇起伏：低频形状（高低模共用）+ 高频凹凸（仅高模）
      const lowF = 0.86 + 0.28 * (0.5 + 0.5 * Math.sin(x * 2.1 + seed) * Math.cos(z * 1.7 + seed * 0.3 + y * 1.3));
      const hiF = 1 + lump * (Math.sin(x * 9.1 + y * 7.3 + seed) * Math.sin(z * 8.7 - y * 5.1 + seed * 1.7));
      k = lowF * hiF;
      jit.set(key, k);
    }
    const shade = dark + (1 - dark) * (0.5 + 0.5 * y);
    b.vert(cx + x * rx * k, cy + y * ry * k, cz + z * rz * k, x, y * 0.8 + 0.2, z, 0, 0, [col[0] * shade, col[1] * shade, col[2] * shade], { aLeaf: 1 });
  }
  ico.dispose();
}

function trunk(b, x0, z0, h, r0, r1, col, sides = 5) {
  b.tube([x0, 0, z0], [x0, h, z0], r0, r1, sides, col, { aLeaf: 0 });
}

// 按布局描述构建树（lo / hi 两套精度）
function buildTree(layout, hi) {
  const b = new GB();
  for (const it of layout) {
    if (it.t === 'tube' && it.fine && !hi) continue; // 中景低模省略气根与枝杈
    if (it.t === 'tube') b.tube(it.a, it.b, it.r0, it.r1, hi ? Math.max(it.s, 7) : it.s, it.col, { aLeaf: 0 });
    else blob(b, it.x, it.y, it.z, it.rx, it.ry, it.rz, it.col, it.seed, hi ? 2 : 0, it.dark ?? 0.55);
  }
  return b.build();
}

export function makeTreeGeometries() {
  const rng = new RNG(20260923);
  const out = { hi: {} };
  const bark = [0.2, 0.17, 0.14];
  const T = (a, b, r0, r1, s, col = bark, fine = false) => ({ t: 'tube', a, b, r0, r1, s, col, fine });
  const Bl = (x, y, z, rx, ry, rz, col, dark) => ({ t: 'blob', x, y, z, rx, ry, rz, col, dark, seed: Math.floor(rng.next() * 1e6) });
  const both = (name, layouts) => {
    out[name] = layouts.map((l) => buildTree(l, false));
    out.hi[name] = layouts.map((l) => buildTree(l, true));
  };
  // 榕树：宽大浓密的伞状树冠 + 粗短主干 + 气根
  {
    const layouts = [];
    for (let v = 0; v < 3; v++) {
      const L = [T([0, 0, 0], [0, 5.5, 0], 0.95, 0.6, 6)];
      for (let k = 0; k < 4; k++) {
        const a = rng.next() * 6.28;
        L.push(T([Math.cos(a) * 0.4, 4.2, Math.sin(a) * 0.4], [Math.cos(a) * 4.2, 7.6, Math.sin(a) * 4.2], 0.36, 0.2, 4, bark, true));
      }
      for (let k = 0; k < 6; k++) {
        const a = rng.next() * 6.28;
        const r = 2.2 + rng.next() * 3.6;
        L.push(T([Math.cos(a) * r, 8.2, Math.sin(a) * r], [Math.cos(a) * r * 1.05, 0.2, Math.sin(a) * r * 1.05], 0.08, 0.14, 3, [0.24, 0.2, 0.16], true));
      }
      const leaf = [0.13, 0.24, 0.08];
      L.push(Bl(0, 10.2, 0, 5.2, 3.2, 5.2, leaf));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * 6.28 + rng.next() * 0.7;
        const r = 4.4 + rng.next() * 1.8;
        L.push(Bl(Math.cos(a) * r, 8.4 + rng.next() * 2, Math.sin(a) * r, 3.8 + rng.next(), 2.5 + rng.next() * 0.7, 3.8 + rng.next(), leaf));
      }
      layouts.push(L);
    }
    both('banyan', layouts);
  }
  // 樟树 / 榄仁等常绿阔叶树：圆整树冠
  {
    const layouts = [];
    for (let v = 0; v < 3; v++) {
      const L = [T([0, 0, 0], [0, 4.8, 0], 0.34, 0.22, 5)];
      const leaf = [0.17, 0.29, 0.1];
      L.push(Bl(0, 7.0, 0, 3.3, 3.0, 3.3, leaf));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * 6.28 + rng.next();
        L.push(Bl(Math.cos(a) * 2.0, 5.9 + rng.next(), Math.sin(a) * 2.0, 2.4, 2.1, 2.4, leaf));
      }
      layouts.push(L);
    }
    both('broad', layouts);
  }
  // 木棉：高耸挺直、分层平展的枝，树冠稀疏（部分开红花）
  {
    const layouts = [];
    for (let v = 0; v < 2; v++) {
      const L = [T([0, 0, 0], [0, 15, 0], 0.58, 0.25, 6, [0.36, 0.33, 0.29])];
      const leaf = [0.2, 0.3, 0.11];
      for (const [y, r] of [[8, 3.8], [11.5, 3.2], [14.5, 2.3]]) {
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * 6.28 + y;
          L.push(T([0, y - 0.5, 0], [Math.cos(a) * r, y + 0.4, Math.sin(a) * r], 0.15, 0.08, 4, bark, true));
          L.push(Bl(Math.cos(a) * r, y + 0.8, Math.sin(a) * r, 2.0, 1.3, 2.0, leaf, 0.65));
        }
      }
      L.push(Bl(0, 16, 0, 2.1, 1.5, 2.1, leaf, 0.65));
      layouts.push(L);
    }
    both('kapok', layouts);
  }
  // 大王椰：灰白光滑树干、中部微鼓，顶部绿色冠茎
  {
    const b = new GB();
    const segs = [[0, 0.42], [3, 0.38], [8, 0.44], [13, 0.34], [16, 0.3]];
    for (let i = 0; i < segs.length - 1; i++) b.tube([0, segs[i][0], 0], [0, segs[i + 1][0], 0], segs[i][1], segs[i + 1][1], 7, [0.62, 0.6, 0.56], { aLeaf: 0 });
    b.tube([0, 16, 0], [0, 18.6, 0], 0.32, 0.26, 7, [0.22, 0.4, 0.14], { aLeaf: 1 });
    out.palmTrunk = b.build();
    out.palmTop = 18.4;
  }
  {
    const b = new GB();
    trunk(b, 0, 0, 6.2, 0.3, 0.26, [0.4, 0.34, 0.27], 6);
    out.fanTrunk = b.build();
    out.fanTop = 6.2;
  }
  // 棕榈羽叶：带下垂弧度的条带
  {
    const b = new GB();
    const n = 12;
    for (let f = 0; f < n; f++) {
      const a = (f / n) * Math.PI * 2 + (f % 2) * 0.12;
      const up = f % 3 === 0 ? 0.55 : f % 3 === 1 ? 0.15 : -0.2;
      const L = 5.2 + (f % 2) * 0.7;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const S = 6;
      let prev = null;
      for (let s = 0; s <= S; s++) {
        const t = s / S;
        const r = t * L;
        const y = r * up - t * t * L * 0.75;
        const w = 1.25 * Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.5 + 0.12;
        const cx = ca * r;
        const cz = sa * r;
        const px = -sa * w;
        const pz = ca * w;
        const droop = w * 0.3;
        const L0 = [cx - px, y - droop, cz - pz];
        const R0 = [cx + px, y - droop, cz + pz];
        const C0 = [cx, y, cz];
        if (prev) {
          b.quad(prev.L, prev.C, C0, L0, null, null, [[0, prev.t], [0.5, prev.t], [0.5, t], [0, t]]);
          b.quad(prev.C, prev.R, R0, C0, null, null, [[0.5, prev.t], [1, prev.t], [1, t], [0.5, t]]);
        }
        prev = { L: L0, R: R0, C: C0, t };
      }
    }
    out.frond = b.build();
  }
  // 蒲葵扇叶
  {
    const b = new GB();
    const n = 11;
    for (let f = 0; f < n; f++) {
      const a = (f / n) * Math.PI * 2;
      const tilt = 0.35 + (f % 3) * 0.25;
      const L = 2.8;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const base = [ca * 0.6, 0.4 * tilt, sa * 0.6];
      const tip = [ca * (0.6 + L * Math.cos(tilt * 0.6)), L * Math.sin(tilt) * 0.6, sa * (0.6 + L * Math.cos(tilt * 0.6))];
      const px = -sa * 1.6;
      const pz = ca * 1.6;
      b.quad([base[0] - px * 0.15, base[1], base[2] - pz * 0.15], [base[0] + px * 0.15, base[1], base[2] + pz * 0.15], [tip[0] + px, tip[1] - 0.4, tip[2] + pz], [tip[0] - px, tip[1] - 0.4, tip[2] - pz], null, null, [[0.45, 0], [0.55, 0], [1, 1], [0, 1]]);
    }
    out.fan = b.build();
  }
  return out;
}

// ---------- 车辆（长度沿 +x）----------
// 车辆：局部 x 为车头方向，y 向上，z 为右侧。aPart：0 车身 / 1 车窗 / 2 轮胎 / 3 前灯 / 4 尾灯 / 5 车身上部（公交白色）/ 6 货箱
function cabin(b, x0, x1, xt0, xt1, y0, y1, zb, zt, part = 1) {
  // 梯形车舱：底 [x0,x1] 宽 zb，顶 [xt0,xt1] 宽 zt；侧面与前后挡风为车窗，车顶为车身色
  const P = (x, y, z) => [x, y, z];
  const g = { aPart: part };
  const r = { aPart: 0 };
  b.quad(P(x1, y0, zb), P(x1, y0, -zb), P(xt1, y1, -zt), P(xt1, y1, zt), null, g);
  b.quad(P(x0, y0, -zb), P(x0, y0, zb), P(xt0, y1, zt), P(xt0, y1, -zt), null, g);
  b.quad(P(x0, y0, zb), P(x1, y0, zb), P(xt1, y1, zt), P(xt0, y1, zt), null, g);
  b.quad(P(x1, y0, -zb), P(x0, y0, -zb), P(xt0, y1, -zt), P(xt1, y1, -zt), null, g);
  b.quad(P(xt0, y1, zt), P(xt1, y1, zt), P(xt1, y1, -zt), P(xt0, y1, -zt), null, r);
}
function wheels(b, xs, r, zw, w = 0.26) {
  for (const x of xs) for (const s of [-1, 1]) b.tube([x, r, s * (zw - w / 2)], [x, r, s * (zw + w / 2)], r, r, 6, null, { aPart: 2 }, true);
}
function lamps(b, xf, xr, y, z, h = 0.14) {
  for (const s of [-1, 1]) {
    b.box(xf, y, s * z, 0.06, h, 0.34, 0, null, { aPart: 3 });
    b.box(xr, y, s * z, 0.06, h, 0.34, 0, null, { aPart: 4 });
  }
}
export function makeVehicleGeometries() {
  const out = [];
  {
    // 轿车
    const b = new GB();
    b.box(0, 0.64, 0, 4.5, 0.6, 1.8, 0, null, { aPart: 0 });
    b.box(1.75, 0.98, 0, 1.0, 0.08, 1.7, 0, null, { aPart: 0 });
    cabin(b, -1.55, 0.95, -1.15, 0.2, 0.94, 1.42, 0.86, 0.7);
    wheels(b, [1.4, -1.4], 0.33, 0.8);
    lamps(b, 2.24, -2.24, 0.78, 0.62);
    out.push(b.build());
  }
  {
    // SUV / MPV
    const b = new GB();
    b.box(0, 0.78, 0, 4.7, 0.8, 1.9, 0, null, { aPart: 0 });
    cabin(b, -2.25, 1.2, -2.2, 0.55, 1.18, 1.86, 0.92, 0.84);
    wheels(b, [1.5, -1.5], 0.4, 0.84);
    lamps(b, 2.34, -2.34, 0.98, 0.66);
    out.push(b.build());
  }
  {
    // 公交车（广州常见的绿白涂装）
    const b = new GB();
    b.box(0, 1.2, 0, 11.8, 1.5, 2.5, 0, null, { aPart: 0 });
    b.box(0, 2.35, 0, 11.4, 0.95, 2.52, 0, null, { aPart: 1 });
    b.box(0, 3.0, 0, 11.8, 0.35, 2.5, 0, null, { aPart: 5 });
    b.box(5.9, 2.15, 0, 0.06, 1.4, 2.3, 0, null, { aPart: 1 });
    wheels(b, [3.9, -3.6], 0.5, 1.1, 0.34);
    lamps(b, 5.92, -5.92, 0.95, 0.9, 0.2);
    out.push(b.build());
  }
  {
    // 厢式货车
    const b = new GB();
    b.box(2.1, 1.05, 0, 1.9, 1.3, 2.0, 0, null, { aPart: 0 });
    cabin(b, 1.2, 3.0, 1.2, 2.6, 1.7, 2.45, 1.0, 0.95);
    b.box(-0.95, 1.75, 0, 4.2, 2.5, 2.2, 0, null, { aPart: 6 });
    wheels(b, [2.2, -2.2], 0.42, 0.95, 0.3);
    lamps(b, 3.06, -3.06, 0.95, 0.75);
    out.push(b.build());
  }
  for (const g of out) {
    g.deleteAttribute('uv');
    g.computeBoundingSphere();
  }
  return out;
}

// ---------- 行人（长度方向 +x 为前进方向）：aPart 0 上衣 / 1 裤子 / 2 皮肤 / 3 头发 ----------
export function makePersonGeometries() {
  const out = [];
  for (const [sc, bag] of [[1, false], [1.06, true], [0.72, false]]) {
    const b = new GB();
    const P = (k) => ({ aPart: k });
    for (const side of [-1, 1]) b.box(0, 0.43 * sc, side * 0.09 * sc, 0.22 * sc, 0.86 * sc, 0.15 * sc, 0, null, P(1));
    b.box(0, 1.15 * sc, 0, 0.26 * sc, 0.62 * sc, 0.42 * sc, 0, null, P(0));
    for (const side of [-1, 1]) b.box(0, 1.1 * sc, side * 0.26 * sc, 0.12 * sc, 0.56 * sc, 0.1 * sc, 0, null, P(0));
    b.box(0.01, 1.6 * sc, 0, 0.2 * sc, 0.24 * sc, 0.19 * sc, 0, null, P(2));
    b.box(-0.02, 1.74 * sc, 0, 0.22 * sc, 0.07 * sc, 0.21 * sc, 0, null, P(3));
    if (bag) b.box(-0.2, 1.15, 0, 0.16, 0.42, 0.34, 0, null, P(3));
    const g = b.build();
    g.deleteAttribute('uv');
    out.push(g);
  }
  return out;
}

// ---------- 路灯 ----------
export function makeLampGeometries() {
  const pole = new GB();
  pole.tube([0, 0, 0], [0, 10, 0], 0.13, 0.08, 5);
  pole.tube([0, 9.7, 0], [1.9, 10.1, 0], 0.06, 0.05, 4);
  const head = new GB();
  head.box(2.0, 9.95, 0, 0.9, 0.18, 0.38);
  const post = new GB();
  post.tube([0, 0, 0], [0, 4.0, 0], 0.1, 0.07, 5);
  const globe = new THREE.IcosahedronGeometry(0.34, 1).translate(0, 4.35, 0);
  globe.deleteAttribute('uv');
  const pg = post.build();
  pg.deleteAttribute('uv');
  const hg = head.build();
  hg.deleteAttribute('uv');
  const polg = pole.build();
  polg.deleteAttribute('uv');
  return { pole: polg, head: hg, post: pg, globe };
}

// ---------- 程序化贴图 ----------
export function makeFrondTexture() {
  const W = 256;
  const Hh = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = Hh;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, Hh);
  g.strokeStyle = '#6f8a3a';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(W / 2, 0);
  g.lineTo(W / 2, Hh);
  g.stroke();
  const rng = new RNG(77);
  for (let y = 8; y < Hh - 4; y += 7) {
    const t = y / Hh;
    const len = (W / 2 - 6) * Math.sin(Math.min(1, t * 1.1) * Math.PI) * (0.85 + rng.next() * 0.15);
    for (const s of [-1, 1]) {
      const shade = 70 + Math.floor(rng.next() * 50);
      g.strokeStyle = `rgb(${40 + shade * 0.3},${90 + shade * 0.6},${30 + shade * 0.2})`;
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(W / 2, y);
      g.quadraticCurveTo(W / 2 + s * len * 0.5, y + 10, W / 2 + s * len, y + 26 + t * 20);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function makeFanTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  const cx = S / 2;
  for (let i = 0; i < 26; i++) {
    const a = Math.PI * 0.08 + (i / 25) * Math.PI * 0.84;
    g.strokeStyle = `rgb(${50 + (i % 3) * 10},${110 + (i % 4) * 12},${40})`;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(cx, 6);
    g.lineTo(cx - Math.cos(a) * S * 0.62, 6 + Math.sin(a) * S * 0.95);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 可平铺的水面法线贴图
export function makeWaterNormals(size = 256) {
  const rng = new RNG(4242);
  const P = 64; // 晶格需覆盖最高倍频的周期（4 << 3 = 32），否则越界产生条纹
  const lat = new Float32Array(P * P);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const noise = (x, y, p) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const s = (v) => v * v * (3 - 2 * v);
    const L = (i, j) => lat[(((j % p) + p) % p) * P + (((i % p) + p) % p)];
    const a = L(xi, yi);
    const b = L(xi + 1, yi);
    const c = L(xi, yi + 1);
    const d = L(xi + 1, yi + 1);
    return (a + (b - a) * s(xf)) * (1 - s(yf)) + (c + (d - c) * s(xf)) * s(yf);
  };
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 1;
      for (let o = 0; o < 4; o++) {
        const p = 4 << o;
        v += amp * noise((x / size) * p, (y / size) * p, p);
        amp *= 0.5;
      }
      h[y * size + x] = v;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
      const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
      const nx = -hx * 6;
      const ny = -hy * 6;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const k = (y * size + x) * 4;
      data[k] = ((nx / l) * 0.5 + 0.5) * 255;
      data[k + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      data[k + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export { mergeGeometries };
