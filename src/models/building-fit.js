import * as THREE from '../../vendor/three/build/three.module.js';

// Fit the nominal plan to its corresponding source outline, never the vertical scale.
// Outside ornaments extrapolate a nearby triangle (least barycentric deficit), not a clipped edge.
export function createPlanFit({source,target}) {
  if(!Array.isArray(source)||source.length<3||source.length!==target?.length||![...source,...target].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw new Error('Invalid plan fit');
  const triangles=THREE.ShapeUtils.triangulateShape(source.map(p=>new THREE.Vector2(...p)),[]).map(ids=>{
    const [a,b,c]=ids.map(i=>source[i]),dst=ids.map(i=>target[i]);
    const det=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);
    if(Math.abs(det)<1e-8)throw new Error('Degenerate plan fit');
    const weights=(x,z)=>{const v=((x-a[0])*(c[1]-a[1])-(z-a[1])*(c[0]-a[0]))/det,w=((b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]))/det;return[1-v-w,v,w];};
    const project=(x,z)=>{const w=weights(x,z);return[0,1].map(k=>w.reduce((n,v,i)=>n+v*dst[i][k],0));};
    const o=project(0,0),x=project(1,0),z=project(0,1),A=x[0]-o[0],B=z[0]-o[0],C=x[1]-o[1],D=z[1]-o[1],jac=A*D-B*C;
    if(jac<=1e-8)throw new Error('Plan fit would fold or reverse orientation');
    return{weights,project,A,B,C,D,jac};
  });
  if(triangles.length!==source.length-2)throw new Error('Incomplete plan triangulation');
  const at=(x,z)=>{
    let best,score=Infinity;
    for(const t of triangles){const w=t.weights(x,z),outside=w.reduce((sum,v)=>sum+Math.max(0,-v),0);if(outside<score){best=t;score=outside;}if(outside<1e-9)break;}
    return best;
  };
  return{
    point(p){const q=at(p.x,p.z).project(p.x,p.z);return new THREE.Vector3(q[0],p.y,q[1]);},
    geometry(geometry){
      const p=geometry.attributes.position,n=geometry.attributes.normal;
      for(let i=0;i<p.count;i++){
        const t=at(p.getX(i),p.getZ(i)),q=t.project(p.getX(i),p.getZ(i));
        p.setXYZ(i,q[0],p.getY(i),q[1]);
        if(n){const x=n.getX(i),y=n.getY(i),z=n.getZ(i),v=new THREE.Vector3((t.D*x-t.C*z)/t.jac,y,(-t.B*x+t.A*z)/t.jac).normalize();n.setXYZ(i,v.x,v.y,v.z);}
      }
      p.needsUpdate=true;if(n)n.needsUpdate=true;geometry.computeBoundingBox();geometry.computeBoundingSphere();
    },
  };
}

export function fitSamplePlan(sample,definition){
  const fit=createPlanFit(definition),group=sample.group,meshes=[];
  if(sample.planBoundary&&(sample.planBoundary.length!==definition.source.length||sample.planBoundary.some((p,i)=>Math.hypot(p[0]-definition.source[i][0],p[1]-definition.source[i][1])>1e-6)))throw new Error('Model plan changed; rebuild fit controls');
  group.updateMatrixWorld(true);group.traverse(o=>{if(o.isMesh)meshes.push(o);});
  for(const mesh of meshes){
    mesh.geometry.applyMatrix4(mesh.matrixWorld);fit.geometry(mesh.geometry);
    mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.set(1,1,1);group.add(mesh);mesh.updateMatrix();
  }
  for(const label of sample.labels||[])label.position=fit.point(new THREE.Vector3(...label.position)).toArray();
  for(const key of ['focus','detailFocus'])if(sample[key])sample[key]=fit.point(new THREE.Vector3(...sample[key])).toArray();
  sample.planBoundary=definition.source.map(([x,z])=>{const p=fit.point(new THREE.Vector3(x,0,z));return[p.x,p.z];});
  return sample;
}
