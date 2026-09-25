import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Parts } from '../src/world/parts.js';
const optional=async p=>import(p).catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const loading=await optional('../src/world/detail-stream.js');
const spatial=await optional('../src/world/detail-spatial.js');
const requireFn=(o,n)=>{assert.equal(typeof o[n],'function',`${n} is required`);return o[n];};

test('精细块只在成功加载且仍需要时替换基础模型，远离后回退并释放', async()=>{
  const Controller=requireFn(loading,'DetailStream');let resolve;const events=[];
  const c=new Controller([{id:'a',bounds:[-10,-10,10,10]}],{load:()=>new Promise(r=>resolve=r),activate:(id)=>events.push('on:'+id),deactivate:(id)=>events.push('off:'+id),dispose:()=>events.push('dispose')},{loadDistance:20,releaseDistance:40});
  c.update(0,0);assert.deepEqual(events,[]);resolve({asset:true});await c.settled();assert.deepEqual(events,['on:a']);
  c.update(100,100);assert.deepEqual(events,['on:a','off:a','dispose']);assert.equal(c.status()[0].state,'idle');
});
test('离开后到达的过期资源不能覆盖新视图，失败保持基础模型',async()=>{
  const Controller=requireFn(loading,'DetailStream');let resolve;const events=[];
  const c=new Controller([{id:'a',bounds:[-1,-1,1,1]}],{load:()=>new Promise(r=>resolve=r),activate:()=>events.push('on'),deactivate:()=>events.push('off'),dispose:()=>events.push('dispose')},{loadDistance:10,releaseDistance:20});
  c.update(0,0);c.update(100,100);resolve({});await c.settled();assert.deepEqual(events,['dispose']);
  const fail=new Controller([{id:'a',bounds:[0,0,1,1]}],{load:async()=>{throw new Error('404');},activate:()=>events.push('bad'),deactivate:()=>{},dispose:()=>{}},{loadDistance:10,releaseDistance:20});
  fail.update(0,0);await fail.settled();assert.equal(fail.status()[0].state,'error');assert.ok(!events.includes('bad'));
});
test('旋转填充体只按目标轮廓交叠分组，邻居与纯边界接触不会误删',()=>{
  const overlaps=requireFn(spatial,'polygonsOverlap');
  const a=[[0,0],[10,0],[10,10],[0,10]];
  assert.equal(overlaps(a,[[2,2],[3,2],[3,3],[2,3]]),true);
  assert.equal(overlaps(a,[[10,2],[12,2],[12,4],[10,4]]),false);
  assert.equal(overlaps(a,[[20,2],[22,2],[22,4],[20,4]]),false);
  assert.equal(overlaps(a,[[-1,4],[4,-1],[11,6],[6,11]]),true);
});
test('集成清单包含三栋已确认样件、相邻双路口与明确的估计精度',()=>{
  assert.ok(fs.existsSync('data/detail/manifest.json'),'detail manifest is required');
  const m=JSON.parse(fs.readFileSync('data/detail/manifest.json'));
  const buildings=m.tiles.flatMap(t=>t.buildings||[]);
  assert.equal(buildings.length,3);assert.equal(m.tiles.filter(t=>t.kind==='roads').length,2);
  assert.ok(buildings.every(b=>b.precision==='estimated'&&b.sourceId.startsWith('osm:')));
  assert.ok(buildings.find(b=>b.sampleId==='B3').replaceIds.includes('osm:w1521332870'));
});
test('分组输出屋顶和构件不会改变后续非目标构件的随机种子',()=>{
  const route=requireFn(spatial,'emitRoutedParts');const base=new Parts(),target=new Parts(),reference=new Parts();
  const emit=(p,x)=>p.add('box',x,0,0,0,1,1,1,0,[1,1,1],[1,1,1]);
  for(let i=0;i<5;i++)emit(reference,i);
  for(let i=0;i<5;i++)route(base,i===2?target:base,p=>emit(p,i));
  const b=base.parts.box,r=reference.parts.box;
  assert.equal(base.seedCounter,reference.seedCounter);
  assert.deepEqual(Array.from(b.FA.slice(3*4,4*4)),Array.from(r.FA.slice(4*4,5*4)));
});
test('高空俯瞰不加载地面精细块，两块道路共享准确边界',()=>{
  const Controller=requireFn(loading,'DetailStream');let requested=0;
  const c=new Controller([{id:'a',bounds:[-5,-5,5,5]}],{load:async()=>{requested++;return{};},activate:()=>{},deactivate:()=>{},dispose:()=>{}});
  c.update(0,0,5000);assert.equal(requested,0);
  const m=JSON.parse(fs.readFileSync('data/detail/manifest.json'));const roads=m.tiles.filter(t=>t.kind==='roads');
  assert.equal(roads[0].bounds[2],roads[1].bounds[0]);
  assert.equal(roads[0].bounds[1],roads[1].bounds[1]);
  assert.equal(roads[0].bounds[3],roads[1].bounds[3]);
});
