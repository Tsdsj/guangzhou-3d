import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import {buildSample} from '../prototypes/p2/models.js';
const load=()=>{assert.ok(fs.existsSync('prototypes/p2/c02.json'),'C02 sample input required');return JSON.parse(fs.readFileSync('prototypes/p2/c02.json'));};
test('C02模型四个轮廓控制点对应源坐标，保留已核身份和未知高度',()=>{
 const s=load(),m=buildSample('C02',{buildings:{C02:s}});
 assert.equal(s.sourceId,'osm:w352610288');assert.equal(s.identityStatus,'document-address-supported');
 m.planBoundary.forEach((p,i)=>assert.ok(Math.hypot(p[0]-s.planFit.target[i][0],p[1]-s.planFit.target[i][1])<1e-6));
 assert.equal(s.measuredHeightM,null);assert.equal(s.heightStatus,'estimated');
 assert.equal(s.productionEligible,true);assert.equal(s.productionGate.status,'integrated-default-estimated');assert.equal(s.productionGate.dimensions,'estimated');assert.equal(s.productionGate.metricAccuracy,'unverified');assert.ok(fs.existsSync(s.productionGate.acceptanceRecord));
});
test('C02三拱墙洞和后退入口实际存在，拱肩及未知背面不能穿透',()=>{
 const s=load(),m=buildSample('C02',{buildings:{C02:s}});m.group.updateMatrixWorld(true);
 const walls=[];m.group.traverse(o=>{if(o.userData.structuralWall)walls.push(o);});
 for(const p of m.apertureChecks){const ray=new THREE.Raycaster(new THREE.Vector3(...p.origin),new THREE.Vector3(0,0,-1),0,p.maxDistance);assert.equal(ray.intersectObjects(walls).length,0,p.name);}
 assert.equal(m.apertureChecks.length,4);
 for(const p of m.solidChecks){const ray=new THREE.Raycaster(new THREE.Vector3(...p.origin),new THREE.Vector3(...p.direction),0,2);assert.ok(ray.intersectObjects(walls).length>0,p.name);}
});
test('C02未知侧后面保持简化，照片及网格有可追溯边界',()=>{
 const s=load(),m=buildSample('C02',{buildings:{C02:s}});let unknown=0,tris=0,count=0;
 m.group.traverse(o=>{if(!o.isMesh)return;count++;unknown+=o.userData.evidence==='unknown';tris+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));});
 assert.ok(unknown>0&&count<70&&tris<100000&&tris>500);
 assert.equal(s.photo.date,'2023-01-07 14:11:32');assert.equal(s.photo.pixelRegistrationVerified,false);
 assert.equal(m.metricAccuracy,'unverified');assert.equal(m.topology.visible,false);
});

test('C02入口为两组双圆柱及两组双方柱，左翼三窗独立有照片支持',()=>{
 const s=load(),m=buildSample('C02',{buildings:{C02:s}});m.group.updateMatrixWorld(true);
 assert.equal(s.porticoReview?.roundColumnCount,4);assert.equal(s.porticoReview.squareColumnCount,4);
 assert.equal(s.porticoReview.photoId,'C02-b');assert.equal(s.faceReview.leftWing,'photo-supported-2021');
 assert.equal(m.porticoColumns?.length,8);
 for(const c of m.porticoColumns){const ray=new THREE.Raycaster(new THREE.Vector3(...c.probe),new THREE.Vector3(0,0,-1),0,.9);assert.ok(ray.intersectObject(m.group,true).some(h=>!h.object.userData.structuralWall),c.kind);}
 assert.equal(m.leftWindowChecks?.length,3);
 for(const c of m.leftWindowChecks){const ray=new THREE.Raycaster(new THREE.Vector3(...c),new THREE.Vector3(0,0,-1),0,1.3);assert.equal(ray.intersectObject(m.group,true).filter(h=>h.object.userData.structuralWall).length,0);}
 assert.equal(s.parameters.totalHeightM,16.4);assert.equal(s.parameters.porchDepthM,2.2);
 assert.equal(s.photos['C02-b'].date,'2021-12-28');assert.equal(s.photos['C02-plaque'].license,'CC BY-SA 4.0');
});
