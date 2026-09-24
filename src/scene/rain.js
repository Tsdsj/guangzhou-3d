// 阵雨：围绕相机循环的三维雨丝（顶点着色器驱动，随风略斜），配合湿润地面与江面雨点。

import * as THREE from 'three';
import { U } from './atmosphere.js';

export class Rain {
  constructor() {
    const N = 12000;
    const base = new THREE.PlaneGeometry(0.03, 1.5);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const off = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) {
      off[i * 4] = Math.random() * 160;
      off[i * 4 + 1] = Math.random() * 90;
      off[i * 4 + 2] = Math.random() * 160;
      off[i * 4 + 3] = Math.random();
    }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    g.instanceCount = N;
    this.uniforms = {
      uTime: U.uTime,
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(160, 90, 160) },
      uAmt: { value: 0 },
      uNight: U.uNight,
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aOff; uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; varying float vA; varying vec2 vUv;
        void main(){
          vec3 p = aOff.xyz;
          p.y -= uTime * (24.0 + aOff.w * 9.0);
          p.x += uTime * 2.5;
          vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 wp = uCam + rel;
          vec3 toCam = normalize(vec3(uCam.x - wp.x, 0.0, uCam.z - wp.z) + vec3(1e-4));
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 pos = wp + right * position.x + vec3(0.1, 1.0, 0.0) * position.y * (0.8 + aOff.w * 0.6);
          vA = (1.0 - smoothstep(uBox.x * 0.18, uBox.x * 0.5, length(rel.xz))) * (0.4 + 0.6 * aOff.w);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAmt; uniform float uNight; varying float vA; varying vec2 vUv;
        void main(){
          float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
          vec3 c = mix(vec3(0.62, 0.66, 0.7), vec3(0.5, 0.42, 0.34), uNight);
          gl_FragColor = vec4(c, a * vA * 0.32 * uAmt);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(1);
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
  }
  update(camera, amt) {
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uAmt.value = amt;
    this.mesh.visible = amt > 0.01;
  }
}
