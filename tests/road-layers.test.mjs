import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>JSON.parse(fs.readFileSync(p));

test('分层清单可追溯到源way，延期桥隧台阶不能进入地面路径集合',()=>{
 const m=read('data/detail/manifest.json'),a=read('docs/research/p3-road-layers/audit.json');
 const raw=read('data/evidence/huacheng-osm.json'),ways=new Map(raw.elements.filter(e=>e.type==='way').map(e=>['osm:w'+e.id,e]));
 const deferred=new Set(),ground=new Set();
 for(const t of m.tiles.filter(t=>t.kind==='roads')){
  const r=read(t.url).samples.road;
  for(const s of r.deferredStructures){assert.ok(ways.has(s.sourceId));assert.equal(s.heightStatus,'unknown');deferred.add(s.sourceId);}
  for(const id of r.groundPathSourceIds)ground.add(id);
  for(const x of [...r.lines,...r.crossings])ground.add(x.sourceId);
 }
 assert.equal(deferred.size,29);for(const id of deferred)assert.ok(!ground.has(id),id);
 assert.deepEqual([...deferred].sort(),a.specialWays.map(w=>w.sourceId).sort());
 assert.equal(a.renderAudit.checkedUniqueSourceIds,ground.size);assert.deepEqual(a.renderAudit.unresolvedSourceIds,[]);assert.deepEqual(a.renderAudit.nonGroundInSurface,[]);
 assert.equal(createHash('sha256').update(fs.readFileSync(a.sourceFile)).digest('hex'),a.sourceSha256);
});

test('端点连接来自真实节点引用，快照外端点不当作已证实断路，层级不伪造米制高度',()=>{
 const a=read('docs/research/p3-road-layers/audit.json'),raw=read(a.sourceFile),ways=new Map(raw.elements.filter(e=>e.type==='way').map(e=>['osm:w'+e.id,e]));
 const [x0,y0,x1,y1]=a.sourceBbox;
 for(const w of a.specialWays){
  assert.equal(w.heightM,null);
  for(const p of w.endpoints)for(const linked of p.attachedWays)assert.ok(ways.get(linked.sourceId).nodes.includes(Number(p.nodeId.split(':n')[1])));
  if(w.endpointStatus==='outside-snapshot')for(const p of w.endpoints.filter(p=>!p.attachedWays.length))assert.ok(p.position[0]<x0||p.position[0]>x1||p.position[1]<y0||p.position[1]>y1);
 }
 assert.equal(a.endpointSummary['both-attached'],19);assert.equal(a.endpointSummary['outside-snapshot'],4);assert.equal(a.endpointSummary['needs-source-review'],6);
});
