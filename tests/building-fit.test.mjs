import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import { buildSample } from '../src/models/detail-models.js';
const fit=await import('../src/models/building-fit.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const read=p=>JSON.parse(fs.readFileSync(p));

test('轮廓配准对凸出部分逐点映射，保留高度且不折叠平面',()=>{
  assert.equal(typeof fit.createPlanFit,'function');
  const source=[[-4,-10],[4,-10],[4,10],[2,10],[2,14],[-2,14],[-2,10],[-4,10]];
  const target=source.map(([x,z])=>[x*1.1+z*.025,z*.95]);
  const map=fit.createPlanFit({source,target});
  for(let i=0;i<source.length;i++){
    const p=map.point(new THREE.Vector3(source[i][0],7,source[i][1]));
    assert.ok(Math.hypot(p.x-target[i][0],p.z-target[i][1])<1e-9);assert.equal(p.y,7);
  }
  assert.throws(()=>fit.createPlanFit({source,target:target.map(([x,z])=>[-x,z])}),/fold|orientation/i);
});

test('生产样件平面控制边界映射回原始OSM轮廓，钟塔凸出不再使用固定偏移',()=>{
  const manifest=read('data/detail/manifest.json');const data=read('data/detail/shamian.json').samples;
  for(const tile of manifest.tiles.filter(t=>t.kind==='buildings'))for(const b of tile.buildings){
    const samples=read(tile.url).samples;
    // Facade studies carry the source outline directly as their model-frame plan.
    assert.ok(samples.buildings[b.sampleId].planFit||samples.buildings[b.sampleId].kind==='facade-study',`${b.sampleId}: source fit required`);
    const result=buildSample(b.sampleId,samples);
    assert.ok(result.planBoundary?.length===b.footprint.length);
    const c=Math.cos(b.rotationY),s=Math.sin(b.rotationY);
    for(const [x,z]of result.planBoundary){
      const world=[b.position[0]+c*x*b.scale[0]+s*z*b.scale[2],b.position[2]-s*x*b.scale[0]+c*z*b.scale[2]];
      assert.ok(Math.min(...b.footprint.map(p=>Math.hypot(p[0]-world[0],p[1]-world[1])))<1e-5);
    }
  }
  const stale=structuredClone(data);stale.buildings.B3.width+=1;
  assert.throws(()=>buildSample('B3',stale),/Model plan changed/);
});

test('沙面一街3号入口和三层中央窗采用照片中的拱形，拱肩外不能留矩形空洞',()=>{
  const data=read('prototypes/p2/samples.json'),sample=buildSample('B2',data);
  const front=sample.group.getObjectByName('bank-front');front.updateWorldMatrix(true,true);
  const wall=front.children.find(o=>o.userData.materialTag==='stone'&&!o.userData.detail);
  assert.ok(wall);wall.material.side=THREE.DoubleSide;
  const z=data.buildings.B2.depth/2;
  const scale=sample.heightReference?.scale||1;
  const ray=new THREE.Raycaster(new THREE.Vector3(1,3.95*scale,z+2),new THREE.Vector3(0,0,-1));
  assert.ok(ray.intersectObject(wall).length>0,'entrance arch shoulder must be solid');
  ray.set(new THREE.Vector3(.9,12.15*scale,z+2),new THREE.Vector3(0,0,-1));
  assert.ok(ray.intersectObject(wall).length>0,'third-floor arch shoulder must be solid');
  ray.set(new THREE.Vector3(0,3.95*scale,z+2),new THREE.Vector3(0,0,-1));
  assert.equal(ray.intersectObject(wall).length,0,'arch crown remains open');
});

test('配准实际作用于嵌套网格，保持高度、法线和阴影属性',()=>{
  assert.equal(typeof fit.fitSamplePlan,'function');
  const group=new THREE.Group(),nested=new THREE.Group();nested.position.set(2,0,3);group.add(nested);
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,8,2),new THREE.MeshStandardMaterial());mesh.position.y=4;mesh.castShadow=true;nested.add(mesh);
  const before=new THREE.Box3().setFromObject(group);
  const sample={group,labels:[],focus:[2,4,3]};
  fit.fitSamplePlan(sample,{source:[[-10,-10],[10,-10],[10,10],[-10,10]],target:[[-21,-10],[19,-10],[21,10],[-19,10]]});
  const after=new THREE.Box3().setFromObject(group);
  assert.equal(after.min.y,before.min.y);assert.equal(after.max.y,before.max.y);assert.ok(after.max.x>before.max.x);assert.equal(mesh.castShadow,true);
  const normal=mesh.geometry.attributes.normal;
  for(let i=0;i<normal.count;i++)assert.ok(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-6);
  assert.ok(Math.abs(sample.focus[0]-4.3)<1e-10);assert.equal(sample.focus[1],4);assert.equal(sample.focus[2],3);
});
