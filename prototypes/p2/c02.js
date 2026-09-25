import * as THREE from '../../vendor/three/build/three.module.js';
import {Builder,wallGeometry} from './geometry.js';
import {fitSamplePlan,createPlanFit} from '../../src/models/building-fit.js';

export function specieBank(s){
 const w=s.width,d=s.depth,z=d/2,p=s.parameters,h=p.totalHeightM,cw=w*p.centralWidthRatio,bay=cw/3,aw=bay*.83,base=p.upperBaseM,archH=p.archTopM-base,inner=z-p.porchDepthM;
 const b=new Builder(),walls=new Builder();
 function wall(width,height,holes,pos,ry=0,mat='stone',e='reference'){
  walls.add(wallGeometry(width,height,.35,holes),mat,pos,[0,ry,0],e,false);
 }
 function rectWindow(o,Z){
  b.pane(o,Z-.10,'glass');b.frame(o,Z+.035,.075,'trim');
  for(let k=1;k<4;k++)b.box(o.x-o.width/2+o.width*k/4,o.y+o.height/2,Z-.045,.045,o.height,.065,'metal','estimate');
  b.box(o.x,o.y+o.height*.7,Z-.025,o.width,.06,.06,'metal','estimate');
 }
 // Three giant arches span the two upper floors. The spandrels are separate,
 // recessed surfaces rather than a solid box hidden behind facade textures.
 const arches=[-1,0,1].map(i=>({x:i*bay,y:0,width:aw,height:archH,kind:'arch'}));
 wall(cw,h-base,arches,[0,base,z],0,'green');
 for(const o of arches){
  const arch={...o,y:base};b.frame(arch,z+.045,.13,'trim');
  b.pane(arch,z-.42,'glass');
  // Two floor glazing systems separated by a solid yellow spandrel.
  const mid=10.6;b.box(o.x,mid,z-.22,aw,1.05,.30,'yellow','reference');
  for(const yy of [mid-.63,mid+.65])b.box(o.x,yy,z-.015,aw,.13,.20,'trim');
  const shoulder=base+archH-aw/2;
  for(let k=1;k<4;k++){
   const x=o.x-aw/2+aw*k/4;
   for(const [a,q]of [[base,mid-.6],[mid+.6,shoulder]])b.box(x,(a+q)/2,z-.27,.055,q-a,.08,'metal','estimate');
  }
  b.box(o.x,shoulder,z-.27,aw,.055,.08,'metal','estimate');
  // Rectangular mullions stop at the spring line; the rounded crown stays clear.
 }
 for(const x of [-cw/2,-bay/2,bay/2,cw/2]){
  b.box(x,base+(h-base)/2,z+.08,.24,h-base,.22,'trim');
  b.box(x,base+.14,z+.11,.50,.26,.32,'trim');
 }
 // Left and right wing openings are independently visible in the 2021 photo; dimensions remain estimates.
 const wing=(w-cw)/2;

 const rightX=cw/2+wing/2,rightWindows=[{x:0,y:.9,width:1.55,height:3.2},{x:0,y:6.8,width:1.5,height:2.65},{x:0,y:11.6,width:1.5,height:2.5}].map(o=>({...o,kind:'rect'}));
 wall(wing,h,rightWindows,[rightX,0,z]);
 for(const o of rightWindows)rectWindow({...o,x:rightX},z);
 const leftX=-rightX;wall(wing,h,rightWindows,[leftX,0,z]);
 for(const o of rightWindows)rectWindow({...o,x:leftX},z);
 // Lower back wall and the two visible round columns create actual porch depth.
 const lower=[-1,0,1].map(i=>({x:i*bay,y:p.entranceThresholdM,width:bay*.76,height:4.6,kind:'rect'}));
 wall(cw,p.groundCorniceM,lower,[0,0,inner]);
 for(const o of lower){b.pane(o,inner-.18,o.x===0?'wood':'dark');b.frame(o,inner+.02,.08,'stone');}
 const porticoColumns=[];
 for(const center of [-bay/2,bay/2])for(const offset of [-s.porticoReview.roundPairHalfSpacingM,s.porticoReview.roundPairHalfSpacingM]){
  const x=center+offset;porticoColumns.push({kind:'round',x});
  b.cylinder(x,2.98,z-.35,.31,4.95,'stone',.27,'estimate',28);
  b.box(x,.44,z-.35,.86,.35,.86,'trim');b.box(x,5.43,z-.35,.9,.24,.8,'trim');
  b.cylinder(x,.73,z-.35,.4,.2,'trim',.4,'estimate');
 }
 for(const center of [-cw/2,cw/2])for(const offset of [-s.porticoReview.squarePairHalfSpacingM,s.porticoReview.squarePairHalfSpacingM]){
  const x=center+offset;porticoColumns.push({kind:'square',x});b.box(x,2.9,z-.35,.50,5.8,.8,'stone','reference');
  b.box(x,.44,z-.35,.69,.3,.96,'trim','estimate');b.box(x,5.43,z-.35,.7,.24,.95,'trim','estimate');
 }
 b.box(0,5.62,z-p.porchDepthM/2,cw+.75,.4,p.porchDepthM+.75,'stone');
 b.box(0,5.92,z+.12,cw+.9,.18,.8,'trim');
 for(let x=-cw/2+.3;x<cw/2;x+=.62)b.box(x,5.31,z+.07,.22,.18,.28,'trim','estimate');
 // A small entry flight is a dimensional hypothesis; the full site ground is not reconstructed.
 for(let i=0;i<4;i++){const top=p.entranceThresholdM*(i+1)/4;b.box(0,top/2,z+.85-i*.3,bay*1.08,top,1.05-i*.12,'stone','estimate');}
 // Front cornice only. Side/rear walls and the unseen roof remain explicitly unknown.
 for(const yy of [15.68,16.0])b.box(0,yy,z+.20,w+.65,.20,.8,'trim');
 b.box(0,16.22,z+.14,w+.4,.18,.45,'green','estimate');
 for(let x=-w/2+.25;x<w/2;x+=.45)b.box(x,16.35,z+.16,.20,.10,.40,'roof','estimate');
 wall(d,h,[],[-w/2,0,0],-Math.PI/2,'unknown','unknown');
 wall(d,h,[],[w/2,0,0],Math.PI/2,'unknown','unknown');
 wall(w,h,[],[0,0,-d/2],Math.PI,'unknown','unknown');
 b.box(0,h-.12,-.18,w,.24,d-.36,'unknown','unknown',false);
 const group=b.finish('specie-bank-front-study'),wg=walls.finish('walls');
 wg.traverse(o=>{if(o.isMesh)o.userData.structuralWall=true;});group.add(wg);
 // The pale green front is photo-supported; its exact paint colour is not measured.
 group.traverse(o=>{if(o.isMesh&&o.userData.materialTag==='green'){o.material.color.set('#90ac9b');o.userData.baseColor='#90ac9b';}});
 const result={id:'C02',group,height:h,focus:[0,h*.46,d*.22],detailFocus:[0,3.1,z-.6],planBoundary:s.planFit.source,metricAccuracy:'unverified',sourceIds:[s.sourceId]};
 fitSamplePlan(result,s.planFit);const fit=createPlanFit(s.planFit),P=(x,y,Z)=>fit.point(new THREE.Vector3(x,y,Z)).toArray();
 result.porticoColumns=porticoColumns.map(c=>({...c,probe:P(c.x,3,z+.35)}));
 result.leftWindowChecks=rightWindows.map(o=>P(leftX,o.y+o.height/2,z+1));
 result.apertureChecks=[...arches.map((o,i)=>({name:'upper arch '+i,origin:P(o.x,14,z+1),maxDistance:1.3})),{name:'recessed porch',origin:P(0,2,z+1),maxDistance:p.porchDepthM+.7}];
 result.solidChecks=[{name:'arch shoulder',origin:P(aw/2-.1,15.1,z+1),direction:[0,0,-1]},{name:'unknown rear',origin:P(0,7,-d/2-1),direction:[0,0,1]}];
 const topology=new THREE.Group();const pts=[...s.planFit.target,s.planFit.target[0]].map(([x,Z])=>new THREE.Vector3(x,.04,Z));
 const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0x248b8d,depthTest:false}));line.renderOrder=5;topology.add(line);topology.visible=false;group.add(topology);result.topology=topology;
 return result;
}
