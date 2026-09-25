import * as THREE from '../../vendor/three/build/three.module.js';
import { Builder, wallGeometry, openingPath, disposeGroup } from './detail-geometry.js';
import { fitSamplePlan } from './building-fit.js';
import { applyVerticalControl } from './building-controls.js';
import { shutterLayout } from './shutters.js';
import { christChurch } from './christ-church.js';
import { specieBank } from './specie-bank.js';
import { facadeStudy } from './facade-kit.js';

function shell(b,w,d,h,partialRight=false,openLeft=false) {
  b.box(0,h/2,-d/2,w,h,.32,'unknown','unknown',false);
  if(!openLeft)b.box(-w/2,h/2,0,.32,h,d,'unknown','unknown',false);
  b.box(w/2,h/2,partialRight?-d*.21:0,.32,h,partialRight?d*.58:d,'unknown','unknown',false);
  b.box(0,h+.1,0,w,.2,d,'unknown','unknown',false);
  b.box(0,-.16,0,w+.9,.32,d+.9,'stone','estimate',false);
}
function bands(b,w,z,ys,material='trim',x=0) {
  for(const y of ys){b.box(x,y,z+.13,w+.35,.14,.4,material);b.box(x,y+.12,z+.04,w+.18,.065,.24,material);}
}
function churchShutter(b,o,z){
  b.pane(o,z-.10,'churchShutter');
  for(const s of shutterLayout(o))b.box(s.x,s.y,z,s.width,s.height,s.depth,'churchShutter');
}
function window(b,o,z,{shutter=false,iron=false,frameMaterial='green'}={}) {
  b.pane(o,z-.30,shutter?'wood':'glass'); b.frame(o,z+.015,.105,'trim');
  const top=o.kind==='arch'?o.y+o.height-o.width/2:o.kind==='pointed'?o.y+o.height*.63:o.y+o.height;
  b.box(o.x,o.y-.09,z+.16,o.width+.4,.16,.52,'trim');
  if(shutter){
    for(const x of[-1,1])b.box(o.x+x*o.width*.25,(o.y+top)/2,z-.19,.055,top-o.y,.055,'wood');
    for(let y=o.y+.12;y<top-.06;y+=.13)b.box(o.x,y,z-.22,o.width-.14,.033,.065,'stone');
    b.box(o.x,(o.y+top)/2,z-.14,.07,top-o.y,.1,'wood');
  }else{
    for(let i=1;i<4;i++)b.box(o.x-o.width/2+o.width*i/4,(o.y+top)/2,z-.12,.035,top-o.y,.035,frameMaterial);
    for(let y=o.y+.55;y<top;y+=.65)b.box(o.x,y,z-.12,o.width,.035,.045,frameMaterial);
    if(o.kind==='arch')for(let i=1;i<6;i++){
      const a=i/6*Math.PI,r=o.width/2;
      b.tube([[o.x,top,z-.13],[o.x+Math.cos(a)*r,top+Math.sin(a)*r,z-.13]],.022,frameMaterial);
    }
  }
  if(iron){
    for(let x=o.x-o.width*.42;x<o.x+o.width*.46;x+=.29)b.box(x,o.y+o.height*.5,z+.04,.027,o.height*.94,.035,'metal');
    b.tube([[o.x-o.width*.45,o.y+.12,z+.05],[o.x+o.width*.45,o.y+o.height-.1,z+.05]],.02,'metal');
    b.tube([[o.x+o.width*.45,o.y+.12,z+.05],[o.x-o.width*.45,o.y+o.height-.1,z+.05]],.02,'metal');
  }
}
function pediment(b,x,y,z,width,rise=.65) {
  b.triangle([[x-width/2,y],[x,y+rise],[x+width/2,y]],z,.28,'stone');
  for(const offset of[0,.13])b.tube([[x-width/2-.08,y+offset,z+.29],[x,y+rise+offset,z+.29],[x+width/2+.08,y+offset,z+.29]],.065,'trim');
  b.box(x,y-.05,z+.2,width+.25,.17,.45,'trim');
}
function balcony(b,x,y,z,width,depth=1.0,stone=false) {
  const pts=[[x-width/2,z-.18],[x+width/2,z-.18]];
  for(let i=0;i<=24;i++){const a=i/24*Math.PI;pts.push([x+Math.cos(a)*width/2,z+Math.sin(a)*depth]);}
  b.flat({outer:pts},y,stone?'stone':'trim','reference',true);
  const rail=[];
  for(let i=0;i<=32;i++){
    const a=i/32*Math.PI,px=x+Math.cos(a)*width/2,pz=z+Math.sin(a)*depth;
    rail.push([px,y+.95,pz]);b.box(px,y+.47,pz,stone?.1:.035,.94,stone?.16:.035,stone?'stone':'metal');
  }
  b.tube(rail,stone?.13:.04,stone?'trim':'metal');
  b.tube(rail.map(p=>[p[0],y+.09,p[2]]),.06,'trim');
  for(const s of[-1,1])b.box(x+s*width*.34,y-.23,z+.18,.18,.47,.75,'trim');
}

