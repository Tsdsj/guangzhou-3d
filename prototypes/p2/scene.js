import * as THREE from '../../vendor/three/build/three.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildSample } from './models.js';
import { disposeGroup } from './geometry.js';
import { interpolatePose } from './camera.js';
import {previewGroundY} from '../../src/models/model-preflight.js';
import { createSampleLabel } from '../../src/models/sample-labels.js';

export class StudyViewer {
  constructor(container,onStats) {
    this.container=container;this.onStats=onStats;this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.setClearColor(0xe4e7df);
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.04;
    this.renderer.domElement.tabIndex=0;this.renderer.domElement.setAttribute('aria-label','三维模型视口，拖动或使用方向键旋转，加减键缩放，R重置');
    container.append(this.renderer.domElement);
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0xe4e7df);
    this.camera=new THREE.PerspectiveCamera(34,1,.08,1200);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=!this.reduced.matches;this.controls.dampingFactor=.09;
    this.controls.minPolarAngle=.06;this.controls.maxPolarAngle=Math.PI*.49;this.controls.minDistance=4;this.controls.maxDistance=420;
    this.controls.addEventListener('start',()=>{this.motion=null;this.view='free';this.onViewChange?.('free');});
    this.reduced.addEventListener('change',e=>{
      this.controls.enableDamping=!e.matches;
      if(e.matches&&this.motion){this.camera.position.copy(this.motion.to);this.controls.target.copy(this.motion.toTarget);this.motion=null;this.controls.update();}
    });
    const hemi=new THREE.HemisphereLight(0xeaf2f5,0x9ba18f,1.75);this.scene.add(hemi);
    this.sun=new THREE.DirectionalLight(0xffefd8,2.8);this.sun.position.set(-40,65,48);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);
    this.sun.shadow.bias=-.0002;this.sun.shadow.normalBias=.035;this.sun.shadow.camera.near=1;this.sun.shadow.camera.far=250;this.scene.add(this.sun);this.scene.add(this.sun.target);
    const fill=new THREE.DirectionalLight(0xe0eaf1,.7);fill.position.set(40,20,-20);this.scene.add(fill);
    this.ground=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600),new THREE.MeshStandardMaterial({color:0xdce1d6,roughness:1}));
    this.ground.rotation.x=-Math.PI/2;this.ground.position.y=-.5;this.ground.receiveShadow=true;this.scene.add(this.ground);
    this.grid=new THREE.GridHelper(300,60,0xa6b3a6,0xbfc9bc);this.grid.position.y=-.492;this.grid.material.transparent=true;this.grid.material.opacity=.25;this.scene.add(this.grid);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);
    this.renderer.domElement.addEventListener('keydown',e=>this.key(e));
    this.options={evidence:false,baseline:false,wireframe:false,topology:false,section:false};
    this.lastStats=0;this.frames=0;this.running=true;this.frame=this.frame.bind(this);requestAnimationFrame(this.frame);
  }
  resize(){const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  load(id,data){
    if(this.sample){this.scene.remove(this.sample.group);disposeGroup(this.sample.group);}
    if(this.baseline){this.scene.remove(this.baseline);disposeGroup(this.baseline);this.baseline=null;}
    if(this.highlight){this.scene.remove(this.highlight);disposeGroup(this.highlight);this.highlight=null;}
    this.ground.position.y=previewGroundY(id);this.grid.position.y=this.ground.position.y+.008;
    this.data=data;this.sample=buildSample(id,data);this.scene.add(this.sample.group);
    for(const label of this.sample.labels||[])this.addLabel(label);
    if(data.buildings[id]?.baselineHeight){
      const s=data.buildings[id],h=s.baselineHeight;
      const m=new THREE.Mesh(new THREE.BoxGeometry(s.width,h,s.depth),new THREE.MeshStandardMaterial({color:0xaebbb2,roughness:.92}));m.position.y=h/2;m.castShadow=true;m.receiveShadow=true;this.baseline=new THREE.Group();this.baseline.add(m);this.baseline.visible=false;this.scene.add(this.baseline);
    }
    const extent=id==='J1'?110:45;const sc=this.sun.shadow.camera;sc.left=sc.bottom=-extent;sc.right=sc.top=extent;sc.updateProjectionMatrix();
    this.sun.position.set(-extent*.7,extent*1.4,extent*.85);this.sun.target.position.set(0,id==='J1'?0:6,0);this.sun.shadow.needsUpdate=true;
    this.options.baseline=false;this.options.section=false;this.applyOptions();this.setView(id==='J1'?'aerial':'corner',false);this.resize();
  }
  addLabel(label){
    const mesh=createSampleLabel(label);
    if(this.sample.id==='S1'&&label.flat)mesh.rotateZ(Math.PI);
    this.sample.group.add(mesh);
  }
  setView(view,animate=true){
    const s=this.sample;if(!s)return;const road=s.id==='J1';let target=new THREE.Vector3(...s.focus),position;
    if(road){
      target.set(0,0,0);position=new THREE.Vector3(...(view==='front'?[0,110,245]:view==='rear'?[-135,180,-190]:view==='detail'?[24,17,48]:view==='corner'?[135,160,190]:[60,260,175]));
    }else if(s.id==='S1'){
      const L=this.data.skybridge.lengthM,y=this.data.skybridge.parameters.deckTopM.value;
      const scale=this.camera.aspect<1?1.55:1;
      const poses={front:[0,y+4,-L*1.65],corner:[L*.75,y+L*.55,-L*1.25],aerial:[0,L*1.65,-1],rear:[-L*.4,y+L*.4,L*1.5],detail:[L*.22,y+5,-18]};
      position=new THREE.Vector3(...poses[view]);
      if(view==='detail')target.set(L*.22,y+1,0);
      position.sub(target).multiplyScalar(scale).add(target);
    }else{
      const {width:w,depth:d}=this.data.buildings[s.id],h=s.height;
      const distance=Math.max(w*1.9,h*2.25)*(this.camera.aspect<1?1.35:1);
      position=new THREE.Vector3(w*.65,h*.75,d/2+distance);
      if(s.id==='B2')position.x=this.data.buildings.B2.eastLoggia?-w*1.6:w;
      if(s.id==='B3'){position.set(-d*1.1,h*.62,d/2+distance*.64);position.sub(target).multiplyScalar(1.2).add(target);}
      if(view==='front')position.set(0,h*.52,d/2+distance);
      if(view==='rear'){target.set(0,h*.4,-d*.1);position.set(-w*.8,h*.85,-d/2-distance);}
      if(view==='aerial'){target.set(0,h*.3,0);position.set(w*.75,Math.max(h*2.9,d*1.65),d*.85);}
      if(view==='side'&&s.id==='C01'){target.set(w/2,4,-this.data.buildings.C01.naveDepth/2+4.6);position.set(w/2+distance*.65,8,target.z+3);}
      if(view==='detail'){target.set(...s.detailFocus);position.set(target.x+(s.id==='B3'?-3:3),target.y+1.9,target.z+(s.id==='B2'?16:11));}
      if(s.id==='C02'&&view==='aerial'&&this.camera.aspect<1)position.sub(target).multiplyScalar(1.7).add(target);
    }
    this.view=view;
    this.onViewChange?.(view);
    if(!animate||this.reduced.matches){this.motion=null;this.camera.position.copy(position);this.controls.target.copy(target);this.controls.update();}
    else this.motion={from:this.camera.position.clone(),to:position,fromTarget:this.controls.target.clone(),toTarget:target,start:performance.now()};
  }
  key(e){
    if(!this.sample)return;const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','r','R'];if(!keys.includes(e.key))return;e.preventDefault();this.motion=null;
    if(e.key.toLowerCase()==='r'){this.setView(this.sample.id==='J1'?'aerial':'corner');return;}
    this.view='free';this.onViewChange?.('free');
    const offset=this.camera.position.clone().sub(this.controls.target),s=new THREE.Spherical().setFromVector3(offset);
    if(e.key==='ArrowLeft')s.theta-=.10;if(e.key==='ArrowRight')s.theta+=.10;if(e.key==='ArrowUp')s.phi=Math.max(.08,s.phi-.08);if(e.key==='ArrowDown')s.phi=Math.min(Math.PI*.49,s.phi+.08);
    if(e.key==='+'||e.key==='=')s.radius*=.9;if(e.key==='-')s.radius*=1.1;
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(s));this.controls.update();
  }
  toggle(name){this.options[name]=!this.options[name];this.applyOptions();return this.options[name];}
  applyOptions(){
    if(!this.sample)return;const o=this.options;this.sample.group.visible=!o.baseline;
    if(this.baseline)this.baseline.visible=o.baseline;
    this.sample.group.traverse(mesh=>{if(!mesh.isMesh)return;if(mesh.userData.label){mesh.visible=!o.evidence&&!o.wireframe;return;}mesh.material.wireframe=o.wireframe;
      mesh.material.color.set(o.evidence?({reference:'#78ac96',estimate:'#c69d63',unknown:'#a3acae'}[mesh.userData.evidence]||'#a3acae'):mesh.userData.baseColor);
    });
    if(this.sample.topology)this.sample.topology.visible=o.topology;
    for(const mesh of this.sample.sectionMeshes||[])mesh.visible=!o.section;
  }
  selectRestriction(relation){
    if(this.highlight){this.scene.remove(this.highlight);disposeGroup(this.highlight);}
    this.highlight=new THREE.Group();
    for(const member of relation.members.filter(m=>m.type==='way')){
      const line=this.data.road.lines.find(l=>l.sourceId==='osm:w'+member.ref);if(!line)continue;
      const path=new THREE.CurvePath();const points=line.points.map(p=>new THREE.Vector3(p[0],.5,p[1]));
      for(let i=1;i<points.length;i++)path.add(new THREE.LineCurve3(points[i-1],points[i]));
      const geometry=new THREE.TubeGeometry(path,Math.max(12,points.length*6),member.role==='via'?.52:.30,6,false);
      const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:member.role==='via'?0xd6783b:0x527a4d,depthTest:false}));mesh.renderOrder=10;this.highlight.add(mesh);
    }
    this.scene.add(this.highlight);
  }
  frame(now){
    if(!this.running)return;requestAnimationFrame(this.frame);if(document.hidden)return;
    if(this.motion){const m=this.motion,t=Math.min(1,(now-m.start)/450),k=1-Math.pow(1-t,3),pose=interpolatePose(m,k);this.camera.position.copy(pose.position);this.controls.target.copy(pose.target);if(t===1)this.motion=null;}
    this.controls.update();this.renderer.render(this.scene,this.camera);this.frames++;
    if(now-this.lastStats>1000){this.onStats?.({triangles:this.renderer.info.render.triangles,calls:this.renderer.info.render.calls});this.frames=0;this.lastStats=now;}
  }
}
