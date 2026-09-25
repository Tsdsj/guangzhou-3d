import * as THREE from '../../vendor/three/build/three.module.js';
import { Builder, wallGeometry, openingPath } from './detail-geometry.js';

// Evidence-driven facade studies: the source outline gives the plan, a reviewed photo gives the
// structure of the photographed face(s) (storeys, bays, opening shapes, loggias, columns), and every
// metric size stays an estimate. Uncovered faces are plain 'unknown' walls; nothing is mirrored from
// the photographed face. The model frame has x to the viewer's right when facing the primary face,
// z out of that face, y up; `plan` is the source outline already expressed in this frame.
const WALL = 0.32;
const PALETTE = {
  wall: '#d9c79a', trim: '#ece6d6', column: '#ebe5d6', frame: '#3d4a45', plinth: '#766b60',
  roof: '#8a5a47', rail: '#e7e1d2', glass: '#46636a', dark: '#2f3b39', wood: '#6e4331', metal: '#36433f', unknown: '#bbc1bd',
};

const lerp = (a, b, t) => a + (b - a) * t;

// Bay edges along a face of width W, leaving corner piers; weights give relative bay widths.
function bayLayout(W, f) {
  const pier = f.endPier ?? 0.6, n = f.bays, weights = f.bayWeights || Array(n).fill(1);
  if (weights.length !== n) throw new Error('bayWeights must match bays');
  const total = weights.reduce((s, v) => s + v, 0), inner = W - 2 * pier;
  if (inner <= n * 0.8) throw new Error('Facade too narrow for its bays');
  const edges = [-W / 2 + pier];
  for (const w of weights) edges.push(edges.at(-1) + (inner * w) / total);
  return edges.map((x, i) => (i === edges.length - 1 ? W / 2 - pier : x));
}

function openingFor(spec, bay, x, width) {
  // Per-bay list (photo shows mixed openings) overrides the storey default and door bays.
  const listed = spec.openings ? spec.openings[bay] : undefined;
  const o = spec.openings ? listed : spec.doors?.bays?.includes(bay) ? { ...spec.opening, ...spec.doors } : spec.opening;
  if (!o) return null;
  const isDoor = spec.openings ? !!o.door : !!spec.doors?.bays?.includes(bay);
  const w = Math.min(width * (o.w ?? 0.55), width - 0.3);
  const h = o.kind === 'arch' ? Math.max(o.h, w / 2 + 0.2) : o.h;
  return { x, y: o.sill ?? (isDoor ? 0 : 0.9), width: w, height: h, kind: o.kind === 'segment' ? 'arch' : o.kind || 'rect', door: isDoor, rail: !!o.rail, glaze: o.glaze || (isDoor ? 'wood' : 'glass') };
}

function glaze(b, o, z, frame, e) {
  b.pane(o, z - 0.16, o.glaze === 'wood' ? 'wood' : o.glaze === 'dark' ? 'dark' : 'glass', e);
  b.frame(o, z + 0.02, 0.09, 'trim', e);
  // Mullions/transoms only as a visual cue; their count is not measured.
  const top = o.kind === 'arch' ? o.y + o.height - o.width / 2 : o.y + o.height;
  if (o.glaze !== 'wood') {
    b.box(o.x, (o.y + top) / 2, z - 0.12, 0.05, top - o.y, 0.05, frame, 'estimate');
    for (let y = o.y + 0.9; y < top - 0.2; y += 0.9) b.box(o.x, y, z - 0.12, o.width, 0.045, 0.05, frame, 'estimate');
  }
}

function balustrade(b, x0, x1, y, z, h = 0.95, e = 'reference') {
  const L = x1 - x0;
  if (L < 0.3) return;
  b.box((x0 + x1) / 2, y + h - 0.06, z, L, 0.12, 0.3, 'rail', e);
  b.box((x0 + x1) / 2, y + 0.08, z, L, 0.16, 0.3, 'rail', e);
  const n = Math.max(2, Math.round(L / 0.24));
  for (let i = 0; i < n; i++) b.cylinder(x0 + ((i + 0.5) * L) / n, y + h / 2, z, 0.055, h - 0.26, 'rail', 0.075, 'estimate', 8);
}

