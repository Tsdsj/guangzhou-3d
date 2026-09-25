import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import {buildSample} from '../src/models/detail-models.js';
import {wallGeometry} from '../src/models/detail-geometry.js';
const shutters=await import('../src/models/shutters.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e;});
const data=()=>JSON.parse(fs.readFileSync('prototypes/p2/samples.json'));

test('尖拱与圆窗百叶覆盖到顶部且边缘不会越过真实窗洞',()=>{
 assert.equal(typeof shutters.shutterLayout,'function');
 for(const o of [{x:0,y:2,width:1.3,height:4.55,kind:'pointed'},{x:0,y:2,width:1.44,height:1.44,kind:'circle'}]){
  const slats=shutters.shutterLayout(o);assert.ok(slats.length>7);
  assert.ok(slats.at(-1).y>o.y+o.height*.9);assert.ok(slats.at(-1).width<o.width*.7);
  const wall=new THREE.Mesh(wallGeometry(8,12,.3,[o]),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));wall.updateMatrixWorld(true);
  for(const s of slats)for(const dx of[-s.width/2,s.width/2])for(const dy of[-s.height/2,s.height/2]){
   const ray=new THREE.Raycaster(new THREE.Vector3(s.x+dx,s.y+dy,2),new THREE.Vector3(0,0,-1));
   assert.equal(ray.intersectObject(wall).length,0,'louver corner extends onto solid wall');
  }
 }
});

test('教堂院落侧片段使用完整侧墙的开间间距，不把五组窗压入42%长度',()=>{
 const d=data(),s=d.buildings.B3,b=buildSample('B3',d),length=s.depth-3.2;
 b.group.updateMatrixWorld(true);
 const side=b.group.children.find(o=>o.name==='church-side'&&o.position.x>0),wall=side.children.find(o=>o.isMesh&&!o.userData.detail);
 wall.material.side=THREE.DoubleSide;
 const ray=new THREE.Raycaster(new THREE.Vector3(s.width/2+2,2.2,length*.29),new THREE.Vector3(-1,0,0));
 assert.ok(ray.intersectObject(wall).length>0,'extra central opening in partial side must be solid wall');
 ray.set(new THREE.Vector3(s.width/2+2,2.2,(length-4)/2),new THREE.Vector3(-1,0,0));
 assert.equal(ray.intersectObject(wall).length,0,'photographed front bay remains open in the wall');
});

test('教堂钟塔高处百叶真实存在，银行首层花环不占用入口铭牌',()=>{
 const d=data(),c=buildSample('B3',d),tower=c.group.children.find(o=>o.name==='tower-openings'&&o.rotation.y===0);
 let highSlat=false;
 tower.traverse(o=>{if(o.userData.materialTag!=='churchShutter')return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)>16&&p.getZ(i)>-.18)highSlat=true;});
 assert.ok(highSlat,'upper bell opening must contain red-brown louvers');
 const bank=buildSample('B1',d),z=d.buildings.B1.depth/2;let green=0;
 bank.group.traverse(o=>{if(o.userData.materialTag!=='green')return;const p=o.geometry.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)>4.1&&p.getY(i)<4.7&&p.getZ(i)>z){green++;assert.ok(Math.abs(p.getX(i))>1.75,'nameplate must remain clear');}});
 assert.ok(green>100,'lower garlands are missing');
});
