import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadCity} from '../src/world/data.js';
import {DetailStream} from '../src/world/detail-stream.js';
const api=await import('../src/world/detail-trial.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
test('试落位只由明确开关启用，默认城市不读取试验清单',async t=>{
 assert.equal(typeof api.isDetailTrial,'function');assert.equal(api.isDetailTrial(''),false);assert.equal(api.isDetailTrial('?detailTrial=c01c02'),true);assert.equal(api.isDetailTrial('?detailTrial=anything'),false);
 const urls=[];t.mock.method(globalThis,'fetch',async url=>{urls.push(String(url));return new Response(fs.readFileSync(String(url).replace(/^\.\//,'')));});
 const base=await loadCity();await base.vegReady;assert.equal(base.detailManifest.tiles.length,3);assert.ok(!urls.some(u=>u.includes('trial-')));
 const trial=await loadCity(null,{detailTrial:true});await trial.vegReady;assert.equal(trial.detailManifest.tiles.length,5);
 const C01=trial.detailManifest.tiles.find(t=>t.id==='trial-c01').buildings[0];assert.ok(C01.replaceIds.includes('osm:w509641363'));assert.equal(trial.detailTrial.enabled,true);
});
test('试验资产不能在默认模式加载，故障注入只作用于试验瓦片',()=>{
 assert.equal(typeof api.resolveDetailAsset,'function');
 const tile={id:'trial-c01',trialOnly:true,url:'./data/detail/trial-c01.json',buildings:[{sampleId:'C01'}]};
 assert.throws(()=>api.resolveDetailAsset(tile,{enabled:false}));
 assert.equal(api.resolveDetailAsset(tile,{enabled:true,failLoads:true}).url,'./data/detail/trial-missing.json');
 assert.equal(api.resolveDetailAsset({url:'./data/detail/shamian.json'},{enabled:true,failLoads:true}).url,'./data/detail/shamian.json');
});
test('切回基础体量与强制重载都会先恢复旧对象，失败后可以重新载入',async()=>{
 const log=[];let fail=false;const stream=new DetailStream([{id:'t',bounds:[0,0,1,1]}],{load:async()=>{if(fail)throw new Error('404');return{};},activate:()=>log.push('new-on'),deactivate:()=>log.push('base-on'),dispose:()=>log.push('dispose')});
 assert.equal(typeof stream.setEnabled,'function');assert.equal(typeof stream.invalidate,'function');
 stream.update(0,0);await stream.settled();stream.setEnabled('t',false);assert.equal(stream.status()[0].active,false);assert.equal(log.at(-1),'base-on');
 stream.setEnabled('t',true);assert.equal(stream.status()[0].active,true);fail=true;stream.invalidate('t');assert.deepEqual(log.slice(-2),['base-on','dispose']);await stream.settled();assert.equal(stream.status()[0].state,'error');assert.equal(stream.status()[0].active,false);
 fail=false;stream.invalidate('t');await stream.settled();assert.equal(stream.status()[0].state,'ready');
 stream.update(5000,5000);assert.equal(stream.status()[0].state,'idle');assert.equal(stream.status()[0].active,false);
});
