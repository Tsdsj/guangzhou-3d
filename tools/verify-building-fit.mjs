import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from '../vendor/three/build/three.module.js';
import {loadCity} from '../src/world/data.js';
import {buildSample} from '../src/models/detail-models.js';
import {polygonsOverlap} from '../src/world/detail-spatial.js';
const read=p=>JSON.parse(fs.readFileSync(p));
const baseline=read('.research/p2/main-data-baseline.json');
for(const [path,expected]of Object.entries(baseline))if(createHash('sha256').update(fs.readFileSync(path)).digest('hex')!==expected)throw new Error(`Base data changed: ${path}`);
globalThis.fetch=async url=>new Response(fs.readFileSync(String(url).replace(/^\.\//,'')));
const D=await loadCity();await D.vegReady;
const samples=read('data/detail/shamian.json').samples,rows=[];
for(const b of D.detailManifest.tiles.flatMap(t=>t.buildings||[])){
 const sample=buildSample(b.sampleId,samples),matrix=new THREE.Matrix4().compose(new THREE.Vector3(...b.position),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),b.rotationY),new THREE.Vector3(...b.scale));
 const residual=sample.planBoundary.map(([x,z])=>{const p=new THREE.Vector3(x,0,z).applyMatrix4(matrix);return Math.min(...b.footprint.map(q=>Math.hypot(q[0]-p.x,q[1]-p.z)));});
 let treeCentersInside=0,triangles=0;
 for(const a of D.trees)for(let i=0;i<a.length;i+=6){const x=a[i],z=a[i+1],r=.001;if(polygonsOverlap([[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r]],b.footprint))treeCentersInside++;}
 sample.group.traverse(o=>{if(!o.isMesh)return;for(const name of ['position','normal'])if(![...o.geometry.attributes[name].array].every(Number.isFinite))throw new Error(`Non-finite ${b.sampleId} ${name}`);triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;});
 rows.push({sampleId:b.sampleId,sourceId:b.sourceId,maxPlanControlResidualM:Math.max(...residual),treeCentersInside,triangles,metricAccuracy:'unverified',heading:b.headingBasis});
 sample.group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
}
const report={date:'2026-09-25',scope:'P3 existing buildings correction',basis:'control-plan alignment to input OSM, not surveyed exterior-wall accuracy',baseDataUnchanged:true,treesRemoved:0,buildings:rows};
fs.mkdirSync('docs/research/p3-building-corrections',{recursive:true});fs.writeFileSync('docs/research/p3-building-corrections/validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
