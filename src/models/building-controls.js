import * as THREE from '../../vendor/three/build/three.module.js';

// A reported eave elevation constrains one model landmark; it is not total height.
export function applyVerticalControl(sample,control){
  const nominal=sample.landmarks?.[control?.landmark];
  if(control?.landmark!=='eave'||!Number.isFinite(nominal)||nominal<=0||!Number.isFinite(control.value)||control.value<=0||control.unit!=='m'||control.status!=='reported'||!control.sourceId||!Array.isArray(control.pages)||!control.pages.length||!control.pages.every(n=>Number.isInteger(n)&&n>0))throw new Error('Invalid building vertical control or landmark');
  const scale=control.value/nominal,group=sample.group,meshes=[];
  group.updateMatrixWorld(true);group.traverse(o=>{if(o.isMesh)meshes.push(o);});
  const rootInverse=group.matrixWorld.clone().invert();
  for(const mesh of meshes){
    const localToRoot=new THREE.Matrix4().multiplyMatrices(rootInverse,mesh.matrixWorld);
    mesh.geometry.applyMatrix4(localToRoot);mesh.geometry.scale(1,scale,1);mesh.geometry.applyMatrix4(localToRoot.invert());
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
  }
  for(const label of sample.labels||[])label.position[1]*=scale;
  for(const key of ['focus','detailFocus'])if(sample[key])sample[key][1]*=scale;
  sample.height*=scale;
  for(const key of Object.keys(sample.landmarks))sample.landmarks[key]*=scale;
  sample.landmarks[control.landmark]=control.value;
  sample.heightReference={...control,nominalModelY:nominal,scale};
  return sample;
}