function bank(s) {
  const b=new Builder(),w=s.width,d=s.depth,z=d/2,h=14.2;
  shell(b,w,d,h);
  const xs=[-2,-1,0,1,2].map(i=>i*(w-3.4)/4);
  const holes=xs.map((x,i)=>({x,y:i===2?.3:1.18,width:i===2?2.2:2.4,height:i===2?3.1:2.18,kind:'rect'}));
  b.add(wallGeometry(w,4.9,.42,holes),'yellow',[0,0,z],[0,0,0],'reference',false);
  holes.forEach((o,i)=>{
    if(i!==2){window(b,o,z,{iron:true});return;}
    b.pane(o,z-.28,'wood');b.frame(o,z+.02,.13,'stone');
    b.box(0,1.85,z-.10,.07,2.96,.08,'dark');
    for(const x of[-.52,.52])for(const y of[.87,1.83,2.78]){
      b.box(x,y,z-.18,.82,.72,.055,'wood');
      for(const sy of[-.38,.38])b.box(x,y+sy,z-.12,.86,.035,.06,'dark');
      for(const sx of[-.44,.44])b.box(x+sx,y,z-.12,.035,.79,.06,'dark');
    }
  });
  // Stone rustication bands, interrupted at true openings.
  for(let y=.6;y<4.65;y+=.57){
    const spans=holes.filter(o=>y>o.y&&y<o.y+o.height).map(o=>[o.x-o.width/2-.11,o.x+o.width/2+.11]).sort((a,c)=>a[0]-c[0]);
    let start=-w/2;for(const [l,r]of [...spans,[w/2,w/2]]){if(l>start)b.box((start+l)/2,y,z+.028,l-start,.07,.08,'trim');start=r;}
  }
  for(const y of[4.92,8.85])b.box(0,y-.09,z-1.4,w,.22,3.1,'trim');
  const upper=[];for(const y of[5.35,9.3])for(const x of xs)upper.push({x,y,width:2.2,height:2.85,kind:'rect'});
  b.add(wallGeometry(w,8.3,.3,upper.map(o=>({...o,y:o.y-4.9}))),'brick',[0,4.9,z-3.05],[0,0,0],'reference',false);
  upper.forEach(o=>window(b,o,z-3.05,{shutter:true}));
  const enclosure={x:0,y:5.25,width:2.85,height:3.33,kind:'rect'};
  b.pane(enclosure,z-.62,'glass');b.frame(enclosure,z-.52,.12,'green');
  for(let i=1;i<6;i++)b.box(-1.425+i*2.85/6,6.915,z-.49,.045,3.33,.065,'green');
  for(let i=1;i<4;i++)b.box(0,5.25+i*3.33/4,z-.49,2.85,.045,.065,'green');
  for(let i=0;i<6;i++)b.flutedColumn(-w/2+.58+(w-1.16)*i/5,5.1,z-.18,7.85,.43);
  for(const y of[5.15,9.05]){
    for(let x=-w/2+.55;x<w/2-.5;x+=.24)b.box(x,y+.48,z-.12,.028,.93,.028,'metal');
    b.box(0,y+.95,z-.12,w-.8,.05,.06,'metal');
    for(const x of[-(w-3.4)/2,0,(w-3.4)/2])balcony(b,x,y-.05,z-.04,3.15,.9);
  }
  b.box(0,13.48,z-.02,w,.73,.65,'yellow');
  bands(b,w,z,[4.72,5.04,13.04,13.9,14.18]);
  for(let x=-w/2+.3;x<w/2;x+=.6)b.box(x,13.98,z+.25,.24,.26,.38,'trim');
  for(const x of xs){
    b.ring(x,13.5,z+.34,.2,.055,'green');
    b.tube([[x-1.3,13.68,z+.33],[x-.8,13.41,z+.36],[x-.4,13.39,z+.36]],.048,'green');
    b.tube([[x+.4,13.39,z+.36],[x+.8,13.41,z+.36],[x+1.3,13.68,z+.33]],.048,'green');
  }
  // B1-b/c/d show a second garland band above the ground-floor windows.
  // Keep the central bank nameplate and doorway clear.
  for(const [left,right]of[[-w/2+.35,-2.1],[2.1,w/2-.35]]){
    const count=8,step=(right-left)/(count-1);
    for(let i=0;i<count;i++){
      const x=left+i*step;b.ring(x,4.47,z+.12,.13,.035,'green','estimate');
      if(i<count-1)b.tube([[x+.16,4.55,z+.13],[x+step/2,4.29,z+.15],[x+step-.16,4.55,z+.13]],.036,'green','estimate');
    }
  }
  for(const sign of[-1,1]){
    b.box(sign*1.37,1.95,z+.17,.3,3.55,.4,'stone');b.box(sign*1.37,.32,z+.28,.55,.32,.63,'trim');
    b.box(sign*1.37,3.68,z+.22,.57,.19,.59,'trim');
  }
  b.box(0,4.65,z+.17,3.45,.36,.44,'stone');pediment(b,0,3.65,z+.36,3.2,.74);
  for(let i=0;i<3;i++)b.box(0,.06+i*.10,z+1.2-i*.24,3.7-i*.2,.12,.55,'stone');
  const group=b.finish('bank-of-taiwan');
  return {group,height:h,planBoundary:[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]],focus:[0,7,z-1],detailFocus:[0,3,z],labels:[{text:'BANK OF TAIWAN',position:[0,4.65,z+.405],width:3.2,height:.29,color:'#324443'}]};
}