function column(b, x, y0, h, z, c) {
  const r = c.radius ?? 0.26, shape = c.shape || 'round';
  b.box(x, y0 + 0.14, z, r * 2.7, 0.28, r * 2.7, 'trim', 'estimate');
  if (shape === 'square') b.box(x, y0 + h / 2, z, r * 2, h - 0.5, r * 2, 'column', 'reference');
  else b.cylinder(x, y0 + h / 2, z, r, h - 0.5, 'column', r * 0.88, 'reference', 20);
  b.box(x, y0 + h - 0.12, z, r * 2.8, 0.24, r * 2.8, 'trim', 'estimate');
  if (c.capital === 'ionic') for (const s of [-1, 1]) b.ring(x + s * r * 0.9, y0 + h - 0.32, z + r * 0.85, r * 0.3, r * 0.08, 'trim', 'estimate');
}

// One detailed face in its own frame: u along the face (viewer's right), v up, w out of the face.
function buildFace(face, heights, spec) {
  const b = new Builder(), walls = new Builder();
  const W = face.width, edges = bayLayout(W, spec), n = spec.bays;
  const levels = heights.reduce((a, h) => [...a, a.at(-1) + h], [0]), H = levels.at(-1);
  const wall = (w, h, holes, x, y, z, mat = 'wall', e = 'reference') => walls.add(wallGeometry(w, h, WALL, holes), mat, [x, y, z], [0, 0, 0], e, false);
  const giant = spec.giant;
  const recessOf = (s) => (giant && s >= giant.from && s <= giant.to ? giant.recess : 0);
  const pierW = spec.endPier ?? 0.6;
  // Corner piers run the full height at the face plane (they also close loggia and giant-order recesses).
  for (const s of [-1, 1]) {
    walls.add(new THREE.BoxGeometry(pierW, H, WALL + 0.02), 'wall', [s * (W / 2 - pierW / 2), H / 2, -WALL / 2], [0, 0, 0], 'reference', false);
    if (spec.quoins) for (let y = 0.3; y < H - 0.3; y += 0.62) b.box(s * (W / 2 - 0.34), y, 0.03, 0.62 + ((Math.round(y / 0.62) % 2) * 0.22), 0.3, 0.1, 'trim', 'estimate');
  }
  const innerW = W - 2 * pierW;
  // Ray probes (face frame): opening centres must pass through the structural wall; piers must not.
  const checks = { openings: [], solids: [] };
  spec.floors.forEach((f, s) => {
    const y0 = levels[s], h = heights[s], rz = -recessOf(s);
    const bays = [...Array(n).keys()].map((i) => ({ i, x: (edges[i] + edges[i + 1]) / 2, w: edges[i + 1] - edges[i] }));
    if (f.kind === 'loggia') {
      const d = f.depth ?? 2.4, back = rz - d;
      const holes = bays.map((bay) => openingFor(f.back ? { opening: f.back, doors: f.backDoors } : {}, bay.i, bay.x, bay.w)).filter(Boolean);
      wall(innerW, h, holes, 0, y0, back);
      for (const o of holes) checks.openings.push({ storey: s, origin: [o.x, y0 + o.y + Math.min(o.height / 2, 1.2), back + 0.9], maxDistance: WALL + 1.3 });
      holes.forEach((o) => glaze(b, { ...o, y: o.y + y0 }, back, 'frame', 'reference'));
      // Loggia floor and ceiling slabs; the depth itself is an estimate.
      b.box(0, y0 + 0.1, rz - d / 2, innerW, 0.2, d, 'trim', 'estimate');
      b.box(0, y0 + h - 0.12, rz - d / 2, innerW, 0.24, d, 'trim', 'estimate');
      if (f.arcade) {
        // Front screen of arches on piers.
        const pier = f.arcade.pier ?? 0.55;
        const arches = bays.map((bay) => ({ x: bay.x, y: f.arcade.sill ?? 0, width: bay.w - pier, height: Math.min(h - 0.35, Math.max((bay.w - pier) / 2 + 0.3, f.arcade.h ?? h - 0.6)), kind: 'arch' }));
        wall(innerW, h, arches, 0, y0, rz, 'wall', 'reference');
        arches.forEach((a) => b.frame({ ...a, y: a.y + y0 }, rz + 0.02, 0.1, 'trim', 'reference'));
      }
      const counts = f.columns?.counts || [];
      edges.forEach((x, k) => {
        const c = counts[k] ?? (f.columns ? 1 : 0);
        const gap = (f.columns?.pairGap ?? 0.62) / 2;
        const xs = c === 2 ? [x - gap, x + gap] : c === 1 ? [x] : [];
        for (const cx of xs) column(b, Math.max(-W / 2 + pierW + 0.3, Math.min(W / 2 - pierW - 0.3, cx)), y0 + (f.rail ? 0 : 0), h - (f.arcade ? 0.2 : 0.25), rz - (f.columns?.radius ?? 0.26) - 0.05, f.columns);
      });
      if (f.rail) for (const bay of bays) balustrade(b, bay.x - bay.w / 2 + 0.25, bay.x + bay.w / 2 - 0.25, y0 + (f.arcade?.sill ?? 0) + 0.02, rz - 0.3);
    } else {
      const spec2 = { opening: f.opening, doors: f.doors, openings: f.openings };
      const holes = bays.map((bay) => openingFor(spec2, bay.i, bay.x, bay.w)).filter(Boolean);
      wall(innerW, h, holes, 0, y0, rz);
      for (const o of holes) checks.openings.push({ storey: s, origin: [o.x, y0 + o.y + Math.min(o.height / 2, 1.2), rz + 1.5], maxDistance: WALL + 1.9 });
      // A pier between the first two bays stays solid unless an opening covers it.
      if (n > 1 && !holes.some((o) => Math.abs(o.x - edges[1]) < o.width / 2 + 0.05)) checks.solids.push({ storey: s, origin: [edges[1], y0 + h * 0.55, rz + 1.5], maxDistance: WALL + 1.9 });
      holes.forEach((o) => glaze(b, { ...o, y: o.y + y0 }, rz, 'frame', 'reference'));
      for (const o of holes) if (!o.door && (f.sillRail || o.rail)) balustrade(b, o.x - o.width / 2, o.x + o.width / 2, y0 + Math.max(0, o.y - 0.95), rz + 0.14, 0.85);
      const counts = f.pilasters?.counts || [];
      edges.forEach((x, k) => {
        const c = counts[k] ?? (f.pilasters ? 1 : 0), gap = (f.pilasters?.pairGap ?? 0.55) / 2;
        for (const cx of c === 2 ? [x - gap, x + gap] : c === 1 ? [x] : []) {
          if (f.pilasters.shape === 'round') column(b, cx, y0, h, rz + 0.12, { ...f.pilasters, radius: f.pilasters.radius ?? 0.2 });
          else b.box(cx, y0 + h / 2, rz + 0.08, f.pilasters.width ?? 0.42, h - 0.1, 0.16, 'trim', 'reference');
        }
      });
    }
    // String course at each storey top; inside a giant order it stays on the recessed wall.
    if (s < heights.length - 1) {
      const inGiant = giant && s >= giant.from && s < giant.to;
      b.box(0, y0 + h - 0.08, inGiant ? rz + 0.1 : 0.1, inGiant ? innerW : W + 0.1, inGiant ? 0.12 : 0.26, 0.34, 'trim', 'reference');
    }
  });
  if (giant) {
    const y0 = levels[giant.from], h = levels[giant.to + 1] - y0;
    const counts = giant.counts || edges.map(() => 1);
    edges.forEach((x, k) => {
      if (counts[k]) column(b, x, y0, h, -(giant.radius ?? 0.45) - 0.1, { shape: giant.shape, radius: giant.radius ?? 0.45, capital: giant.capital });
    });
    b.box(0, y0 + h + 0.5, -giant.recess / 2, innerW, 1.0, giant.recess + 0.3, 'trim', 'reference');
  }
  if (spec.plinth) b.box(0, spec.plinth / 2, 0.1, W + 0.1, spec.plinth, 0.3, 'plinth', 'reference');
  // Top entablature/cornice and parapet.
  const ent = spec.entablature ?? 0.7;
  b.box(0, H + ent / 2, 0.14, W + 0.3, ent, 0.5, 'trim', 'reference');
  b.box(0, H + ent - 0.08, 0.28, W + 0.6, 0.16, 0.7, 'trim', 'reference');
  const par = spec.parapet;
  if (par?.kind === 'balustrade') balustrade(b, -W / 2 + 0.2, W / 2 - 0.2, H + ent, -0.05, par.h ?? 0.95, 'reference');
  else if (par?.kind === 'solid') b.box(0, H + ent + (par.h ?? 0.9) / 2, -0.1, W, par.h ?? 0.9, 0.24, 'wall', 'reference');
  for (const p of spec.pediments || []) {
    // Pediment position comes from the photo; its rise is an estimate.
    const [i0, i1] = p.bays, x0 = edges[i0] - 0.3, x1 = edges[i1 + 1] + 0.3, top = H + ent;
    b.triangle([[x0, top], [(x0 + x1) / 2, top + p.h], [x1, top]], 0.02, 0.3, 'wall', 'reference');
    b.tube([[x0 - 0.1, top + 0.05, 0.36], [(x0 + x1) / 2, top + p.h + 0.08, 0.36], [x1 + 0.1, top + 0.05, 0.36]], 0.08, 'trim', 'reference');
  }
  for (const c of spec.crests || []) {
    // Arched crest above the cornice, as photographed; its outline height is an estimate.
    const [i0, i1] = c.bays, x0 = edges[i0], x1 = edges[i1 + 1], top = H + ent + (par?.h ?? 0);
    const shape = openingPath({ x: (x0 + x1) / 2, y: top, width: x1 - x0, height: Math.max(c.h, (x1 - x0) / 2 + 0.2), kind: 'arch' }, THREE.Shape);
    b.add(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false, curveSegments: 14 }), 'wall', [0, 0, -0.2], [0, 0, 0], 'reference');
    b.frame({ x: (x0 + x1) / 2, y: top, width: x1 - x0, height: Math.max(c.h, (x1 - x0) / 2 + 0.2), kind: 'arch' }, 0.12, 0.12, 'trim', 'estimate');
  }
  for (const pv of spec.pavilions || []) {
    // Roof belvedere at a face corner: posts, slab and a low dome. Existence from the photo, size estimated.
    const size = pv.size ?? 3, h = pv.h ?? 2.8, x = (pv.at === 'left' ? -1 : 1) * (W / 2 - size / 2 - 0.25), z = -size / 2 - 0.25, y = H + ent;
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) b.box(x + dx * (size / 2 - 0.2), y + h / 2, z + dz * (size / 2 - 0.2), 0.38, h, 0.38, 'column', 'reference');
    b.box(x, y + h + 0.15, z, size + 0.4, 0.3, size + 0.4, 'trim', 'reference');
    if (pv.dome !== false) b.add(new THREE.SphereGeometry(size * 0.42, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), 'column', [x, y + h + 0.3, z], [0, 0, 0], 'estimate');
  }
  const g = b.finish('face-details'), wg = walls.finish('face-walls');
  wg.traverse((o) => { if (o.isMesh) o.userData.structuralWall = true; });
  const group = new THREE.Group();
  group.add(g, wg);
  return { group, top: H + ent + (par?.h ?? 0), checks };
}

