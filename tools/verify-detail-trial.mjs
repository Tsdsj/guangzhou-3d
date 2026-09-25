import fs from 'node:fs';import {createHash} from 'node:crypto';import * as T from '../vendor/three/build/three.module.js';
import {buildSample} from '../prototypes/p2/models.js';import {loadCity} from '../src/world/data.js';import {classifyDetails} from '../src/world/detail-spatial.js';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const [p,h]of Object.entries(read('.research/p2/main-data-baseline.json')))if(hash(p)!==h)throw new Error('Base changed '+p);
for(const [p,h]of Object.entries(read('docs/research/p3-skybridge/validation.json').detailHashes))if(hash(p)!==h)throw new Error('Existing detail changed '+p);
globalThis.fetch=async url=>new Response(fs.readFileSync(String(url).replace(/^\.\//,'')));
const D=await loadCity(null,{detailTrial:true});await D.vegReady;const groups=classifyDetails(D,D.detailManifest),rows=[];
for(const tile of D.detailManifest.tiles.filter(t=>t.trialOnly)){
 const payload=read(tile.url),b=tile.buildings[0],s=buildSample(b.sampleId,payload.samples),matrix=new T.Matrix4().compose(new T.Vector3(...b.position),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),b.rotationY),new T.Vector3(...b.scale));
 const residual=Math.max(...s.planBoundary.map(([x,z])=>{const p=new T.Vector3(x,0,z).applyMatrix4(matrix);return Math.min(...b.footprint.map(q=>Math.hypot(q[0]-p.x,q[1]-p.z)));}));
 if(residual>1e-6||hash(tile.url)!==tile.sha256)throw new Error('Trial geometry/hash mismatch');
 const replacements=D.buildingSourceIds.filter(id=>groups.sourceTiles.get(id)===tile.id);if(replacements.length!==1)throw new Error('Unexpected fallback count');
 rows.push({id:tile.id,sourceId:b.sourceId,actualReplacedSourceIds:replacements,sourceControlResidualM:residual,fillCount:[...groups.fillTiles.values()].filter(id=>id===tile.id).length,precision:'estimated'});
}
fs.mkdirSync('docs/research/p3-placement-trial',{recursive:true});fs.writeFileSync('docs/research/p3-placement-trial/geometry.json',JSON.stringify({date:'2026-09-26',defaultManifestBuildings:read('data/detail/manifest.json').tiles.flatMap(t=>t.buildings||[]).length,baseAndExistingDetailUnchanged:true,rows},null,2)+'\n');console.log(JSON.stringify(rows,null,2));