function ornateFacade(w,h,bays,{side=false}={}) {
  const b=new Builder();const z=0;
  const xs=Array.from({length:bays},(_,i)=>(i-(bays-1)/2)*(w-4)/(bays-1));
  const openings=[];
  for(let level=0;level<4;level++)for(let i=0;i<xs.length;i++){
    const y=[1.05,5.8,9.62,13.6][level],kind=level===0||level===3||(level===2&&i>0&&i<xs.length-1)?'arch':'rect';
    const entry=!side&&level===0&&i===Math.floor(xs.length/2);
    openings.push({x:xs[i],y:entry?.35:y,width:entry?2.4:level===0?2.4:2.0,height:entry?3.8:level===0?3.55:2.68,kind,level,entry});
  }
  b.add(wallGeometry(w,h,.5,openings),'stone',[0,0,z],[0,0,0],'reference',false);
  openings.forEach(o=>{
    if(o.entry){
      b.pane(o,-.3,'dark');b.frame(o,.04,.19,'trim');
      // The source photo shows an arched portal, not a triangular portico.
      const radius=o.width/2,shoulder=o.y+o.height-radius;
      for(let x=-radius+.12;x<radius;x+=.16){const top=shoulder+Math.sqrt(radius*radius-x*x);b.box(x,(top+o.y)/2,-.14,.025,top-o.y,.035,'metal');}
      for(const y of[o.y+1.05,o.y+2.2,shoulder])b.box(0,y,-.12,o.width,.035,.045,'metal');
      for(let i=0;i<3;i++)b.box(0,.07+i*.09,.8-i*.22,3.1-i*.14,.13,.53,'stone');
    }else window(b,o,z,{shutter:o.level!==0,frameMaterial:'wood'});
    if(o.level===1){
      // Segmental pediments visible in B2-a; do not reuse B1's triangular profile.
      const y=o.y+o.height+.16,half=1.375,rise=.4,R=(half*half+rise*rise)/(2*rise),span=Math.asin(half/R);
      const arc=Array.from({length:25},(_,i)=>{const a=Math.PI/2+span-span*2*i/24;return[o.x+R*Math.cos(a),y+rise-R+R*Math.sin(a)];});
      const shape=new THREE.Shape(arc.map(p=>new THREE.Vector2(...p)));shape.closePath();
      b.add(new THREE.ExtrudeGeometry(shape,{depth:.28,bevelEnabled:false}),'stone',[0,0,z+.08]);
      b.tube(arc.map(p=>[p[0],p[1],z+.4]),.065,'trim');b.box(o.x,y-.05,z+.28,3,.17,.45,'trim');
      b.ring(o.x,y+.32,z+.4,.18,.035,'green');
    }
    if(o.level===3&&(Math.abs(o.x)<.1||o.x===xs[0]||o.x===xs.at(-1)))balcony(b,o.x,o.y-.08,z+.1,2.7,.62,true);
    if(o.level===0){b.box(o.x,o.y+o.height+.08,z+.19,.3,.37,.38,'trim');}
  });
  for(let i=0;i<xs.length-1;i++)for(const offset of[-.24,.24]){
    const x=(xs[i]+xs[i+1])/2+offset;
    b.flutedColumn(x,5.35,z+.13,7.65,.2);
  }
  bands(b,w,z,[.82,5.07,5.4,13.18,17.07,17.57,18.02]);
  // Joint lines only between openings, not painted across the windows.
  for(let y=1.5;y<4.9;y+=.62){
    let start=-w/2;
    for(const x of [...xs,w/2+1.3]){const end=x-1.3;if(end>start)b.box((start+end)/2,y,z+.008,end-start,.035,.032,'dark');start=x+1.3;}
  }
  for(const x of xs)b.box(x,.48,z+.015,1.65,.45,.065,'dark');
  for(let x=-w/2+.3;x<w/2-.2;x+=.54)b.box(x,17.78,z+.23,.19,.27,.38,'trim');
  return b.finish(side?'bank-side-fragment':'bank-front');
}
function indochineLoggia(length,config) {
  const b=new Builder(),depth=config.depth,gap=(length-4)/6;
  const xs=Array.from({length:7},(_,i)=>(i-3)*gap),open=xs.slice(1,-1),span=gap-.9;
  // B2-c (2012) supports the open structural arrangement, not current paint or exact dimensions.
  const lower=xs.map((x,i)=>({x,y:i>=2&&i<=4?.35:1.05,width:2.7,height:i>=2&&i<=4?4.25:3.55,kind:'arch',entry:i>=2&&i<=4}));
  b.add(wallGeometry(length,5.2,.45,lower),'stone',[0,0,0],[0,0,0],'reference',false);
  for(const o of lower){
    if(o.entry){b.pane(o,-.32,'dark');b.frame(o,.02,.15);}
    else window(b,o,0,{frameMaterial:'wood'});
  }
  const middle=[{x:0,y:0,width:gap*5-.9,height:7.95,kind:'rect'}];
  const ends=[];
  for(const x of [xs[0],xs[6]])for(const [y,kind]of [[5.8,'rect'],[9.62,'arch']]){
    const o={x,y,width:2,height:2.68,kind};ends.push(o);middle.push({...o,y:y-5.2});
  }
  b.add(wallGeometry(length,8.05,.45,middle),'stone',[0,5.2,0],[0,0,0],'reference',false);
  ends.forEach(o=>window(b,o,0,{shutter:true}));
  const top=open.map(x=>({x,y:.2,width:span,height:3.85,kind:'arch'}));
  for(const x of [xs[0],xs[6]])top.push({x,y:.35,width:2,height:2.68,kind:'arch',closed:true});
  b.add(wallGeometry(length,5.05,.45,top),'stone',[0,13.25,0],[0,0,0],'reference',false);
  top.filter(o=>o.closed).forEach(o=>window(b,{...o,y:o.y+13.25},0,{shutter:true}));
  // No glass or decorative wall is allowed across the open bays. Interior arrangement is unknown.
  b.box(0,11.7,-depth-.18,gap*5,13.2,.36,'unknown','unknown',false);
  for(const y of [5.15,9.05,13.18])b.box(0,y-.1,-depth/2,length,.2,depth+.2,'stone','estimate');
  for(let i=0;i<=5;i++){
    const edge=(i-2.5)*gap;
    for(const offset of i===0?[.18]:i===5?[-.18]:[-.24,.24]){
      const x=edge+offset;
      b.cylinder(x,9.07,.02,.23,7.7,'stone',.205);
      b.box(x,5.25,.02,.63,.23,.63,'trim');b.box(x,12.98,.02,.68,.2,.68,'trim');
      b.cylinder(x,12.79,.02,.29,.2,'trim');
    }
  }
  for(const y of [5.17,9.07])for(const x of open)balcony(b,x,y,.03,gap-.7,.5);
  for(const x of [xs[0],xs[6]]){
    balcony(b,x,5.17,.03,2.7,.62,true);balcony(b,x,13.6,.03,2.7,.62,true);
  }
  bands(b,length,0,[.82,5.07,5.4,13.18,17.07,17.57,18.02]);
  for(let x=-length/2+.3;x<length/2-.2;x+=.54)b.box(x,17.78,.23,.19,.27,.38,'trim');
  return b.finish('indochine-east-loggia');
}

