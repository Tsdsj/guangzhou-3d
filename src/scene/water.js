// 珠江水面：平面反射（城市倒影）+ 多层波纹法线 + 菲涅尔 + 夜间灯影拉丝 + 江水浑浊的青灰绿色。

import * as THREE from 'three';
import { U, GLSL_COMMON, FOG_APPLY, SDF_GLSL } from './atmosphere.js';
import { WATER_Y } from '../world/geo.js';
import { makeWaterNormals } from './geometries.js';

const VS = /* glsl */ `
uniform mat4 uTexMat;
varying vec3 vW; varying vec4 vR; varying vec3 vGzFogW;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vGzFogW = w.xyz;
  vR = uTexMat * w;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FS = /* glsl */ `
uniform sampler2D tRefl; uniform sampler2D tNormal; uniform float uTime;
uniform vec3 uWaterCol; uniform vec3 uDeepCol; uniform vec3 uSunColor; uniform float uNight; uniform float uRain; uniform float uReflK;
varying vec3 vW; varying vec4 vR;
varying vec3 vGzFogW;
uniform vec3 uFogColor; uniform vec3 uFogSun; uniform float uFogDensity; uniform float uFogHeight; uniform vec3 uSunDir;
${GLSL_COMMON}
${SDF_GLSL}
void main(){
  vec2 p = vW.xz;
  vec3 n1 = texture2D(tNormal, p / 110.0 + vec2(uTime * 0.010, uTime * 0.006)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tNormal, p / 36.0 + vec2(-uTime * 0.016, uTime * 0.012)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tNormal, p / 9.0 + vec2(uTime * 0.035, -uTime * 0.028)).xyz * 2.0 - 1.0;
  vec2 slope = n1.xy * 0.5 + n2.xy * 0.38 + n3.xy * 0.22;
  if (uRain > 0.5) {
    vec3 n4 = texture2D(tNormal, p / 2.2 + vec2(uTime * 0.21, uTime * 0.17)).xyz * 2.0 - 1.0;
    slope += n4.xy * 0.35;
  }
  vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
  float distK = clamp(320.0 / dist, 0.18, 1.0);
  // 珠江水面较平缓：法线扰动适度，俯视时倒影拉丝减弱，贴近水面平视时灯影拉长
  vec3 N = normalize(vec3(slope.x * 0.28 * distK, 1.0, slope.y * 0.28 * distK));
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec4 r = vR;
  float graze = 1.0 - clamp(V.y, 0.0, 1.0);
  vec2 dis = vec2(slope.x * 0.01, slope.y * 0.032) * distK * (0.25 + 0.75 * graze);
  r.xy += dis * r.w;
  vec3 refl = texture2DProj(tRefl, r).rgb;
  vec2 sd = gzSdf(p);
  float nearBank = smoothstep(-2.5, -0.2, sd.x);
  vec3 body = mix(uDeepCol, uWaterCol, 0.5 + 0.5 * gzNoise(p * 0.004 + uTime * 0.002));
  body *= mix(1.0, 0.03, uNight);
  vec3 col = mix(body, refl * uReflK, clamp(fres * 0.92 + 0.06, 0.0, 1.0));
  vec3 Hh = normalize(uSunDir + V);
  float spec = pow(max(dot(N, Hh), 0.0), 320.0) * 5.0 * (1.0 - uNight);
  col += uSunColor * spec;
  col *= mix(1.0, 0.6, nearBank);
  gl_FragColor = vec4(col, 1.0);
  ${FOG_APPLY}
}`;

export class Water {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: true });
    this.rt.texture.generateMipmaps = false;
    this.mirror = new THREE.PerspectiveCamera();
    this.texMat = new THREE.Matrix4();
    this.uniforms = {
      tRefl: { value: this.rt.texture },
      tNormal: { value: makeWaterNormals() },
      uTexMat: { value: this.texMat },
      uWaterCol: { value: new THREE.Color(0.06, 0.082, 0.064) },
      uDeepCol: { value: new THREE.Color(0.035, 0.05, 0.043) },
      uReflK: { value: 1.0 },
      uTime: U.uTime,
      uSunColor: U.uSunColor,
      uNight: U.uNight,
      uRain: U.uRain,
      uSdf: U.uSdf,
      uSdfBox: U.uSdfBox,
      uSdf2: U.uSdf2,
      uSdfBox2: U.uSdfBox2,
      uProm: U.uProm,
      uCityBox: U.uCityBox,
      uFogColor: U.uFogColor,
      uFogSun: U.uFogSun,
      uFogDensity: U.uFogDensity,
      uFogHeight: U.uFogHeight,
      uSunDir: U.uSunDir,
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, defines: { USE_FOG: '' } });
    const geo = new THREE.PlaneGeometry(90000, 90000, 1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_Y;
    this.mesh.layers.set(1);
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this._f = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this.scale = 0.5;
    this._lastCam = new THREE.Matrix4();
    this._lastProj = new THREE.Matrix4();
    this._skip = 0;
  }
  setSize(w, h) {
    this.rt.setSize(Math.max(64, Math.floor(w * this.scale)), Math.max(64, Math.floor(h * this.scale)));
  }
  update(renderer, scene, camera) {
    // 相机静止时倒影每 3 帧更新一次（只有灯光动画在变），移动时逐帧更新
    const still = this._lastCam.equals(camera.matrixWorld) && this._lastProj.equals(camera.projectionMatrix);
    this._lastCam.copy(camera.matrixWorld);
    this._lastProj.copy(camera.projectionMatrix);
    if (still && ++this._skip % 3 !== 0) return;
    const m = this.mirror;
    m.copy(camera, false);
    const p = camera.position;
    m.position.set(p.x, 2 * WATER_Y - p.y, p.z);
    this._f.set(0, 0, -1).applyQuaternion(camera.quaternion);
    this._f.y *= -1;
    this._u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    this._u.y *= -1;
    m.up.copy(this._u);
    m.lookAt(this._t.copy(m.position).add(this._f));
    m.updateMatrixWorld(true);
    // 倒影只需近中景：远裁剪面收紧到 7 km，远处楼宇不参与倒影绘制
    m.far = Math.min(camera.far, 7000 + p.y * 2);
    m.updateProjectionMatrix();
    m.layers.set(0);
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);
    const old = renderer.getRenderTarget();
    this.mesh.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, m);
    renderer.setRenderTarget(old);
    this.mesh.visible = true;
  }
}
