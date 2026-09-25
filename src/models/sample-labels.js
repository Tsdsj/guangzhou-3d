import * as THREE from '../../vendor/three/build/three.module.js';

export function createSampleLabel(label,{lit=false}={}){
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=128;
  const c=canvas.getContext('2d');c.clearRect(0,0,768,128);c.fillStyle=label.color;
  c.textAlign='center';c.textBaseline='middle';c.font='48px Georgia, "Songti SC", serif';
  const size=Math.min(96,48*740/Math.max(1,c.measureText(label.text).width));
  c.font=`${size}px Georgia, "Songti SC", serif`;c.fillText(label.text,384,64,740);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const options={map:texture,transparent:true,depthWrite:false};
  const material=lit?new THREE.MeshStandardMaterial({...options,roughness:.9}):new THREE.MeshBasicMaterial(options);
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(label.width,label.height),material);
  mesh.position.set(...label.position);if(label.flat)mesh.rotation.x=-Math.PI/2;
  mesh.receiveShadow=lit;mesh.userData={detail:true,evidence:'reference',label:true};return mesh;
}