function indochine(s) {
  if(s.eastLoggia&&(s.eastLoggia.openBays!==5||!Number.isFinite(s.eastLoggia.depth)||s.eastLoggia.depth<=0))throw new Error('Unsupported loggia definition');
  const b=new Builder(),w=s.width,d=s.depth,h=18.3,z=d/2;
  shell(b,w,d,h,true,!!s.eastLoggia);
  // Presentation F0 uses the short edge; geographic heading remains unverified.
  const front=ornateFacade(w,h,5);front.position.z=z;
  // Only the photographed near corner is detailed; the rest stays explicitly unknown.
  const side=ornateFacade(d*.42,h,3,{side:true});side.rotation.y=Math.PI/2;side.position.set(w/2,0,d/2-d*.21);
  const group=b.finish('indochine-volume');group.add(front,side);
  if(s.eastLoggia){
    const east=indochineLoggia(d,s.eastLoggia);east.rotation.y=-Math.PI/2;east.position.x=-w/2;group.add(east);
  }
  return{group,height:h,landmarks:{eave:18.02},planBoundary:[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]],focus:[0,8.6,z-1],detailFocus:[0,7,z],labels:[]};
}

function churchSide(length,height,{start=-length/2,end=length/2}={}) {
  const b=new Builder(),width=end-start,center=(start+end)/2;
  const xs=[-2,-1,0,1,2].map(i=>i*(length-4)/4).filter(x=>x-.65>=start&&x+.65<=end);
  const openings=[];
  for(const x of xs){openings.push({x,y:1.5,width:1.1,height:3.55,kind:'pointed'});openings.push({x,y:6,width:1.16,height:1.16,kind:'circle'});}
  b.add(wallGeometry(width,height,.42,openings.map(o=>({...o,x:o.x-center}))),'trim',[center,0,0],[0,0,0],'reference',false);
  for(const o of openings){churchShutter(b,o,-.17);b.frame(o,.015,.13,'trim');if(o.kind==='circle'){b.ring(o.x,o.y+o.height/2,.19,o.width/2+.11,.065,'trim');}}
  for(let i=0;i<=5;i++){
    const x=-length/2+.16+(length-.32)*i/5;
    if(x<start||x>end)continue;
    b.box(x,3.5,.25,.32,7,.68,'trim');b.box(x,7.8,.25,.45,.24,.88,'trim');
    b.triangle([[x-.36,7.92],[x,9.2],[x+.36,7.92]],.06,.35,'trim');
    b.cylinder(x,9.3,.24,.055,.45,'trim',.025);
  }
  bands(b,width,0,[.65,7.65,7.95],'trim',center);
  for(let x=-length/2+.3;x<end;x+=.42){
    if(x<start)continue;
    b.box(x,7.53,.14,.14,.22,.27,'trim');
    b.ring(x,7.75,.22,.13,.028,'trim');
  }
  return b.finish('church-side');
}
function church(s) {
  // The source long edge already includes the front tower extension.
  const b=new Builder(),w=s.width,d=s.depth-3.2,h=8.25,z=d/2;
  b.box(0,h/2,-d/2,w,h,.4,'unknown','unknown',false);
  b.box(w/2,h/2,-d*.21,.32,h,d*.58,'unknown','unknown',false);
  b.box(0,-.15,0,w+.6,.3,d+.6,'stone','estimate',false);
  const roofY=11.0;
  b.triangle([[-w/2-.22,h],[0,roofY],[w/2+.22,h]],-d/2,d,'roof','estimate');
  b.triangle([[-w/2,h],[0,roofY],[w/2,h]],z-.08,.16,'trim');
  b.tube([[-w/2-.25,h+.1,z+.1],[0,roofY+.15,z+.1],[w/2+.25,h+.1,z+.1]],.1,'trim');
  b.tube([[0,roofY+.12,-d/2],[0,roofY+.12,z]],.09,'trim');
  for(let zz=-d/2+.3;zz<d/2;zz+=.6)for(const sign of[-1,1])b.tube([[0,roofY+.025,zz],[sign*(w/2+.2),h+.02,zz]],.017,'stone','estimate');
  const door={x:0,y:.35,width:2.1,height:4.5,kind:'pointed'};
  const frontOpen=[{x:-w*.33,y:1.5,width:1.0,height:3.7,kind:'pointed'},{x:w*.33,y:1.5,width:1.0,height:3.7,kind:'pointed'}];
  b.add(wallGeometry(w,h,.4,frontOpen),'trim',[0,0,z],[0,0,0],'reference',false);
  frontOpen.forEach(o=>{churchShutter(b,o,z-.13);b.frame(o,z+.015,.16);});
  const tw=3.55,tz=z+1.45,td=3.5,tf=tz+td/2;
  b.add(wallGeometry(tw,8,.44,[door]),'trim',[0,0,tf],[0,0,0],'reference',false);
  b.pane(door,tf-.28,'wood');b.frame(door,tf+.02,.24);b.frame({...door,width:door.width+.5,height:door.height+.45,y:.18},tf+.05,.12);
  b.triangle([[-2.18,4.7],[0,7.35],[2.18,4.7]],tf-.2,.3,'trim');
  b.triangle([[-1.62,4.94],[0,6.87],[1.62,4.94]],tf+.105,.05,'yellow');
  b.ring(0,6.15,tf+.22,.34,.07,'trim');
  for(const x of[-1.45,1.45]){
    b.box(x,5.45,tf+.24,.15,1.7,.2,'trim');
    b.cylinder(x,6.45,tf+.25,.17,.55,'trim',0,'reference',8);
  }
  for(const sy of[8.0,11.55,12.05,17.7,18.2])b.box(0,sy,tz,tw+.42,.19,td+.42,'trim');
  // Hollow tower with actual circular / pointed openings in three photographed directions.
  for(const [ry,px,pz]of[[0,0,tf],[Math.PI/2,tw/2,tz],[-Math.PI/2,-tw/2,tz]]){
    const f=new Builder();
    if(ry!==0)f.box(0,4,-.14,tw,8,.28,'trim','estimate',false);
    const circle={x:0,y:8.65,width:1.44,height:1.44,kind:'circle'};
    const bell={x:0,y:12.65,width:1.30,height:4.55,kind:'pointed'};
    f.add(wallGeometry(tw,10.2,.28,[{...circle,y:circle.y-8},{...bell,y:bell.y-8}]),'trim',[0,8,0],[0,0,0],'reference',false);
    churchShutter(f,circle,-.1);f.frame(circle,.03,.15);f.ring(0,9.37,.20,.89,.065,'trim');
    churchShutter(f,bell,-.12);f.frame(bell,.02,.16);
    for(const x of[-tw/2+.16,tw/2-.16])f.box(x,13.1,.15,.24,10.1,.34,'trim');
    const g=f.finish('tower-openings');g.rotation.y=ry;g.position.set(px,0,pz);b.labels.push(g);
  }
  b.box(0,9,tz-td/2,tw,18,.28,'unknown','unknown',false);
  for(const x of[-tw/2,tw/2])for(const zz of[tz-td/2,tz+td/2]){
    b.box(x,9,zz,.27,18,.27,'trim');b.cylinder(x,18.6,zz,.18,1.35,'trim',0, 'reference',8);
  }
  b.add(new THREE.ConeGeometry(2.05,6.1,8),'trim',[0,21.25,tz],[0,Math.PI/8,0],'estimate',false);
  for(let k=0;k<8;k++){
    const a=k*Math.PI/4+Math.PI/8;
    b.tube([[Math.cos(a)*1.9,18.3,tz+Math.sin(a)*1.9],[0,24.3,tz]],.052,'trim');
    for(let y=19;y<23.5;y+=.8){const r=(24.3-y)/6.0*1.92;b.cylinder(Math.cos(a)*r,y,tz+Math.sin(a)*r,.12,.34,'trim',0,'reference',6);}
  }
  b.box(0,24.8,tz,.10,1.2,.10,'metal');b.box(0,25.06,tz,.65,.085,.085,'metal');
  for(const x of[-w/2,w/2]){
    b.box(x,3.9,z+.2,.52,7.8,.72,'trim');b.cylinder(x,8.4,z+.2,.29,1.2,'trim',0,'reference',8);
  }
  for(let i=0;i<3;i++)b.box(0,.06+i*.10,tf+.95-i*.26,2.9-i*.2,.12,.6,'stone');
  const group=b.finish('lourdes');
  const left=churchSide(d,h);left.rotation.y=-Math.PI/2;left.position.x=-w/2;group.add(left);
  const right=churchSide(d,h,{start:-d/2,end:-d*.08});right.rotation.y=Math.PI/2;right.position.x=w/2;group.add(right);
  b.labels.forEach(g=>group.add(g));
  return{group,height:25.4,planBoundary:[[-w/2,-z],[w/2,-z],[w/2,z],[tw/2,z],[tw/2,tf],[-tw/2,tf],[-tw/2,z],[-w/2,z]],focus:[0,11.5,z*.45],detailFocus:[0,4.2,tf],labels:[]};
}

