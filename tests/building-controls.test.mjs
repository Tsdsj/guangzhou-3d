import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import {buildSample} from '../src/models/detail-models.js';
const controls=await import('../src/models/building-controls.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const read=p=>JSON.parse(fs.readFileSync(p));

test('文献檐高约束改变实际网格高度而保持平面，且不冒充总高或实测精度',()=>{
 assert.equal(typeof controls.applyVerticalControl,'function');
 const group=new THREE.Group(),part=new THREE.Group();part.position.y=2;group.add(part);
 const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,8,6),new THREE.MeshStandardMaterial());mesh.position.y=4;part.add(mesh);
 const sample={group,height:11,landmarks:{eave:10},focus:[0,5,0],labels:[{position:[0,7,0]}]};
 controls.applyVerticalControl(sample,{landmark:'eave',value:20.6,unit:'m',status:'reported',sourceId:'test-report',pages:[13,21]});
 const bounds=new THREE.Box3().setFromObject(group);
 assert.equal(bounds.min.x,-2);assert.equal(bounds.max.z,3);assert.ok(Math.abs(bounds.max.y-20.6)<1e-6);
 assert.equal(sample.landmarks.eave,20.6);assert.notEqual(sample.height,20.6);assert.equal(sample.heightReference.status,'reported');
 assert.ok(Math.abs(sample.labels[0].position[1]-14.42)<1e-10);
});

test('缺少来源或把总高误作檐高时拒绝标定',()=>{
 assert.equal(typeof controls.applyVerticalControl,'function');
 const s={group:new THREE.Group(),height:10,landmarks:{eave:9}};
 for(const v of [{landmark:'eave',value:20.6,unit:'m',status:'reported'}, {landmark:'total',value:20.6,unit:'m',status:'reported',sourceId:'x',pages:[1]}, {landmark:'eave',value:NaN,unit:'m',status:'reported',sourceId:'x',pages:[1]}])assert.throws(()=>controls.applyVerticalControl(s,v),/control|landmark/i);
});

test('B2生产与独立样件采用同一份文献檐高，另外两栋仍保持估计',()=>{
 const ledger=read('data/evidence/building-controls.json');
 for(const data of [read('data/detail/shamian.json').samples,read('prototypes/p2/samples.json')]){
  assert.deepEqual(data.buildings.B2.verticalControl,ledger.entities['osm:w352610258'].verticalControl);
  assert.equal(data.buildings.B2.verticalControl.independentlyMeasured,false);
  assert.match(data.buildings.B2.controlSources[data.buildings.B2.verticalControl.sourceId].sha256,/^[0-9a-f]{64}$/);
  const b=buildSample('B2',data);assert.equal(b.heightReference?.value,20.6);assert.equal(b.metricAccuracy,'unverified');
  assert.equal(b.heightReference?.status,'reported');assert.equal(b.landmarks.eave,20.6);
  assert.equal(buildSample('B1',data).height,14.2);assert.equal(buildSample('B3',data).height,25.4);
 }
});
