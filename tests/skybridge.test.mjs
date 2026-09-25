import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import {buildSample} from '../prototypes/p2/models.js';

test('S1源接口共享实际建筑节点，长度按源坐标推导，高度独立保留未知',()=>{
  assert.ok(fs.existsSync('prototypes/p2/skybridge.json'),'S1 source package required');
  const s=JSON.parse(fs.readFileSync('prototypes/p2/skybridge.json'));
  const raw=JSON.parse(fs.readFileSync('data/evidence/huacheng-osm.json')).elements;
  const way=raw.find(e=>e.type==='way'&&'osm:w'+e.id===s.sourceId);
  assert.deepEqual(s.interfaces.map(e=>e.nodeId),way.nodes);
  for(const p of s.interfaces){
    const b=raw.find(e=>e.type==='way'&&'osm:w'+e.id===p.buildingId);
    assert.ok(b.nodes.includes(p.nodeId));
    assert.equal(p.doorVerified,false);
  }
  assert.ok(s.lengthM>40&&s.lengthM<50);
  assert.equal(s.measuredDeckElevationM,null);
  assert.equal(s.parameters.deckTopM.status,'estimated');
  assert.equal(s.parameters.widthM.status,'estimated');
  assert.equal(s.photoMatch,'provisional');
});

test('S1留有贯通内部，剖开部件可独立隐藏，未知背面不按照片核实',()=>{
  assert.ok(fs.existsSync('prototypes/p2/skybridge.json'),'S1 source package required');
  const s=JSON.parse(fs.readFileSync('prototypes/p2/skybridge.json'));
  const m=buildSample('S1',{skybridge:s});m.group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(-s.lengthM/2-1,s.parameters.deckTopM.value+1.5,0),new THREE.Vector3(1,0,0));
  assert.equal(ray.intersectObject(m.group,true).filter(h=>h.object.isMesh).length,0,'no solid box through passage');
  assert.ok(m.sectionMeshes.length>=2);
  assert.ok(m.sectionMeshes.every(o=>o.isMesh));
  assert.ok(m.group.children.some(o=>o.userData.evidence==='unknown'));
  assert.equal(m.metricAccuracy,'unverified');
  assert.equal(m.topology.visible,false);
  let tris=0;
  m.group.traverse(o=>{if(!o.isMesh)return;assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));tris+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});
  assert.ok(tris>100&&tris<30000);
});

test('S1本地坐标保持东-北-天右手性；从北侧观察不镜像源建筑',()=>{
  const s=JSON.parse(fs.readFileSync('prototypes/p2/skybridge.json'));
  // x points Spring -> Summer. With y up, geographic north must point toward -z.
  const raw=JSON.parse(fs.readFileSync('data/evidence/huacheng-osm.json')).elements;
  const midLat=s.origin[1]*Math.PI/180,[ux,un]=s.axisEastNorth;
  const spring=raw.find(e=>e.type==='way'&&e.id===299812757);
  const sourceNode=raw.find(e=>e.type==='node'&&e.id===spring.nodes[spring.nodes.indexOf(5396001464)-1]);
  const east=(sourceNode.lon-s.origin[0])*Math.PI/180*6371008.8*Math.cos(midLat);
  const north=(sourceNode.lat-s.origin[1])*Math.PI/180*6371008.8;
  const expected=[east*ux+north*un,east*un-north*ux];
  // Intersect the real adjacent contour edge with z=12, matching the study clip.
  const alpha=12/expected[1];expected[0]=-s.lengthM/2+(expected[0]+s.lengthM/2)*alpha;expected[1]=12;
  assert.ok(s.contextFootprints[0].outer.some(p=>Math.hypot(p[0]-expected[0],p[1]-expected[1])<.1),'source contour should not be mirrored');
  const sample=buildSample('S1',{skybridge:s});
  const glass=sample.sectionMeshes.find(o=>o.userData.materialTag==='glass');glass.geometry.computeBoundingBox();
  assert.ok(glass.geometry.boundingBox.max.z<0,'photo-facing side is north provisionally');
});

test('S1历史楼层不推导米制标高或当前通行权限',()=>{
  const s=JSON.parse(fs.readFileSync('prototypes/p2/skybridge.json'));
  assert.equal(s.interfaceEvidence?.springFloor?.label,'三楼');
  assert.equal(s.interfaceEvidence.springFloor.epoch,'2013-07-12');
  assert.equal(s.interfaceEvidence.springFloor.status,'historically-reported');
  assert.equal(s.interfaceEvidence.summerFloor,null);
  assert.equal(s.interfaceEvidence.currentAccessVerified,false);
  assert.equal(s.measuredDeckElevationM,null);
  assert.equal(s.parameters.deckTopM.value,6.5);
  assert.equal(s.productionEligible,false);
});
