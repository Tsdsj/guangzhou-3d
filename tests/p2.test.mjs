import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
const modules = await import('../prototypes/p2/models.js').catch((e) => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const shapes = await import('../prototypes/p2/geometry.js').catch((e) => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const camera = await import('../prototypes/p2/camera.js').catch((e) => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });

test('正面到背面预设绕模型移动，中途不会穿过模型中心', () => {
  assert.equal(typeof camera.interpolatePose, 'function', 'interpolatePose is required');
  const target = new THREE.Vector3(0, 7, 0);
  const motion = { from: new THREE.Vector3(0, 18, 60), to: new THREE.Vector3(0, 18, -60), fromTarget: target, toTarget: target };
  for(let i=0;i<=20;i++){
    const pose=camera.interpolatePose(motion,i/20);
    assert.ok(pose.position.distanceTo(target)>59);
  }
  assert.ok(camera.interpolatePose(motion,1).position.distanceTo(motion.to)<1e-8);
});

test('P2 墙面窗洞真实贯通：洞中心射线不会撞在墙体表面', () => {
  assert.equal(typeof shapes.wallGeometry, 'function', 'wallGeometry is required');
  const geo = shapes.wallGeometry(10, 8, 0.35, [{ x: 0, y: 2, width: 2, height: 3, kind: 'arch' }]);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, 4), new THREE.Vector3(0, 0, -1));
  assert.equal(ray.intersectObject(mesh).length, 0);
  ray.set(new THREE.Vector3(3, 3, 4), new THREE.Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(mesh).length > 0);
});

test('四个质量样件有有限坐标、独立来源和可切换细节，未知面不伪装成已核实', () => {
  assert.equal(typeof modules.buildSample, 'function', 'buildSample is required');
  const data = JSON.parse(fs.readFileSync('prototypes/p2/samples.json'));
  for (const id of ['B1', 'B2', 'B3', 'J1']) {
    const sample = modules.buildSample(id, data);
    sample.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(sample.group);
    assert.ok(Number.isFinite(box.max.y) && box.max.y > 0);
    let meshes = 0; let triangles = 0; let unknown = 0; let detail = 0;
    sample.group.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));
      triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3;
      unknown += o.userData.evidence === 'unknown';
      detail += !!o.userData.detail;
    });
    assert.ok(meshes < 160, `${id}: batch geometry instead of thousands of draws`);
    assert.ok(triangles > 100 && triangles < 350000, `${id}: bounded geometry`);
    assert.ok(detail > 0);
    if (id !== 'J1') assert.ok(unknown > 0, `${id}: unknown rear must remain explicit`);
    assert.equal(sample.metricAccuracy, 'unverified');
    assert.ok(sample.sourceIds.length > 0);
  }
});

test('路口使用真实节点与共享面域；模型路幅不能写成实测宽度', () => {
  assert.ok(fs.existsSync('prototypes/p2/samples.json'), 'sample data is required');
  const { road } = JSON.parse(fs.readFileSync('prototypes/p2/samples.json'));
  assert.equal(road.widthStatus, 'estimated');
  assert.equal(road.restrictions.length, 4);
  assert.ok(road.restrictions.every((r) => r.tags.restriction === 'no_u_turn'));
  assert.ok(road.crossings.length > 0 && road.surfaces.length > 0);
  assert.ok(road.lines.every((r) => r.sourceId.startsWith('osm:w')));
});
