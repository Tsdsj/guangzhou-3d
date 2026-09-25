import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import {buildSample} from '../src/models/detail-models.js';
const read=p=>JSON.parse(fs.readFileSync(p));

test('B2东侧二三层柱廊有真实后退深度，四层拱廊不被旧侧墙或玻璃封住',()=>{
 const data=read('prototypes/p2/samples.json'),s=data.buildings.B2,b=buildSample('B2',data),k=b.heightReference.scale;
 b.group.updateMatrixWorld(true);
 for(const y of [7,11,15]){
  const ray=new THREE.Raycaster(new THREE.Vector3(-s.width/2-2,y*k,0),new THREE.Vector3(1,0,0));
  const hits=ray.intersectObject(b.group,true);
  assert.ok(hits.length,'setback wall must remain');
  assert.ok(hits[0].distance>4,`gallery at ${y}: blocked at ${hits[0].distance}`);
 }
 const ground=new THREE.Raycaster(new THREE.Vector3(-s.width/2-2,2*k,0),new THREE.Vector3(1,0,0));
 assert.ok(ground.intersectObject(b.group,true)[0].distance<2.5,'ground floor must not disappear');
});

test('新柱廊来源、年代和估计深度同时保留，不将历史照片GPS误当定位依据',()=>{
 const data=read('prototypes/p2/samples.json'),p=data.photos['B2-c'];
 assert.ok(p,'reviewed photo must be available in comparator');
 assert.equal(p.license,'CC BY-SA 3.0');assert.equal(p.locationStatus,'rejected-outlier');
 assert.equal(data.buildings.B2.eastLoggia?.depthStatus,'estimated');
 assert.equal(data.buildings.B2.eastLoggia?.referenceEpoch,'2012-11-15');
 assert.equal(data.buildings.B2.eastLoggia?.openBays,5);
 assert.equal(data.buildings.B2.controlSources[data.buildings.B2.eastLoggia.sourceId].license,'CC BY-SA 3.0');
 assert.equal(data.buildings.B2.photoFace.status,'provisional');
 const m=read('data/detail/manifest.json'),b=m.tiles.flatMap(t=>t.buildings||[]).find(b=>b.sampleId==='B2');
 const outward=new THREE.Vector3(-1,0,0).applyAxisAngle(new THREE.Vector3(0,1,0),b.rotationY);
 assert.ok(outward.x>.99,'gallery normal must face east after city placement');
});
