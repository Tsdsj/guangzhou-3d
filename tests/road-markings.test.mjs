import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
const read=p=>JSON.parse(fs.readFileSync(p));
// Independent point and triangulation checks on the packaged paint, including holes.
function ringRelation(p,ring){
 let inside=false;
 for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[j],b=ring[i],cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);
  if(Math.abs(cross)<1e-6&&p[0]>=Math.min(a[0],b[0])-1e-7&&p[0]<=Math.max(a[0],b[0])+1e-7&&p[1]>=Math.min(a[1],b[1])-1e-7&&p[1]<=Math.max(a[1],b[1])+1e-7)return 0;
  if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }
 return inside?1:-1;
}
const covered=(p,polys)=>polys.some(poly=>ringRelation(p,poly.outer)>=0&&!poly.holes.some(h=>ringRelation(p,h)>0));

test('打包标线的顶点与三角形中心处于路面内，不能跨岛洞或越过瓦片边界',()=>{
 const m=read('data/detail/manifest.json');let count=0;
 for(const t of m.tiles.filter(t=>t.kind==='roads')){
  const r=read(t.url).samples.road;assert.equal(r.markingVersion,1);assert.ok(Array.isArray(r.markings));
  for(const mark of r.markings)for(const p of mark.polygons){
   count++;const c=p.outer.map(q=>new THREE.Vector2(...q)),h=p.holes.map(r=>r.map(q=>new THREE.Vector2(...q))),tri=THREE.ShapeUtils.triangulateShape(c,h),all=c.concat(...h);
   const points=all.map(q=>[q.x,q.y]);
   for(const ids of tri)points.push(ids.reduce((s,i)=>[s[0]+all[i].x/3,s[1]+all[i].y/3],[0,0]));
   for(const q of points){
    assert.ok(q.every(Number.isFinite));assert.ok(covered(q,r.surfaces),mark.id+' outside road');
    const x=q[0]+t.position[0],z=q[1]+t.position[2];
    assert.ok(x>=t.bounds[0]-1e-7&&x<=t.bounds[2]+1e-7&&z>=t.bounds[1]-1e-7&&z<=t.bounds[3]+1e-7);
   }
  }
 }
 assert.ok(count>0);
});

test('缺证和冲突路线保留，但不会变成标线；yes只说明存在而非确认斑马样式',()=>{
 const m=read('data/detail/manifest.json'),sources=new Set();
 for(const t of m.tiles.filter(t=>t.kind==='roads')){
  const r=read(t.url).samples.road,audit=new Map(r.markingAudit.map(a=>[a.sourceId,a]));
  for(const c of r.crossings)sources.add(c.sourceId);
  for(const p of r.markings){assert.equal(audit.get(p.sourceId).render,true);assert.equal(p.dimensionStatus,'estimated');if(audit.get(p.sourceId).tags['crossing:markings']==='yes')assert.equal(p.patternStatus,'estimated');}
  for(const a of audit.values())if(['unknown','conflict','absent'].includes(a.status))assert.ok(!r.markings.some(p=>p.sourceId===a.sourceId));
 }
 assert.equal(sources.size,33,'source crossing ways must not disappear with paint suppression');
 const j=read('prototypes/p2/samples.json').road;assert.equal(j.crossings.length,8);assert.equal(j.markings.length,0);assert.equal(j.restrictions.length,4);
});

test('旧参数没有裁剪标线时保留路面，新标线版本不认识时拒绝误读',async()=>{
 const {buildSample}=await import('../src/models/detail-models.js');
 const road={production:true,surfaces:[{outer:[[-10,-10],[10,-10],[10,10],[-10,10]],holes:[]}],walkways:[],lines:[],crossings:[{points:[[-9,0],[9,0]]}],restrictions:[]};
 const old=buildSample('J1',{road});let paint=0;old.group.traverse(o=>{paint+=o.userData.materialTag==='paint';});assert.equal(paint,0);
 assert.throws(()=>buildSample('J1',{road:{...road,markingVersion:999,markings:[]}}),/marking.*version/i);
});
