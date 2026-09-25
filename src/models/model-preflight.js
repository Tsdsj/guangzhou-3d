import * as THREE from '../../vendor/three/build/three.module.js';
export function previewGroundY(id){return id==='J1'?-.5:0;}
function outsideDistance(x,z,polygon){
 let inside=false,min=Infinity;
 for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
  const [ax,az]=polygon[j],[bx,bz]=polygon[i],dx=bx-ax,dz=bz-az,L=dx*dx+dz*dz;
  const t=L?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/L)):0;
  min=Math.min(min,Math.hypot(x-ax-t*dx,z-az-t*dz));
  if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)inside=!inside;
 }
 return inside||min<1e-7?0:min;
}
// Only physical meshes, in the root's local frame. Lines, labels and context maps
// must not inflate model heights or be mistaken for structural ground contact.
export function measureModel(group,footprint=null){
 group.updateMatrixWorld(true);const inverse=group.matrixWorld.clone().invert(),box=new THREE.Box3(),v=new THREE.Vector3();
 let meshes=0,triangles=0,nonFiniteValues=0,maxPlanOverhangM=0,outsideVertices=0;
 group.traverse(o=>{
  if(!o.isMesh||o.userData.label||o.userData.preflightExclude)return;
  meshes++;const p=o.geometry.attributes.position,m=new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld);triangles+=(o.geometry.index?.count||p.count)/3;
  for(const attr of [p,o.geometry.attributes.normal])if(attr)for(const n of attr.array)if(!Number.isFinite(n))nonFiniteValues++;
  for(let i=0;i<p.count;i++){
   v.fromBufferAttribute(p,i).applyMatrix4(m);if(![v.x,v.y,v.z].every(Number.isFinite)){nonFiniteValues++;continue;}
   box.expandByPoint(v);if(footprint){const dist=outsideDistance(v.x,v.z,footprint);maxPlanOverhangM=Math.max(maxPlanOverhangM,dist);if(dist>1e-5)outsideVertices++;}
  }
 });
 if(box.isEmpty())throw new Error('No finite physical meshes to measure');
 return{meshes,triangles,nonFiniteValues,min:box.min.toArray(),max:box.max.toArray(),minY:box.min.y,maxY:box.max.y,maxPlanOverhangM:footprint?maxPlanOverhangM:null,outsideVertices:footprint?outsideVertices:null};
}