function junction(data) {
  const b=new Builder(),r=data.road;
  if(r.markings!==undefined&&(!Array.isArray(r.markings)||r.markingVersion!==1))throw new Error('Unsupported road marking version or payload');
  if(!r.production)b.box(0,-.42,0,174,.72,148,'paving','estimate',false);
  const lift=r.production?.07:0;
  for(const p of r.surfaces)b.flat(p,.015+lift,'road','estimate');
  for(const p of r.walkways){
    const s=new THREE.Shape(p.outer.map(q=>new THREE.Vector2(q[0],-q[1])));
    p.holes.forEach(h=>s.holes.push(new THREE.Path(h.map(q=>new THREE.Vector2(q[0],-q[1])))));
    b.add(new THREE.ExtrudeGeometry(s,{depth:.18,bevelEnabled:false,curveSegments:8}),'paving',[0,.02+lift,0],[-Math.PI/2,0,0],'estimate');
  }
  // Whole paint polygons are clipped offline, including road holes and tile boundaries.
  // Crossing paths without marking evidence remain in data without invented white stripes.
  for(const marking of r.markings||[])for(const polygon of marking.polygons)b.flat(polygon,.055+lift,'paint','estimate',true);
  for(const line of r.lines.filter(l=>l.kind==='road'))for(let i=1;i<line.points.length;i++){
    const a=line.points[i-1],p=line.points[i],dx=p[0]-a[0],dz=p[1]-a[1],L=Math.hypot(dx,dz);if(L<18)continue;
    if(!r.production)for(let d=8;d<L-5;d+=7){const x=a[0]+dx*d/L,z=a[1]+dz*d/L;if(Math.abs(x)<21&&Math.abs(z)<26)continue;b.box(x,.04,z,.1,.02,2.8,'paint','estimate',true,-Math.atan2(dz,dx)+Math.PI/2);}
  }
  for(const [x,z]of r.production?[]:[[-10,-23],[9,-22],[-10,23],[9,22]]){
    b.cylinder(x,2.7,z,.07,5.4,'metal',.07,'estimate');
    b.box(x,4.8,z,.26,.8,.2,'dark','estimate');
    for(let k=0;k<3;k++)b.add(new THREE.SphereGeometry(.085,10,8),k===0?'signal':'dark',[x,5.06-k*.25,z+.12],[0,0,0],'estimate');
  }
  const group=b.finish('huasui-junction');
  const topology=new THREE.Group();topology.name='topology';
  for(const line of r.lines){
    const geometry=new THREE.BufferGeometry().setFromPoints(line.points.map(p=>new THREE.Vector3(p[0],.35,p[1])));
    const mesh=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:line.kind==='road'?0x357f9f:0x71884f}));mesh.userData.sourceId=line.sourceId;topology.add(mesh);
  }
  topology.visible=false;group.add(topology);
  return{group,height:6,focus:[0,0,0],detailFocus:[0,0,0],topology,labels:[{text:'花 城 大 道',position:[-45,.25,0],width:19,height:3,flat:true,color:'#53645d'}]};
}