export function facadeStudy(s) {
  const m = s.model, plan = s.plan, heights = m.storeys, H = heights.reduce((a, h) => a + h, 0);
  if (!Array.isArray(plan) || plan.length < 3) throw new Error('Facade study needs its source plan');
  const detailed = new Map(m.faces.map((f) => [f.edge, f]));
  const group = new THREE.Group();
  group.name = `facade-study-${s.id}`;
  const walls = new Builder(), details = new Builder();
  const checks = { openings: [], solids: [] };
  let top = H;
  plan.forEach((a, i) => {
    const q = plan[(i + 1) % plan.length], L = Math.hypot(q[0] - a[0], q[1] - a[1]);
    if (L < 0.2) return;
    // Outward normal of edge a→q for either winding, measured against the plan centroid.
    const c = plan.reduce((acc, p) => [acc[0] + p[0] / plan.length, acc[1] + p[1] / plan.length], [0, 0]);
    let nx = (q[1] - a[1]) / L, nz = -(q[0] - a[0]) / L;
    const mid = [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2];
    if ((mid[0] - c[0]) * nx + (mid[1] - c[1]) * nz < 0) { nx = -nx; nz = -nz; }
    const ry = Math.atan2(nx, nz);
    const face = detailed.get(i);
    if (face) {
      const built = buildFace({ width: L }, heights, { ...face, plinth: m.plinth, entablature: m.entablature, parapet: m.parapet });
      built.group.rotation.y = ry;
      built.group.position.set(mid[0], 0, mid[1]);
      built.group.updateMatrixWorld(true);
      // Bake every face into two shared batches (structural walls / details) so a multi-face study
      // costs the same number of draw calls as a single face.
      built.group.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        (o.userData.structuralWall ? walls : details).add(g, o.userData.materialTag, [0, 0, 0], [0, 0, 0], o.userData.evidence, o.userData.detail);
        o.geometry.dispose();
        o.material.dispose();
      });
      top = Math.max(top, built.top);
      const toModel = ([x, y, z]) => [mid[0] + x * Math.cos(ry) + z * Math.sin(ry), y, mid[1] - x * Math.sin(ry) + z * Math.cos(ry)];
      const inward = [-Math.sin(ry), 0, -Math.cos(ry)];
      for (const kind of ['openings', 'solids']) for (const c of built.checks[kind]) checks[kind].push({ edge: i, storey: c.storey, origin: toModel(c.origin), direction: inward, maxDistance: c.maxDistance });
    } else {
      // Uncovered face: plain wall to the eaves plus a plain parapet; no openings are invented.
      walls.add(wallGeometry(L, H + (m.entablature ?? 0.7), WALL, []), 'unknown', [mid[0], 0, mid[1]], [0, ry, 0], 'unknown', false);
      if (m.parapet && m.roof?.kind !== 'hip') walls.add(new THREE.BoxGeometry(L, m.parapet.h ?? 0.9, 0.24), 'unknown', [mid[0] - nx * 0.12, H + (m.entablature ?? 0.7) + (m.parapet.h ?? 0.9) / 2, mid[1] - nz * 0.12], [0, ry, 0], 'unknown', false);
    }
  });
  const eave = H + (m.entablature ?? 0.7);
  if (m.roof?.kind === 'hip') {
    // Hip roof over the plan's bounding rectangle in the model frame; the pitch is an estimate.
    const xs = plan.map((p) => p[0]), zs = plan.map((p) => p[1]), o = m.roof.overhang ?? 0.5;
    const x0 = Math.min(...xs) - o, x1 = Math.max(...xs) + o, z0 = Math.min(...zs) - o, z1 = Math.max(...zs) + o;
    const w = x1 - x0, d = z1 - z0, rise = (Math.min(w, d) / 2) * Math.tan(((m.roof.pitch ?? 24) * Math.PI) / 180);
    const inset = Math.min(w, d) / 2, ridge = [[x0 + inset, (z0 + z1) / 2], [x1 - inset, (z0 + z1) / 2]];
    const P = (x, y, z) => new THREE.Vector3(x, y, z);
    const c = [P(x0, eave, z0), P(x1, eave, z0), P(x1, eave, z1), P(x0, eave, z1)], r0 = P(ridge[0][0], eave + rise, ridge[0][1]), r1 = P(ridge[1][0], eave + rise, ridge[1][1]);
    if (w < d) { r0.set((x0 + x1) / 2, eave + rise, z0 + inset); r1.set((x0 + x1) / 2, eave + rise, z1 - inset); }
    const tris = w >= d ? [[c[0], c[1], r1], [c[0], r1, r0], [c[1], c[2], r1], [c[2], c[3], r0], [c[2], r0, r1], [c[3], c[0], r0]] : [[c[0], c[1], r0], [c[1], c[2], r1], [c[1], r1, r0], [c[2], c[3], r1], [c[3], c[0], r0], [c[3], r0, r1]];
    const pos = [];
    for (const t of tris) {
      // Keep every roof plane facing up/out regardless of how the corner list was ordered.
      const nrm = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0]));
      for (const v of nrm.y < 0 ? [t[0], t[2], t[1]] : t) pos.push(v.x, v.y, v.z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    walls.add(geo, 'roof', [0, 0, 0], [0, 0, 0], m.roof.evidence || 'estimate', false);
    top = Math.max(top, eave + rise);
  } else {
    const shape = new THREE.Shape(plan.map((p) => new THREE.Vector2(p[0], -p[1])));
    walls.add(new THREE.ShapeGeometry(shape), 'unknown', [0, eave - 0.05, 0], [-Math.PI / 2, 0, 0], m.roof?.evidence || 'unknown', false);
  }
  const wg = walls.finish('outline-walls');
  wg.traverse((o) => { if (o.isMesh) o.userData.structuralWall = true; });
  group.add(wg, details.finish('face-details'));
  const colors = { ...PALETTE, ...(m.colors || {}) };
  group.traverse((o) => {
    if (!o.isMesh) return;
    const color = colors[o.userData.materialTag];
    if (color) { o.material.color.set(color); o.userData.baseColor = color; }
  });
  return { id: s.id, group, height: top, focus: [0, H * 0.45, 0], planBoundary: plan.map((p) => [...p]), metricAccuracy: 'unverified', sourceIds: [s.sourceId], labels: [], openingChecks: checks.openings, solidChecks: checks.solids };
}
