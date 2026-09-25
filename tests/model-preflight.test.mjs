import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three/build/three.module.js';
import {buildSample} from '../prototypes/p2/models.js';
const api=await import('../src/models/model-preflight.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const read=p=>JSON.parse(fs.readFileSync(p));
test('预检测量实际网格，忽略辅助线和标牌，不把源轮廓等同装饰外沿',()=>{
 assert.equal(typeof api.measureModel,'function');
 const group=new T.Group(),mesh=new T.Mesh(new T.BoxGeometry(2,4,2),new T.MeshBasicMaterial());mesh.position.y=2;group.add(mesh);
 const label=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial());label.position.y=200;label.userData.label=true;group.add(label);
 group.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0,0,0),new T.Vector3(0,100,0)]),new T.LineBasicMaterial()));
 const m=api.measureModel(group,[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]);
 assert.equal(m.maxY,4);assert.equal(m.minY,0);assert.ok(Math.abs(m.maxPlanOverhangM-Math.sqrt(.5))<1e-6);
 assert.equal(m.nonFiniteValues,0);
});
test('建筑预览地面沿用模型y=0，路口展示基座仍独立保留',()=>{
 assert.equal(typeof api.previewGroundY,'function');for(const id of ['B1','B2','B3','C01','C02','S1'])assert.equal(api.previewGroundY(id),0);assert.equal(api.previewGroundY('J1'),-.5);
});
test('B1显示模型实际最高点，B2文献檐高和S1辅助线不混作总高',()=>{
 const data=read('prototypes/p2/samples.json');data.skybridge=read('prototypes/p2/skybridge.json');
 const b=buildSample('B1',data);assert.ok(Math.abs(b.geometryMetrics?.maxY-14.4)<1e-5);
 const b2=buildSample('B2',data);assert.equal(b2.heightReference.value,20.6);assert.ok(b2.geometryMetrics.maxY>b2.heightReference.value);
 const bridge=buildSample('S1',data);assert.ok(Math.abs(bridge.geometryMetrics.maxY-9.9)<1e-5);
});
test('C02最高台阶与门洞下沿一致，不高出门槛0.33m',()=>{
 const s=read('prototypes/p2/c02.json'),m=buildSample('C02',{buildings:{C02:s}});m.group.updateMatrixWorld(true);
 const ray=new T.Raycaster(new T.Vector3(0,1,s.depth/2-.05),new T.Vector3(0,-1,0));
 const hit=ray.intersectObject(m.group,true).find(h=>h.object.isMesh);
 assert.ok(hit);assert.ok(Math.abs(hit.point.y-.45)<1e-5,`stair top ${hit.point.y}`);
});
