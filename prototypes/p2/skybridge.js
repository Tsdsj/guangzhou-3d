import * as THREE from '../../vendor/three/build/three.module.js';
import {Builder} from './geometry.js';

export function skybridge(s){
  const values=Object.fromEntries(Object.entries(s.parameters).map(([k,p])=>[k,p.value]));
  const {deckTopM:y,widthM:w,clearHeightM:h,slabThicknessM:t,roofThicknessM:rt,framePitchM:pitch}=values,L=s.lengthM;
  if(![y,w,h,t,rt,pitch,L].every(v=>Number.isFinite(v)&&v>0)||y<=t)throw new Error('Invalid skybridge dimensions');
  const b=new Builder(),front=new Builder(),roof=new Builder();
  b.box(0,y-t/2,0,L,t,w,'trim','estimate');
  b.box(0,y-t-.035,0,L,.07,w-.2,'wood','reference');
  // Frame rhythm follows the visible structure; all spacing and sections remain estimates.
  for(const side of [-1,1]){
    const builder=side===-1?front:b,e=side===-1?'reference':'unknown';
    builder.box(0,y+h/2,side*w/2,L,h,.055,'glass',e);
    for(let i=0,count=Math.ceil(L/pitch);i<=count;i++)builder.box(-L/2+i*L/count,y+h/2,side*(w/2+.04),.065,h,.11,'metal',e);
    for(const level of [0,h*.48,h])builder.box(0,y+level,side*(w/2+.05),L,.07,.12,'metal',e);
  }
  roof.box(0,y+h+rt/2,0,L,rt,w+.12,'unknown','unknown');
  for(let x=-L/2+.5;x<L/2;x+=3)roof.box(x,y+h-.1,0,.13,.2,w,'metal','estimate');
  for(const fp of s.contextFootprints)b.flat(fp,.015,'unknown','unknown',false);
  const group=b.finish('spring-summer-skybridge'),frontGroup=front.finish('photo-side'),roofGroup=roof.finish('unknown-roof');
  for(const mesh of group.children)if(mesh.userData.materialTag==='unknown'&&!mesh.userData.detail)mesh.userData.preflightExclude=true;
  const sectionMeshes=[...frontGroup.children,...roofGroup.children];
  for(const mesh of [...sectionMeshes])group.add(mesh);
  // Only the visible-side structure is photo-supported. Its placement is provisional.
  for(const mesh of group.children)if(mesh.userData.materialTag==='glass'){
    mesh.material.transparent=true;mesh.material.opacity=.43;mesh.material.depthWrite=false;
  }
  const topology=new THREE.Group();topology.name='source-interfaces';
  function line(points,color){const obj=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color,depthTest:false}));obj.renderOrder=5;topology.add(obj);}
  line(s.interfaces.map(p=>[p.point[0],y+.04,p.point[1]]),0x237a84);
  for(const p of s.interfaces){const [x,z]=p.point;line([[x,0,z],[x,y+h+.7,z]],0xc18334);line([[x-.6,y+.08,z],[x+.6,y+.08,z]],0xc18334);}
  topology.visible=false;group.add(topology);
  return {id:'S1',group,height:y+h+rt,focus:[0,y+1,0],detailFocus:[L/2-3,y+1,-w/2],topology,sectionMeshes,metricAccuracy:'unverified',sourceIds:[s.sourceId,...s.interfaces.map(p=>p.buildingId)],labels:[
    {text:'春广场 · 轮廓片段',position:[-L/2-4,.04,-8],width:10,height:1.1,flat:true,color:'#53645d'},
    {text:'夏广场 · 轮廓片段',position:[L/2+4,.04,-8],width:10,height:1.1,flat:true,color:'#53645d'},
  ]};
}
