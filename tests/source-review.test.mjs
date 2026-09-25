import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root='docs/research/p3-source-review-2026-09-26/',read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('补采响应全部有可复核来源与校验值，增量只增加3条way和7个节点',()=>{
 const sources=read(root+'sources.json'),delta=read('data/evidence/huacheng-review-delta.json');
 assert.equal(sources.requests.length,16);
 for(const r of sources.requests){assert.equal(r.status,'ok');assert.ok(r.url.startsWith('https://api.openstreetmap.org/api/0.6/'));assert.equal(hash(root+r.file),r.sha256);}
 assert.equal(hash('data/evidence/huacheng-osm.json'),delta.baseSha256);
 const base=read('data/evidence/huacheng-osm.json').elements,keys=new Set(base.map(e=>e.type+':'+e.id));
 for(const e of delta.elements){assert.ok(!keys.has(e.type+':'+e.id));keys.add(e.type+':'+e.id);}
 assert.equal(delta.elements.filter(e=>e.type==='way').length,3);assert.equal(delta.elements.filter(e=>e.type==='node').length,7);
 for(const e of delta.elements.filter(e=>e.type==='way'))for(const id of e.nodes)assert.ok(keys.has('node:'+id));
});

test('端点结论绑定实际引用，标线未因重复标签或旧照片被自动升级',()=>{
 const r=read(root+'review.json');assert.equal(r.endpoints.length,10);
 assert.deepEqual(r.endpointSummary,{'connection-recovered':3,'building-interface':3,'tagged-terminal':2,'needs-evidence':2});
 for(const row of r.endpoints){assert.equal(row.physicalPassabilityVerified,false);for(const end of row.endpoints){
  const ways=read(root+end.responseFile).elements;
  for(const linked of end.linkedWays){const way=ways.find(w=>'osm:w'+w.id===linked.sourceId);assert.ok(way.nodes.includes(Number(end.nodeId.split(':n')[1])));}
 }}
 assert.equal(r.markings.length,14);assert.deepEqual(r.markingSummary,{unknown:8,conflict:6});
 const selected=new Map(read(root+'selected-ways.json').elements.map(e=>['osm:w'+e.id,e]));
 for(const m of r.markings){assert.deepEqual(m.tags,selected.get(m.sourceId).tags);assert.equal(m.currentStatus,m.previousStatus);assert.equal(m.renderDecision,'deferred-no-new-independent-evidence');}
 for(const p of read(root+'photos.json')){assert.equal(hash(root+p.file),p.sha256);assert.equal(p.markingDecision,'insufficient-for-target-way');}
 assert.equal(r.renderGeometryUpdated,false);
});
