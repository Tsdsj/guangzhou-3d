import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from '../vendor/three/build/three.module.js';
import { buildSample } from '../src/models/detail-models.js';
import { measureModel } from '../src/models/model-preflight.js';

const read = (p) => JSON.parse(fs.readFileSync(p));
const studies = read('prototypes/p2/facade-studies.json');
const evidence = read('data/evidence/facade-studies.json');
const build = (id) => buildSample(id, { buildings: studies.studies });

test('立面研究的主立面落在源轮廓边上，只用显式旋转平移，控制点零残差', () => {
  assert.ok(Object.keys(studies.studies).length >= 6);
  for (const p of studies.placements) {
    const s = studies.studies[p.sampleId], e = s.model.faces[0].edge, a = s.plan[e], b = s.plan[(e + 1) % s.plan.length];
    assert.ok(Math.abs(a[1] - b[1]) < 1e-9 && a[1] > 0, `${p.sampleId}: primary face must be on constant z > 0`);
    assert.deepEqual(p.scale, [1, 1, 1]);
    const c = Math.cos(p.rotationY), sn = Math.sin(p.rotationY);
    s.plan.forEach(([x, z], i) => {
      const w = [p.position[0] + c * x + sn * z, p.position[2] - sn * x + c * z];
      assert.ok(Math.hypot(w[0] - p.footprint[i][0], w[1] - p.footprint[i][1]) < 1e-6, `${p.sampleId} vertex ${i}`);
    });
  }
});

test('照片中的窗洞真实贯通结构墙，窗间墙体保持实心；未覆盖面保留为未知灰墙', () => {
  for (const id of Object.keys(studies.studies)) {
    const m = build(id);
    m.group.updateMatrixWorld(true);
    const walls = [];
    m.group.traverse((o) => { if (o.isMesh && o.userData.structuralWall) walls.push(o); });
    assert.ok(m.openingChecks.length >= studies.studies[id].model.faces[0].bays, `${id}: every bay has at least one probe`);
    for (const c of m.openingChecks) {
      const ray = new THREE.Raycaster(new THREE.Vector3(...c.origin), new THREE.Vector3(...c.direction), 0, c.maxDistance);
      assert.equal(ray.intersectObjects(walls).length, 0, `${id} storey ${c.storey}: opening blocked`);
    }
    for (const c of m.solidChecks) {
      const ray = new THREE.Raycaster(new THREE.Vector3(...c.origin), new THREE.Vector3(...c.direction), 0, c.maxDistance);
      assert.ok(ray.intersectObjects(walls).length > 0, `${id} storey ${c.storey}: pier should be solid`);
    }
    let unknown = 0, tris = 0;
    m.group.traverse((o) => { if (o.isMesh) { unknown += o.userData.evidence === 'unknown'; tris += o.geometry.attributes.position.count / 3; } });
    assert.ok(unknown > 0, `${id}: uncovered faces must stay unknown`);
    const metrics = measureModel(m.group, m.planBoundary);
    assert.equal(metrics.nonFiniteValues, 0);
    assert.ok(tris < 60000, `${id}: triangle budget`);
    assert.ok(metrics.maxPlanOverhangM < 1.2, `${id}: cornice/roof overhang stays bounded`);
  }
});

test('每栋都有地址或名称身份、带许可与哈希的照片、估计尺寸与门槛记录，不把照片冒充测量', () => {
  for (const b of evidence.buildings) {
    const s = studies.studies[b.id];
    assert.ok(b.identity.basis.length >= 2 && b.address);
    assert.equal(s.measuredHeightM, null);
    assert.equal(s.heightStatus, 'estimated');
    assert.equal(s.metricAccuracy, 'unverified');
    for (const [pid, p] of Object.entries(s.photos)) {
      assert.match(p.license, /^CC (BY|BY-SA) [34]\.0$|^CC0$/, pid);
      assert.ok(p.url.startsWith('https://commons.wikimedia.org/'), pid);
      assert.equal(p.pixelRegistrationVerified, false);
      const local = p.path.replace(/^\.\.\/\.\.\//, '');
      assert.equal(createHash('sha256').update(fs.readFileSync(local)).digest('hex'), p.thumbSha256, pid);
    }
    if (s.productionEligible) assert.equal(s.productionGate.dimensions, 'estimated');
    for (const f of b.faces) assert.ok(f.observed.length > 40 && f.photos.every((pid) => s.photos[pid]));
  }
});
