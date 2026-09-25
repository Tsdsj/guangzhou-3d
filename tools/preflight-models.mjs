import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three/build/three.module.js';
import {buildSample} from '../prototypes/p2/models.js';
import {measureModel,previewGroundY} from '../src/models/model-preflight.js';
import {BLD} from '../src/world/schema.js';
import {loadCity} from '../src/world/data.js';
import {polygonsOverlap,classifyDetails} from '../src/world/detail-spatial.js';
const read=p=>JSON.parse(fs.readFileSync(p)),hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const [p,h]of Object.entries(read('.research/p2/main-data-baseline.json')))if(hash(p)!==h)throw new Error(`Base changed ${p}`);
globalThis.fetch=async url=>new Response(fs.readFileSync(String(url).replace(/^\.\//,'')));
const D=await loadCity();await D.vegReady;
// Resolve the one browser import-map alias in memory, so the audit runs the actual
// Geography.height implementation without installing packages or editing runtime code.
let geoCode=fs.readFileSync('src/world/geo.js','utf8');if(!geoCode.includes("from 'three'"))throw new Error('Geography import changed');
geoCode=geoCode.replace("from 'three'",`from '${new URL('../vendor/three/build/three.module.js',import.meta.url).href}'`);
const {Geography}=await import('data:text/javascript;base64,'+Buffer.from(geoCode).toString('base64'));const geo=new Geography(D);
const data=read('prototypes/p2/samples.json');data.buildings.C01=read('prototypes/p2/c01.json');data.buildings.C02=read('prototypes/p2/c02.json');data.skybridge=read('prototypes/p2/skybridge.json');
const production=read('data/detail/shamian.json').samples,placements=D.detailManifest.tiles.flatMap(t=>t.buildings||[]);
const features=read('docs/research/p0-2026-09-25/shamian-osm-buildings.geojson').features;
const o=D.meta.origin,project=([lon,lat])=>[(lon-o.lon)*o.kx,-(lat-o.lat)*o.kz];
const featuresCity=features.filter(f=>f.properties.building&&f.geometry.type==='Polygon').map(f=>({id:'osm:'+f.properties.id,poly:f.geometry.coordinates[0].slice(0,-1).map(project)}));
const rendered=Array.from({length:D.nBuildings},(_,i)=>{
 const ri=D.S.bldMeta[i*BLD.N+BLD.RING0],p0=D.S.bldRings[ri*2],n=D.S.bldRings[ri*2+1];
 return{id:D.buildingSourceIds[i],poly:Array.from({length:n},(_,k)=>[D.S.bldPts[(p0+k)*2],D.S.bldPts[(p0+k)*2+1]])};
});
function affine(local,world){
 const tri=ps=>new T.Matrix3().set(ps[0][0],ps[1][0],ps[2][0],ps[0][1],ps[1][1],ps[2][1],1,1,1);
 const m=tri(world).multiply(tri(local).invert()).elements;
 return new T.Matrix4().set(m[0],0,m[3],m[6],0,1,0,0,m[1],0,m[4],m[7],0,0,0,1);
}
const rows=[];
for(const id of ['B1','B2','B3','C01','C02','S1']){
 const preview=buildSample(id,data),pm=measureModel(preview.group,preview.planBoundary);
 const row={id,nominalHeightM:preview.height,model:pm,previewGroundY:previewGroundY(id),groundDatum:'model y=0; not surveyed elevation',measuredAccuracy:'unverified',integration:id.startsWith('B')?'existing-estimated-integration':'prototype-only',heightEvidence:id==='B2'?'reported-eave-20.6m-not-total':'estimated',sourceControlResidualM:null};
 if(pm.nonFiniteValues)throw new Error(`Non-finite model: ${id}`);
 if(id==='S1'){
  row.sourceId=data.skybridge.sourceId;row.interfaces=data.skybridge.interfaces.map(p=>({nodeId:p.nodeId,buildingId:p.buildingId,doorVerified:p.doorVerified}));row.sourceSpanM=data.skybridge.lengthM;row.deckTopM=data.skybridge.parameters.deckTopM.value;row.readiness='hold-height-width-and-building-interface';row.geographicParity='x along east/north axis, z south-facing, y up';
 }else{
  const placement=placements.find(p=>p.sampleId===id),sample=placement?buildSample(id,production):preview;
  const raw=features.find(f=>'osm:'+f.properties.id===sample.sourceIds[0]),world=raw.geometry.coordinates[0].slice(0,-1).map(project);
  const matrix=placement?new T.Matrix4().compose(new T.Vector3(...placement.position),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),placement.rotationY),new T.Vector3(...placement.scale)):affine(sample.planBoundary,world);
  const controls=sample.planBoundary.map(([x,z])=>new T.Vector3(x,0,z).applyMatrix4(matrix));
  row.sourceId=sample.sourceIds[0];row.placementMode=placement?'runtime-manifest':'hypothetical-source-affine-not-registered';
  row.horizontalDeterminant=matrix.elements[0]*matrix.elements[10]-matrix.elements[8]*matrix.elements[2];
  row.sourceControlResidualM=Math.max(...controls.map(p=>Math.min(...world.map(q=>Math.hypot(p.x-q[0],p.z-q[1])))));
  row.heading=placement?.headingBasis||'source south edge provisionally paired to photo';row.matrix=matrix.toArray();
  const origin=new T.Vector3().applyMatrix4(matrix),ground=geo.height(origin.x,origin.z),terrain=world.map(p=>geo.height(...p));
  row.cityTerrain={atOriginM:ground,minAtControlsM:Math.min(...terrain),maxAtControlsM:Math.max(...terrain),basis:'current rendered heightfield, not a field survey'};
  const physical=measureModel(sample.group,sample.planBoundary);row.placedLocalModel=physical;
  // AABB broad phase only: a candidate is not proof that architectural surfaces intersect.
  const lo=physical.min,hi=physical.max,points=[];
  for(const x of [lo[0],hi[0]])for(const z of [lo[2],hi[2]])points.push(new T.Vector3(x,0,z).applyMatrix4(matrix));
  const box=new T.Box3().setFromPoints(points),envelope=[[box.min.x,box.min.z],[box.max.x,box.min.z],[box.max.x,box.max.z],[box.min.x,box.max.z]];
  row.envelopeNeighborCandidates=featuresCity.filter(f=>f.id!==row.sourceId&&polygonsOverlap(envelope,f.poly)).map(f=>f.id);
  let trees=0;for(const arr of D.trees)for(let i=0;i<arr.length;i+=6){const x=arr[i],z=arr[i+1],e=.001;if(polygonsOverlap([[x-e,z-e],[x+e,z-e],[x+e,z+e],[x-e,z+e]],world))trees++;}
  const replacementIds=placement?.replaceIds||[row.sourceId];
  const grouping=classifyDetails(D,{tiles:[{id:'preflight',buildings:[{sourceId:row.sourceId,replaceIds:replacementIds,footprint:world}]}]});
  row.overlappingRenderRecords=rendered.filter(r=>polygonsOverlap(r.poly,world)).map(r=>r.id);
  row.proceduralFillOverlapCount=grouping.fillTiles.size;row.existingRenderRecords=D.buildingSourceIds.filter(id=>replacementIds.includes(id)).length;
  row.treeCentersInsideSource=trees;row.treeCrownIntersections='not-evaluated';
  row.readiness=placement?'retain-existing-estimate-no-survey-upgrade':'hold-unmeasured-height-uncovered-faces-and-runtime-placement';
  if(row.sourceControlResidualM>.02||row.horizontalDeterminant<=0||pm.nonFiniteValues)throw new Error(`Geometry preflight failed: ${id}`);
 }
 rows.push(row);
}
const r={date:'2026-09-26',scope:'5 building studies and S1; offline geometry plus current terrain/source-footprint broad phase',limits:['control agreement is not real 1:1 accuracy','mesh overhang may be cornice, balcony or step; not auto-clipped','neighbor AABB candidates require further surface-level inspection','tree centres are not canopy clearance','new sample affine placements are hypothetical, not runtime registrations'],fixes:['P2 buildings ground -0.5 -> 0','height display uses physical mesh highest point, excludes helpers','C02 last stair 0.78 -> 0.45 at doorway threshold'],baseDataUnchanged:true,rows};
fs.writeFileSync('docs/research/p3-model-preflight/report.json',JSON.stringify(r,null,2)+'\n');
console.log(JSON.stringify(rows.map(({id,sourceControlResidualM,model,cityTerrain,envelopeNeighborCandidates,treeCentersInsideSource})=>({id,top:model.maxY,bottom:model.minY,overhang:model.maxPlanOverhangM,sourceControlResidualM,cityTerrain,envelopeNeighborCandidates,treeCentersInsideSource})),null,2));