// C01/C02 fit their plans to the source control points inside the model builders;
// fitting them again here would apply the same horizontal correction twice.
const SELF_FITTED={C01:christChurch,C02:specieBank};
export function buildSample(id,data) {
  if(SELF_FITTED[id])return{...SELF_FITTED[id](data.buildings[id]),id,metricAccuracy:'unverified',sourceIds:[data.buildings[id].sourceId]};
  // Facade studies carry their plan in the model frame; the kit needs no plan fit.
  if(data.buildings?.[id]?.kind==='facade-study')return{...facadeStudy(data.buildings[id]),id,metricAccuracy:'unverified',sourceIds:[data.buildings[id].sourceId]};
  const result=id==='J1'?junction(data):id==='B1'?bank(data.buildings.B1):id==='B2'?indochine(data.buildings.B2):id==='B3'?church(data.buildings.B3):null;
  if(!result)throw new Error(`Unknown sample ${id}`);
  if(id!=='J1'){
    try{
      if(data.buildings[id].planFit)fitSamplePlan(result,data.buildings[id].planFit);
      if(data.buildings[id].verticalControl)applyVerticalControl(result,data.buildings[id].verticalControl);
    }catch(error){disposeGroup(result.group);throw error;}
  }
  return{...result,id,metricAccuracy:'unverified',sourceIds:id==='J1'?data.road.lines.map(l=>l.sourceId):[data.buildings[id].sourceId]};
}
