import * as THREE from '../../vendor/three/build/three.module.js';
import {Builder,wallGeometry} from './detail-geometry.js';
import {fitSamplePlan,createPlanFit} from './building-fit.js';
import {shutterLayout} from './shutters.js';

export function christChurch(s){
 const w=s.width,d=s.naveDepth,tw=s.porchWidth,pd=s.porchDepth,tx=s.porchCenterX,z=d/2,pz=z+pd,h=s.parameters.naveEaveM,ridge=s.parameters.naveRidgeM;
 const b=new Builder(),walls=new Builder();
 const wall=(width,height,holes,pos,ry=0,e='reference')=>walls.add(wallGeometry(width,height,.28,holes),e==='unknown'?'unknown':'stone',pos,[0,ry,0],e,false);
 function pane(o,Z,mat='glass',e='reference'){b.pane(o,Z,mat,e);b.frame(o,Z+.035,.10,'trim',e);}
 // Southern nave wall stays open behind the projecting porch.
 const sideWindows=[-1,1].map(k=>({x:k*w*.34,y:1.2,width:1.45,height:4.3,kind:'arch'}));
 wall(w,h,[{x:tx,y:0,width:tw*.75,height:5.6,kind:'arch'},...sideWindows],[0,0,z]);
 for(const o of sideWindows)pane(o,z-.06);
 // Only the two northern windows visible on each side in the 2009 interior photo.
 // Spacing/size are estimates; southern wall stays unknown and does not inherit a full bay grid.
 const side=s.sideWindowReview,sideChecks=[];
 const length=side.segmentLengthM,center=-d/2+length/2;
 for(const sign of [-1,1]){
  const ry=sign*Math.PI/2,x=sign*w/2;
  const holes=side.stationsFromNorthM.map(station=>({x:-sign*(-d/2+station-center),y:side.sillM,width:side.windowWidthM,height:side.windowHeightM,kind:'arch'}));
  wall(length,h,holes,[x,0,center],ry,'estimate');
  wall(d-length,h,[],[x,0,length/2],ry,'unknown');
  const panes=new Builder();
  for(const o of holes)panes.pane(o,-.07,'glass','reference');
  const g=panes.finish('north-side-windows');g.rotation.y=ry;g.position.set(x,0,center);b._groups??=[];b._groups.push(g);
  for(const station of side.stationsFromNorthM)sideChecks.push({origin:[x+sign,3,-d/2+station],direction:[-sign,0,0],maxDistance:1.6});
 }
 // Northern gable end: 2026 photo. Build locally, then rotate into the correct face.
 const northB=new Builder(),northW=new Builder(),northHoles=[];
 const triple=[{x:-1.23,y:1,width:1.04,height:4.4,kind:'pointed'},{x:0,y:1,width:1.10,height:4.95,kind:'pointed'},{x:1.23,y:1,width:1.04,height:4.4,kind:'pointed'}];
 const doors=[-1,1].map(k=>({x:k*w*.35,y:0,width:1.5,height:2.6,kind:'rect'}));
 const circles=[-1,0,1].map(k=>({x:k*w*.27,y:6.95,width:.48,height:.48,kind:'circle'}));
 northHoles.push(...triple,...doors,...circles);
 northW.add(wallGeometry(w,h,.28,northHoles),'stone',[0,0,0],[0,0,0],'reference',false);
 for(const o of [...triple,...doors,...circles]){northB.pane(o,-.08,'dark');northB.frame(o,.04,.10,'trim');}
 for(const [index,o]of triple.entries()){
  const rows=shutterLayout(o,{spacing:.46,height:.40,inset:.04});
  rows.forEach((r,i)=>{for(let col=0;col<3;col++)northB.box(o.x+(col-1)*r.width/3,r.y,-.045,r.width/3-.035,r.height,.035,['amber','ruby','emerald','blue'][(i+col+index)%4],'estimate');});
 }
 northB.frame({x:0,y:.85,width:4.2,height:5.8,kind:'arch'},.02,.1,'trim');
 // Actual gable and dentil cornices, with proportional dimensions.
 function gable(builder,Z){builder.triangle([[-w/2,h],[0,ridge],[w/2,h]],Z,.18,'stone','reference');
  builder.box(0,h-.1,Z+.06,w+.38,.23,.5,'trim');
  builder.tube([[-w/2-.15,h+.14,Z+.09],[0,ridge+.15,Z+.09],[w/2+.15,h+.14,Z+.09]],.09,'trim');
  for(let x=-w/2+.35;x<w/2;x+=.58)builder.box(x,h-.35,Z+.18,.19,.22,.29,'trim','estimate');
 }
 gable(northB,0);gable(b,z);
 for(const yy of [2.8,6.5,7.7])northB.box(0,yy,.06,w,.10,.16,'trim');
 for(const k of [-1,1])for(let y=.35;y<6.5;y+=.46)northB.box(k*(w/2-.35),y,.04,.75,.2,.16,'trim','estimate');
 const northGroup=northB.finish('north-end'),northWalls=northW.finish('north-walls');
 northGroup.rotation.y=northWalls.rotation.y=Math.PI;northGroup.position.z=northWalls.position.z=-d/2;
 // Roof is a form hypothesis; no guessed tiles or equipment.
 b.triangle([[-w/2-.15,h],[0,ridge],[w/2+.15,h]],-d/2,d,'unknown','estimate');
 // South entrance porch with real recessed arch on three visible faces.
 const gate={x:0,y:0,width:tw*.63,height:5.6,kind:'arch'};
 wall(tw,h,[gate],[tx,0,pz]);
 for(const k of [-1,1])wall(pd,h,[{...gate,width:pd*.62}],[tx+k*tw/2,0,z+pd/2],k*Math.PI/2);
 b.frame({...gate,x:tx},pz+.025,.14,'trim');
 for(const k of [-1,1])for(let y=.35;y<6.5;y+=.5)b.box(tx+k*(tw/2-.16),y,pz+.08,.33,.24,.18,'trim','estimate');
 for(const y of [6.5,7.0,8.2])b.box(tx,y,z+pd/2,tw+.42,.2,pd+.42,'trim');
 b.box(tx,7.45,pz+.08,tw*.73,.52,.12,'trim');
 // Chamfered tower, distinct lower arch windows and upper oculi.
 const cz=z+pd/2,half=tw*.48,c=half*.67;
 const oct=[[-c,half],[c,half],[half,c],[half,-c],[c,-half],[-c,-half],[-half,-c],[-half,c]];
 for(let i=0;i<8;i++){
  const a=oct[i],q=oct[(i+1)%8],L=Math.hypot(q[0]-a[0],q[1]-a[1]),ry=-Math.atan2(q[1]-a[1],q[0]-a[0]),mx=tx+(a[0]+q[0])/2,mz=cz+(a[1]+q[1])/2;
  const known=[0,2,6].includes(i),e=known?'reference':'unknown';
  const opening={x:0,y:1,width:L*.56,height:3.25,kind:'arch'};
  wall(L,5.4,known?[opening]:[],[mx,8.5,mz],ry,e);
  const circle={x:0,y:.65,width:L*.53,height:L*.53,kind:'circle'};
  wall(L,2.6,known?[circle]:[],[mx,14.2,mz],ry,e);
  for(const [o,base]of known?[[opening,8.5],[circle,14.2]]:[]){
   const part=new Builder();part.pane(o,-.07,'dark');part.frame(o,.04,.1,'trim');
   for(const r of shutterLayout(o,{spacing:.12,height:.045,inset:.06}))part.box(r.x,r.y,-.01,r.width,r.height,.08,'dark','estimate');
   const g=part.finish('tower-opening');g.rotation.y=ry;g.position.set(mx,base,mz);b._groups??=[];b._groups.push(g);
  }
 }
 for(const yy of [8.55,13.95,16.9])b.cylinder(tx,yy,cz,half*1.14,.22,'trim',half*1.14,'estimate',8);
 // Low octagonal domed cap; silhouette supported, profile and all heights estimated.
 const profile=[[0,half],[.45,half*.85],[.95,half*.55],[1.18,half*.36]];
 for(let i=0;i<profile.length-1;i++){const [a,ra]=profile[i],[q,rq]=profile[i+1];b.cylinder(tx,17.02+(a+q)/2,cz,ra,q-a,'stone',rq,'estimate',8);}
 b.box(tx,18.38,cz,.7,.22,.7,'trim','estimate');
 b.box(tx,18.94,cz,.10,.92,.10,'trim','estimate');b.box(tx,19.12,cz,.63,.10,.10,'trim','estimate');
 const group=b.finish('christ-church-shamian'),wallGroup=walls.finish('structural-walls');
 for(const g of [wallGroup,northWalls])g.traverse(o=>{if(o.isMesh)o.userData.structuralWall=true;});
 group.add(wallGroup,northGroup,northWalls,...(b._groups||[]));
 group.traverse(o=>{if(!o.isMesh)return;const color={amber:'#b7882f',ruby:'#993c37',emerald:'#336b52',blue:'#38536b'}[o.userData.materialTag];if(color){o.material.color.set(color);o.userData.baseColor=color;}});
 const result={id:'C01',group,height:s.parameters.towerTopM,focus:[0,7,0],detailFocus:[tx,11,pz],planBoundary:s.planFit.source,metricAccuracy:'unverified',sourceIds:[s.sourceId],labels:[{text:'沙 面 堂',position:[tx,7.46,pz+.16],width:tw*.6,height:.35,color:'#765c30'}]};
 fitSamplePlan(result,s.planFit);
 const topology=new THREE.Group();topology.name='source-outline';
 const points=[...s.planFit.target,s.planFit.target[0]].map(p=>new THREE.Vector3(p[0],.06,p[1]));
 const outline=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x248b8d,depthTest:false}));outline.renderOrder=5;topology.add(outline);topology.visible=false;group.add(topology);result.topology=topology;
 const fit=createPlanFit(s.planFit);
 result.sideOpeningChecks=sideChecks.map(c=>({...c,origin:fit.point(new THREE.Vector3(...c.origin)).toArray()}));
 result.openingChecks=[{name:'south porch',origin:fit.point(new THREE.Vector3(tx,2,pz+1)).toArray(),direction:[0,0,-1],maxDistance:.8+pd},{name:'north central lancet',origin:fit.point(new THREE.Vector3(0,3,-d/2-1)).toArray(),direction:[0,0,1],maxDistance:1.5}];
 return result;
}
