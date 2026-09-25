import * as THREE from '../../vendor/three/build/three.module.js';

export function openingPath({ x = 0, y = 0, width: w, height: h, kind = 'rect' }, Shape = THREE.Path) {
  const p = new Shape();
  if (kind === 'circle') { p.absarc(x, y + h / 2, w / 2, 0, Math.PI * 2, false); return p; }
  p.moveTo(x - w / 2, y); p.lineTo(x + w / 2, y);
  if (kind === 'arch') {
    p.lineTo(x + w / 2, y + h - w / 2);
    p.absarc(x, y + h - w / 2, w / 2, 0, Math.PI, false);
  } else if (kind === 'pointed') {
    const shoulder = y + h * .62;
    p.lineTo(x + w / 2, shoulder);
    p.quadraticCurveTo(x + w * .45, y + h * .82, x, y + h);
    p.quadraticCurveTo(x - w * .45, y + h * .82, x - w / 2, shoulder);
  } else { p.lineTo(x + w / 2, y + h); p.lineTo(x - w / 2, y + h); }
  p.lineTo(x - w / 2, y); p.closePath(); return p;
}

export function wallGeometry(w, h, thickness, openings = []) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2, h); s.lineTo(-w / 2, h); s.closePath();
  for (const o of openings) s.holes.push(openingPath(o));
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false, curveSegments: 16 });
  g.translate(0, 0, -thickness); return g;
}

const palette = {
  stone: ['#c6c0ac', .83], trim: ['#e6e2d4', .77], yellow: ['#c6a752', .84],
  brick: ['#925949', .92], dark: ['#303f3d', .74], wood: ['#734531', .82], churchShutter: ['#71372f', .86],
  green: ['#3c6a60', .71], glass: ['#45666b', .25], roof: ['#69534a', .94],
  unknown: ['#bbc1bd', .95], paving: ['#c7c9c3', .9], road: ['#50595b', .95],
  paint: ['#edebd8', .86], metal: ['#394b48', .45], soil: ['#9aaa88', 1], signal: ['#ce9d54', .65],
};

export class Builder {
  constructor() { this.batches = new Map(); this.labels = []; }
  add(geometry, material = 'stone', pos = [0, 0, 0], rot = [0, 0, 0], evidence = 'reference', detail = true) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(1, 1, 1)));
    const key = `${material}|${evidence}|${detail}`;
    if (!this.batches.has(key)) this.batches.set(key, []);
    this.batches.get(key).push(g);
  }
  box(x,y,z,w,h,d,mat='stone',e='reference',detail=true,ry=0) { this.add(new THREE.BoxGeometry(w,h,d),mat,[x,y,z],[0,ry,0],e,detail); }
  cylinder(x,y,z,r,h,mat='trim',rt=r,e='reference',segments=20) { this.add(new THREE.CylinderGeometry(rt,r,h,segments),mat,[x,y,z],[0,0,0],e); }
  ring(x,y,z,r,t,mat='trim',e='reference',rotation=[0,0,0]) { this.add(new THREE.TorusGeometry(r,t,6,32),mat,[x,y,z],rotation,e); }
  tube(points,r=.025,mat='metal',e='reference',closed=false) {
    const curve = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),closed,'centripetal');
    this.add(new THREE.TubeGeometry(curve,Math.max(8,points.length*2),r,6,closed),mat,[0,0,0],[0,0,0],e);
  }
  pane(o,z,mat='glass',e='reference') { this.add(new THREE.ShapeGeometry(openingPath(o,THREE.Shape),20),mat,[0,0,z],[0,0,0],e); }
  frame(o,z,t=.12,mat='trim',e='reference') {
    const s=openingPath({...o,width:o.width+t*2,height:o.height+t*2,y:o.y-t},THREE.Shape);s.holes.push(openingPath(o));
    this.add(new THREE.ExtrudeGeometry(s,{depth:.12,bevelEnabled:true,bevelThickness:.015,bevelSize:.018,bevelSegments:1,curveSegments:18}),mat,[0,0,z],[0,0,0],e);
  }
  triangle(points,z,depth,mat='trim',e='reference') {
    const s=new THREE.Shape(points.map(p=>new THREE.Vector2(...p)));
    this.add(new THREE.ExtrudeGeometry(s,{depth,bevelEnabled:false}),mat,[0,0,z],[0,0,0],e);
  }
  flat(poly,y,mat='paving',e='estimate',detail=false) {
    const s=new THREE.Shape(poly.outer.map(p=>new THREE.Vector2(p[0],-p[1])));
    for(const h of poly.holes||[])s.holes.push(new THREE.Path(h.map(p=>new THREE.Vector2(p[0],-p[1]))));
    this.add(new THREE.ShapeGeometry(s),mat,[0,y,0],[-Math.PI/2,0,0],e,detail);
  }
  flutedColumn(x,y,z,height,r=.4) {
    const profile=[[0,r*1.06],[.12,r*1.06],[.24,r],[height*.3,r*.97],[height*.75,r*.88],[height,r*.84]];
    const pts=[],idx=[],n=64;
    for(const [py,pr]of profile)for(let i=0;i<=n;i++){const a=i/n*Math.PI*2;const radius=pr*(1-.035*(1+Math.cos(a*16)));pts.push(Math.cos(a)*radius,py,Math.sin(a)*radius);}
    for(let j=0;j<profile.length-1;j++)for(let i=0;i<n;i++){const a=j*(n+1)+i,b=a+n+1;idx.push(a,b,a+1,a+1,b,b+1);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));g.setIndex(idx);g.computeVertexNormals();this.add(g,'trim',[x,y,z]);
    this.box(x,y+.05,z,r*2.65,.18,r*2.65,'trim');this.cylinder(x,y+.23,z,r*1.2,.2,'trim');
    this.box(x,y+height+.15,z,r*2.7,.25,r*2.35,'trim');
    for(const s of[-1,1])this.ring(x+s*r*.73,y+height-.04,z+r*.8,r*.3,r*.07,'trim');
  }
  finish(name) {
    const group=new THREE.Group();group.name=name;
    for(const [key,geometries]of this.batches){
      const [mat,e,detail]=key.split('|');let count=0;for(const g of geometries)count+=g.attributes.position.count;
      const p=new Float32Array(count*3),n=new Float32Array(count*3);let at=0;
      for(const g of geometries){p.set(g.attributes.position.array,at);n.set(g.attributes.normal.array,at);at+=g.attributes.position.array.length;g.dispose();}
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(p,3));geo.setAttribute('normal',new THREE.BufferAttribute(n,3));geo.computeBoundingSphere();
      const [color,roughness]=palette[mat]||palette.stone;
      const material=new THREE.MeshStandardMaterial({color,roughness,metalness:mat==='metal'?.3:mat==='glass'?.32:0,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geo,material);mesh.castShadow=mat!=='glass';mesh.receiveShadow=true;
      mesh.userData={evidence:e,detail:detail==='true',baseColor:color,materialTag:mat};group.add(mesh);
    }
    return group;
  }
}

export function disposeGroup(group) { group.traverse(o=>{if(o.isMesh||o.isLine){o.geometry.dispose();if(o.material.map)o.material.map.dispose();o.material.dispose();}}); }
