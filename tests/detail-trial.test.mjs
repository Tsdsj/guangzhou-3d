import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadCity} from '../src/world/data.js';
import {DetailStream} from '../src/world/detail-stream.js';
const api=await import('../src/world/detail-trial.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
test('检查入口只由明确开关启用，默认城市不读取暂存清单',async t=>{
 assert.equal(typeof api.isDetailTrial,'function');assert.equal(api.isDetailTrial(''),false);assert.equal(api.isDetailTrial('?detailTrial=c01c02'),true);assert.equal(api.isDetailTrial('?detailTrial=inspect'),true);assert.equal(api.isDetailTrial('?detailTrial=anything'),false);
 const urls=[];t.mock.method(globalThis,'fetch',async url=>{urls.push(String(url));return new Response(fs.readFileSync(String(url).replace(/^\.\//,'')));});
 const base=await loadCity();await base.vegReady;assert.equal(base.detailManifest.tiles.length,4);assert.ok(!urls.some(u=>u.includes('trial-')));
 // C01/C02 are promoted into the default west block; the old south church part is replaced with the parent outline.
 const C01=base.detailManifest.tiles.find(t=>t.id==='shamian-west').buildings.find(b=>b.sampleId==='C01');assert.ok(C01.replaceIds.includes('osm:w509641363'));
 const trial=await loadCity(null,{detailTrial:true});await trial.vegReady;assert.equal(trial.detailTrial.enabled,true);
 const defaults=new Set(base.detailManifest.tiles.map(t=>t.id));
 assert.ok([...defaults].every(id=>trial.detailManifest.tiles.some(t=>t.id===id)),'staging manifest keeps every default tile');
 const staged=trial.detailManifest.tiles.filter(t=>!defaults.has(t.id));assert.ok(staged.every(t=>t.trialOnly===true));
 const owners=new Map();for(const t of trial.detailManifest.tiles)for(const b of t.buildings||[])for(const id of b.replaceIds){assert.ok(!owners.has(id),'two tiles replace '+id);owners.set(id,t.id);}
});
test('暂存资产不能在默认模式加载，故障注入只在检查入口作用于建筑块',()=>{
 assert.equal(typeof api.resolveDetailAsset,'function');
 const tile={id:'trial-x',kind:'buildings',trialOnly:true,url:'./data/detail/trial-x.json',buildings:[{sampleId:'X1'}]};
 assert.throws(()=>api.resolveDetailAsset(tile,{enabled:false}));
 assert.equal(api.resolveDetailAsset(tile,{enabled:true,failLoads:true}).url,'./data/detail/trial-missing.json');
 assert.equal(api.resolveDetailAsset(tile,{enabled:true}).prototype,true);
 const west={id:'shamian-west',kind:'buildings',url:'./data/detail/shamian-west.json',buildings:[{sampleId:'C01'}]};
 assert.equal(api.resolveDetailAsset(west,{enabled:false,failLoads:true}).url,'./data/detail/shamian-west.json','default mode never injects failures');
 assert.equal(api.resolveDetailAsset(west,{enabled:true,failLoads:true}).url,'./data/detail/trial-missing.json');
 assert.equal(api.resolveDetailAsset(west,{enabled:true}).prototype,false,'promoted tiles use the production model module');
 assert.equal(api.resolveDetailAsset({id:'huaxia',kind:'roads',url:'./data/detail/huaxia.json'},{enabled:true,failLoads:true}).url,'./data/detail/huaxia.json');
});
test('切回基础体量与强制重载都会先恢复旧对象，失败后可以重新载入',async()=>{
 const log=[];let fail=false;const stream=new DetailStream([{id:'t',bounds:[0,0,1,1]}],{load:async()=>{if(fail)throw new Error('404');return{};},activate:()=>log.push('new-on'),deactivate:()=>log.push('base-on'),dispose:()=>log.push('dispose')});
 assert.equal(typeof stream.setEnabled,'function');assert.equal(typeof stream.invalidate,'function');
 stream.update(0,0);await stream.settled();stream.setEnabled('t',false);assert.equal(stream.status()[0].active,false);assert.equal(log.at(-1),'base-on');
 stream.setEnabled('t',true);assert.equal(stream.status()[0].active,true);fail=true;stream.invalidate('t');assert.deepEqual(log.slice(-2),['base-on','dispose']);await stream.settled();assert.equal(stream.status()[0].state,'error');assert.equal(stream.status()[0].active,false);
 fail=false;stream.invalidate('t');await stream.settled();assert.equal(stream.status()[0].state,'ready');
 stream.update(5000,5000);assert.equal(stream.status()[0].state,'idle');assert.equal(stream.status()[0].active,false);
});
