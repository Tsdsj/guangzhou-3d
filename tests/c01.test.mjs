import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import {buildSample} from '../prototypes/p2/models.js';
const load=()=>{assert.ok(fs.existsSync('prototypes/p2/c01.json'),'C01 package required');return JSON.parse(fs.readFileSync('prototypes/p2/c01.json'));};
test('C01八个源轮廓控制点都配准，南凸入口与北侧彩窗不反置',()=>{
 const s=load(),m=buildSample('C01',{buildings:{C01:s}});
 assert.equal(m.planBoundary.length,8);
 m.planBoundary.forEach((p,i)=>assert.ok(Math.hypot(p[0]-s.planFit.target[i][0],p[1]-s.planFit.target[i][1])<1e-6));
 assert.equal(s.faces.north.photoId,'C01-a');assert.equal(s.faces.south.photoId,'C01-c');
 assert.equal(s.photos['C01-a'].face,'north-end');
 assert.ok(s.planFit.target[3][1]>s.planFit.target[0][1]);
 assert.equal(s.heightStatus,'estimated');assert.equal(s.measuredHeightM,null);
 // Integrated into the default city after P3 acceptance; integration does not upgrade dimensions.
 assert.equal(s.productionEligible,true);assert.equal(s.productionGate.status,'integrated-default-estimated');assert.equal(s.productionGate.dimensions,'estimated');assert.equal(s.productionGate.metricAccuracy,'unverified');assert.ok(fs.existsSync(s.productionGate.acceptanceRecord));
});
test('C01南门廊是实际凹入开口，北彩窗墙洞贯通而非贴在实墙上',()=>{
 const s=load(),m=buildSample('C01',{buildings:{C01:s}});m.group.updateMatrixWorld(true);
 for(const check of m.openingChecks){
  const ray=new THREE.Raycaster(new THREE.Vector3(...check.origin),new THREE.Vector3(...check.direction),0,check.maxDistance);
  assert.equal(ray.intersectObject(m.group,true).filter(hit=>hit.object.userData.structuralWall).length,0,check.name);
 }
 assert.ok(m.openingChecks.length>=2);
});
test('C01未知长侧保留低细节，历史照片不伪装同期测绘，网格有限',()=>{
 const s=load(),m=buildSample('C01',{buildings:{C01:s}});let unknown=0,tris=0;
 m.group.traverse(o=>{if(!o.isMesh)return;unknown+=o.userData.evidence==='unknown';tris+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));});
 assert.ok(unknown>0);assert.ok(tris>300&&tris<100000);assert.equal(m.metricAccuracy,'unverified');
 assert.equal(s.photos['C01-b'].date,'2009-04-17');assert.equal(s.photos['C01-c'].date,'2023-04-24');
});

test('C01北段四个侧窗真实开洞，未覆盖南段仍为实墙',()=>{
 const s=load(),m=buildSample('C01',{buildings:{C01:s}});m.group.updateMatrixWorld(true);
 assert.equal(s.sideWindowReview?.visiblePerSide,2);
 assert.equal(s.sideWindowReview.epoch,'2009-04-17');
 assert.equal(s.sideWindowReview.exteriorTrimVerified,false);
 const checks=m.sideOpeningChecks;assert.equal(checks?.length,4);
 for(const c of checks){const ray=new THREE.Raycaster(new THREE.Vector3(...c.origin),new THREE.Vector3(...c.direction),0,c.maxDistance);assert.equal(ray.intersectObject(m.group,true).filter(h=>h.object.userData.structuralWall).length,0);}
 const ray=new THREE.Raycaster(new THREE.Vector3(s.width/2+1,3,s.naveDepth*.3),new THREE.Vector3(-1,0,0),0,2);
 assert.ok(ray.intersectObject(m.group,true).some(h=>h.object.userData.structuralWall&&h.object.userData.evidence==='unknown'));
 assert.equal(s.parameters.towerTopM,19.4);assert.equal(s.porchWidth,3.7513876508165525);
});
