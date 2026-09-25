import * as THREE from '../../vendor/three/build/three.module.js';

// Presets travel around their focus rather than interpolating through the building.
export function interpolatePose(motion, progress) {
  const t=Math.max(0,Math.min(1,progress));
  const a=new THREE.Spherical().setFromVector3(motion.from.clone().sub(motion.fromTarget));
  const b=new THREE.Spherical().setFromVector3(motion.to.clone().sub(motion.toTarget));
  const delta=Math.atan2(Math.sin(b.theta-a.theta),Math.cos(b.theta-a.theta));
  const s=new THREE.Spherical(THREE.MathUtils.lerp(a.radius,b.radius,t),THREE.MathUtils.lerp(a.phi,b.phi,t),a.theta+delta*t);
  const target=motion.fromTarget.clone().lerp(motion.toTarget,t);
  return {target,position:target.clone().add(new THREE.Vector3().setFromSpherical(s))};
}
