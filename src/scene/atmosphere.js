// 大气与光照：共享 uniforms、广州（北纬 23°）太阳轨迹、湿润雾霾天空、高度雾、
// 以及给所有材质注入统一大气（雾）与世界坐标的补丁工具。

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/rng.js';

// 全场景共享的 uniforms（按引用共享，改一次所有材质生效）
export const U = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uDusk: { value: 0 },
  uLights: { value: 1 },
  uLitAmt: { value: 0.5 },
  uStreetOn: { value: 0 },
  uTowerOn: { value: 0 },
  uWet: { value: 0 },
  uRain: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
  uSunColor: { value: new THREE.Color(1, 0.95, 0.9) },
  uFogColor: { value: new THREE.Color(0.7, 0.72, 0.74) },
  uFogSun: { value: new THREE.Color(0.9, 0.8, 0.7) },
  uFogDensity: { value: 0.0004 },
  uFogHeight: { value: 1 / 190 },
  uSdf: { value: null },
  uSdfBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  uSdf2: { value: null },
  uSdfBox2: { value: new THREE.Vector4(0, 0, 1, 1) },
  uProm: { value: 16 },
  uCityBox: { value: new THREE.Vector4(-8000, -4000, 8000, 4000) },
  // 树木 LOD：x = 低模 / 公告板切换距离，y = 公告板最远距离（之外已被雾吞没）
  uTreeLod: { value: new THREE.Vector2(900, 12000) },
  // 每像素对应的视角弧度（公告板上细树干保持至少约 1 像素宽，避免闪烁）
  uPxAng: { value: 0.0006 },
  uDetailRoadBoxes: { value: [new THREE.Vector4(),new THREE.Vector4()] },
  uDetailRoadActive: { value: new THREE.Vector2() },
};

// 两级水域距离场：内圈高精度纹理之外回退到外圈低精度纹理
export const SDF_GLSL = /* glsl */ `
uniform sampler2D uSdf; uniform vec4 uSdfBox; uniform sampler2D uSdf2; uniform vec4 uSdfBox2; uniform float uProm; uniform vec4 uCityBox;
vec2 gzSdf(vec2 p){
  vec2 uv = (p - uSdfBox.xy) * uSdfBox.zw;
  vec2 a = texture2D(uSdf, uv).rg;
  vec2 b = texture2D(uSdf2, (p - uSdfBox2.xy) * uSdfBox2.zw).rg;
  float inside = step(0.003, uv.x) * step(0.003, uv.y) * step(uv.x, 0.997) * step(uv.y, 0.997);
  return (mix(b, a, inside) * 255.0 - 128.0) / 1.5;
}
`;

// ---------- GLSL 公共片段 ----------
export const GLSL_COMMON = /* glsl */ `
float gzH21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float gzH31(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float gzNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  float a = gzH21(i), b = gzH21(i+vec2(1.0,0.0)), c = gzH21(i+vec2(0.0,1.0)), d = gzH21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float gzFbm(vec2 p){ float s = 0.0; float a = 0.5; for(int i=0;i<4;i++){ s += a*gzNoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
vec3 gzHsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h*6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
`;

const FOG_PARS_V = /* glsl */ `
#ifdef USE_FOG
varying vec3 vGzFogW;
#endif
`;
const FOG_V = /* glsl */ `
#ifdef USE_FOG
  vec4 gzFogP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    gzFogP = instanceMatrix * gzFogP;
  #endif
  vGzFogW = (modelMatrix * gzFogP).xyz;
#endif
`;
const FOG_PARS_F = /* glsl */ `
#ifdef USE_FOG
varying vec3 vGzFogW;
uniform vec3 uFogColor; uniform vec3 uFogSun; uniform float uFogDensity; uniform float uFogHeight; uniform vec3 uSunDir;
#endif
`;
// 高度指数雾：近地面浓、高空淡；朝太阳方向带暖色散射
export const FOG_APPLY = /* glsl */ `
#ifdef USE_FOG
{
  vec3 fr = vGzFogW - cameraPosition;
  float fd = length(fr);
  vec3 fdir = fr / max(fd, 1e-3);
  float y0 = max(cameraPosition.y, 0.0);
  float y1 = max(vGzFogW.y, 0.0);
  float hb = uFogHeight;
  float dy = y1 - y0;
  float dens = abs(dy) > 0.5 ? (exp(-hb*y0) - exp(-hb*y1)) / (hb*dy) : exp(-hb*y0);
  float fa = 1.0 - exp(-uFogDensity * fd * max(dens, 0.0));
  fa = max(fa, 1.0 - exp(-uFogDensity * 0.12 * fd));
  fa = max(fa, smoothstep(3500.0 + y0 * 1.2, 11000.0 + y0 * 1.8, fd) * 0.92);
  #ifdef GZ_FOG_CAP
  // 远山：保留一点轮廓（大气透视中的淡淡山影）
  fa = min(fa, GZ_FOG_CAP);
  #endif
  float sa = pow(max(dot(fdir, uSunDir), 0.0), 6.0);
  vec3 fc = mix(uFogColor, uFogSun, sa);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(fa, 0.0, 1.0));
}
#endif
`;

// 两级阴影：directionalLights[0] 为太阳（远级阴影覆盖整个视野），[1] 为强度为 0 的近级阴影光源（只提供
// 相机附近高精度的阴影贴图）。平行光光照只算太阳一次，阴影在近级范围内取近级贴图，边缘处与远级平滑过渡。
const DIR_LIGHTS_SRC = THREE.ShaderChunk.lights_fragment_begin.slice(
  THREE.ShaderChunk.lights_fragment_begin.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'),
  THREE.ShaderChunk.lights_fragment_begin.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )'),
);
const DIR_LIGHTS_CASCADE = /* glsl */ `
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
{
  DirectionalLight directionalLight = directionalLights[ 0 ];
  getDirectionalLightInfo( directionalLight, directLight );
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
  {
    DirectionalLightShadow gzF = directionalLightShadows[ 0 ];
    DirectionalLightShadow gzNs = directionalLightShadows[ 1 ];
    vec3 gzN = vDirectionalShadowCoord[ 1 ].xyz / vDirectionalShadowCoord[ 1 ].w;
    float gzE = min( min( gzN.x, 1.0 - gzN.x ), min( gzN.y, 1.0 - gzN.y ) );
    float gzK = gzN.z <= 1.0 ? smoothstep( 0.0, 0.08, gzE ) : 0.0;
    // 近级范围内只采近级贴图，过渡带两张都采，其余只采远级
    float gzS = gzK < 1.0 ? getShadow( directionalShadowMap[ 0 ], gzF.shadowMapSize, gzF.shadowIntensity, gzF.shadowBias, gzF.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
    if ( gzK > 0.0 ) {
      float gzSN = getShadow( directionalShadowMap[ 1 ], gzNs.shadowMapSize, gzNs.shadowIntensity, gzNs.shadowBias, gzNs.shadowRadius, vDirectionalShadowCoord[ 1 ] );
      gzS = mix( gzS, gzSN, gzK );
    }
    directLight.color *= ( directLight.visible && receiveShadow ) ? gzS : 1.0;
  }
  #elif defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  {
    DirectionalLightShadow gzF = directionalLightShadows[ 0 ];
    directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ 0 ], gzF.shadowMapSize, gzF.shadowIntensity, gzF.shadowBias, gzF.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
  }
  #endif
  RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
#endif
`;
const LIGHTS_FRAGMENT = THREE.ShaderChunk.lights_fragment_begin.replace(DIR_LIGHTS_SRC, DIR_LIGHTS_CASCADE);

/**
 * 统一材质补丁：注入共享 uniforms、公共 GLSL、高度雾、两级阴影，并按需做字符串替换。
 * opts: { uniforms, vPars, vMain (追加到 fog_vertex 之后), fPars, replace: [[chunk, code, 'before'|'after'|'replace']], key }
 */
export function patchMaterial(mat, opts = {}) {
  const extraU = opts.uniforms || {};
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U, extraU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${opts.vPars || ''}`)
      .replace('#include <fog_pars_vertex>', FOG_PARS_V)
      .replace('#include <fog_vertex>', `${FOG_V}\n${opts.vMain || ''}`);
    for (const [chunk, code, mode] of opts.vReplace || []) {
      const tag = `#include <${chunk}>`;
      shader.vertexShader = shader.vertexShader.replace(tag, mode === 'replace' ? code : mode === 'before' ? `${code}\n${tag}` : `${tag}\n${code}`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${opts.fPars || ''}`)
      .replace('#include <fog_pars_fragment>', FOG_PARS_F)
      .replace('#include <fog_fragment>', FOG_APPLY)
      .replace('#include <lights_fragment_begin>', LIGHTS_FRAGMENT);
    for (const [chunk, code, mode] of opts.replace || []) {
      const tag = `#include <${chunk}>`;
      shader.fragmentShader = shader.fragmentShader.replace(tag, mode === 'replace' ? code : mode === 'before' ? `${code}\n${tag}` : `${tag}\n${code}`);
    }
  };
  mat.customProgramCacheKey = () => `gz-${opts.key || mat.type}`;
  mat.fog = true;
  return mat;
}

// ---------- 天空穹顶 ----------
const SKY_V = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_F = /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGroundCol; uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform vec3 uMoonDir; uniform vec3 uHazeCol; uniform vec3 uGlowCol; uniform vec3 uCloudCol;
uniform float uNight; uniform float uHaze; uniform float uTime; uniform float uSunVis; uniform float uCloud;
varying vec3 vDir;
${GLSL_COMMON}
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float hz = pow(1.0 - clamp(y, 0.0, 1.0), 3.2);
  vec3 col = mix(uZenith, uHorizon, hz);
  float sd = max(dot(d, uSunDir), 0.0);
  // 太阳光晕与日轮（雾霾中日轮变柔）
  col += uSunColor * (0.10 * pow(sd, 5.0) + 0.45 * pow(sd, 48.0)) * uSunVis;
  col += uSunColor * smoothstep(0.99955, 0.99978, sd) * 24.0 * uSunVis * (1.0 - uHaze * 0.75);
  // 云层
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.004, uTime * 0.0017);
    float c = gzFbm(cp * 1.3);
    c = smoothstep(0.52 - uCloud * 0.3, 0.9, c) * uCloud * smoothstep(0.0, 0.18, y);
    vec3 cc = uCloudCol * (0.75 + 0.5 * pow(sd, 3.0));
    col = mix(col, cc, c * 0.85);
    // 星空（夜间，薄雾时少）
    vec3 sp = floor(d * 520.0);
    float st = gzH31(sp);
    col += vec3(0.9, 0.95, 1.0) * step(0.9987, st) * uNight * (1.0 - uHaze) * (1.0 - c) * smoothstep(0.06, 0.35, y) * 1.4;
  }
  // 月亮
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(1.0, 0.97, 0.9) * smoothstep(0.99962, 0.9998, md) * 2.6 * uNight;
  col += vec3(0.18, 0.22, 0.3) * pow(md, 40.0) * 0.5 * uNight;
  // 城市夜空光污染：地平线附近的暖橙光晕
  col += uGlowCol * exp(-max(y, 0.0) * 8.0) * uNight;
  // 地平线雾带
  col = mix(col, uHazeCol, clamp(uHaze * exp(-max(y, 0.0) * 6.0) * 0.95, 0.0, 1.0));
  col = mix(col, uGroundCol, smoothstep(0.0, -0.06, y));
  gl_FragColor = vec4(col, 1.0);
}`;

export class Atmosphere {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.skyU = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGroundCol: { value: new THREE.Color() },
      uSunDir: U.uSunDir,
      uSunColor: U.uSunColor,
      uMoonDir: { value: new THREE.Vector3(-0.45, 0.62, 0.64).normalize() },
      uHazeCol: { value: new THREE.Color() },
      uGlowCol: { value: new THREE.Color() },
      uCloudCol: { value: new THREE.Color() },
      uNight: U.uNight,
      uHaze: { value: 0.4 },
      uTime: U.uTime,
      uSunVis: { value: 1 },
      uCloud: { value: 0.4 },
    };
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false, fog: false });
    const skyGeo = new THREE.SphereGeometry(1, 48, 24);
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.scale.setScalar(40000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    // 环境贴图场景
    this.envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(skyGeo, skyMat);
    envSky.scale.setScalar(100);
    this.envScene.add(envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envDirty = true;
    this.lastEnv = 0;

    // 两级阴影（见 DIR_LIGHTS_CASCADE）：远级覆盖视野中心，近级覆盖相机前方；贴图按需分帧更新
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.9;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 9000;
    this.sun.shadow.autoUpdate = false;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.sunNear = new THREE.DirectionalLight(0xffffff, 0);
    this.sunNear.castShadow = true;
    this.sunNear.shadow.mapSize.set(2048, 2048);
    this.sunNear.shadow.bias = -0.0003;
    this.sunNear.shadow.normalBias = 0.35;
    this.sunNear.shadow.autoUpdate = false;
    scene.add(this.sunNear);
    scene.add(this.sunNear.target);
    this.nearCenter = new THREE.Vector3();
    this.nearRadius = 400;
    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x6b604f, 0.9);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xcccccc, 0.0004); // 仅用于启用 USE_FOG，实际雾计算由补丁完成
    this.state = {};
    this.cityRadius = 2000;
    this.cityCenter = new THREE.Vector3();
  }

  // 由参数计算天空、太阳与雾
  apply(P) {
    const t = P.timeOfDay;
    const DEG = Math.PI / 180;
    const lat = 23.13 * DEG;
    const decl = 12 * DEG;
    const Hang = (t - 12.4) * 15 * DEG;
    const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(Hang);
    const el = Math.asin(sinEl);
    let cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / (Math.cos(el) * Math.cos(lat));
    let az = Math.acos(clamp(cosAz, -1, 1));
    if (Hang > 0) az = 2 * Math.PI - az;
    const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const elDeg = el / DEG;
    const night = 1 - smoothstep(-0.12, 0.1, sinEl);
    const dusk = Math.exp(-(((elDeg - 1.5) / 7.5) ** 2));
    const haze = P.haze / 100;
    const wx = P.weather;
    const wet = wx === 'rain' ? 1 : wx === 'huinan' ? 0.75 : 0;

    // 天空关键帧（线性空间）
    const K = [
      [-18, [0.004, 0.006, 0.014], [0.03, 0.026, 0.032]],
      [-8, [0.012, 0.02, 0.05], [0.1, 0.075, 0.09]],
      [-2.5, [0.05, 0.08, 0.18], [0.42, 0.26, 0.24]],
      [2.5, [0.15, 0.22, 0.42], [0.95, 0.5, 0.28]],
      [9, [0.2, 0.33, 0.62], [0.95, 0.72, 0.52]],
      [22, [0.19, 0.37, 0.73], [0.66, 0.74, 0.84]],
      [60, [0.17, 0.35, 0.75], [0.62, 0.72, 0.84]],
    ];
    let zen = K[0][1];
    let hor = K[0][2];
    for (let i = 0; i < K.length - 1; i++) {
      if (elDeg >= K[i][0] && elDeg <= K[i + 1][0]) {
        const f = smoothstep(K[i][0], K[i + 1][0], elDeg);
        zen = K[i][1].map((v, k) => lerp(v, K[i + 1][1][k], f));
        hor = K[i][2].map((v, k) => lerp(v, K[i + 1][2][k], f));
        break;
      }
      if (elDeg > K[K.length - 1][0]) {
        zen = K[K.length - 1][1];
        hor = K[K.length - 1][2];
      }
    }
    const dayLum = 0.03 + 0.97 * (1 - night);
    // 湿润空气：地平线泛白、天顶去饱和
    const humid = wx === 'clear' ? 0.25 : wx === 'humid' ? 0.6 : 1;
    const grey = (c, k, lum) => {
      const l = (c[0] + c[1] + c[2]) / 3;
      return c.map((v) => lerp(v, l * lum, k));
    };
    zen = grey(zen, haze * 0.3 * humid, 1.02);
    hor = grey(hor, haze * 0.38 * humid, 1.04);
    if (wx === 'rain') {
      const ov = [0.36, 0.39, 0.42].map((v) => v * dayLum);
      zen = zen.map((v, k) => lerp(v, ov[k] * 0.85, 0.85));
      hor = hor.map((v, k) => lerp(v, ov[k], 0.85));
    } else if (wx === 'huinan') {
      const ov = [0.62, 0.64, 0.64].map((v) => v * dayLum);
      zen = zen.map((v, k) => lerp(v, ov[k] * 0.9, 0.75));
      hor = hor.map((v, k) => lerp(v, ov[k], 0.85));
    }
    const lights = P.lightIntensity / 100;
    const glow = [0.13, 0.075, 0.04].map((v) => v * lights * (0.6 + haze));
    const S = this.skyU;
    S.uZenith.value.setRGB(zen[0], zen[1], zen[2]);
    S.uHorizon.value.setRGB(hor[0], hor[1], hor[2]);
    S.uGlowCol.value.setRGB(glow[0], glow[1], glow[2]);
    const hazeCol = hor.map((v, k) => v * 0.96 + glow[k] * night * 0.5);
    S.uHazeCol.value.setRGB(hazeCol[0], hazeCol[1], hazeCol[2]);
    S.uGroundCol.value.setRGB(hazeCol[0] * 0.8, hazeCol[1] * 0.8, hazeCol[2] * 0.8);
    S.uHaze.value = clamp(0.15 + haze * 0.55 + (wx === 'huinan' ? 0.25 : wx === 'rain' ? 0.15 : 0), 0, 1);
    S.uCloud.value = wx === 'rain' ? 0.95 : wx === 'huinan' ? 0.8 : wx === 'clear' ? 0.25 : 0.5;
    const cloudDay = [0.92, 0.9, 0.88].map((v, k) => lerp(v * dayLum, hor[k], 0.35));
    const cloudCol = wx === 'rain' ? zen.map((v) => v * 1.1) : cloudDay.map((v, k) => v + glow[k] * night * 1.5);
    S.uCloudCol.value.setRGB(cloudCol[0], cloudCol[1], cloudCol[2]);

    // 太阳
    const sunVis = smoothstep(-0.03, 0.06, sinEl) * (wx === 'rain' ? 0.12 : wx === 'huinan' ? 0.3 : 1);
    S.uSunVis.value = sunVis;
    const warm = smoothstep(0.0, 0.5, sinEl);
    const sc = [1.0, lerp(0.5, 0.94, warm), lerp(0.26, 0.86, warm)];
    U.uSunColor.value.setRGB(sc[0], sc[1], sc[2]);
    U.uSunDir.value.copy(sunDir);
    const wxLight = wx === 'clear' ? 1 : wx === 'humid' ? 0.86 : wx === 'rain' ? 0.25 : 0.34;
    const sunI = 3.8 * smoothstep(-0.02, 0.2, sinEl) * wxLight * (1 - haze * 0.22);
    const moonI = 0.16 * night;
    if (sunI > moonI) {
      this.sun.color.setRGB(sc[0], sc[1], sc[2]);
      this.sun.intensity = sunI;
      this.lightDir = sunDir.clone();
    } else {
      this.sun.color.setRGB(0.6, 0.7, 1.0);
      this.sun.intensity = moonI;
      this.lightDir = S.uMoonDir.value.clone();
    }
    // 天光
    const hemiSky = zen.map((v, k) => lerp(v, hor[k], 0.4));
    this.hemi.color.setRGB(hemiSky[0], hemiSky[1], hemiSky[2]).multiplyScalar(1 / Math.max(0.05, Math.max(...hemiSky)));
    this.hemi.groundColor.setRGB(0.42, 0.38, 0.33).lerp(new THREE.Color(0.5, 0.3, 0.16), night);
    this.hemi.intensity = lerp(0.05 + 0.08 * lights, 0.82, 1 - night) * (wx === 'rain' ? 1.35 : wx === 'huinan' ? 1.25 : 1);

    // 雾
    const wxFog = wx === 'clear' ? 0.55 : wx === 'humid' ? 1 : wx === 'rain' ? 1.7 : 2.6;
    U.uFogDensity.value = lerp(0.000015, 0.00062, Math.pow(haze, 1.5)) * wxFog + 0.00001;
    const fogCol = hor.map((v, k) => v * lerp(0.78, 0.62, night) + glow[k] * night * 0.3);
    U.uFogColor.value.setRGB(fogCol[0], fogCol[1], fogCol[2]);
    const fs = fogCol.map((v, k) => v + sc[k] * 0.22 * sunVis * (0.4 + dusk));
    U.uFogSun.value.setRGB(fs[0], fs[1], fs[2]);

    // 夜景
    U.uNight.value = night;
    U.uDusk.value = dusk;
    U.uLights.value = lights;
    const hour = t;
    const evening = hour >= 17 || hour < 1 ? 1 : hour < 5 ? 0.35 : hour < 8 ? 0.6 : 0.5;
    U.uLitAmt.value = clamp(evening * (0.3 + 0.42 * night), 0, 1);
    U.uStreetOn.value = smoothstep(0.12, 0.45, night);
    U.uTowerOn.value = smoothstep(0.18, 0.5, night);
    U.uWet.value = wet;
    U.uRain.value = wx === 'rain' ? 1 : 0;

    this.state = { night, dusk, haze, sinEl, wx, lights, exposure: P.exposure / 100 };
    this.envDirty = true;
  }

  updateSunShadow() {
    this.placeShadow(this.sun, this.cityCenter, this.cityRadius);
  }
  updateNearShadow() {
    this.placeShadow(this.sunNear, this.nearCenter, this.nearRadius);
  }
  // 阴影相机中心按贴图像素对齐（光源空间取整），相机移动后阴影边缘不会抖动
  placeShadow(light, center, r) {
    const d = this.lightDir || U.uSunDir.value;
    const dir = d.clone();
    if (dir.y < 0.08) dir.y = 0.08;
    dir.normalize();
    const ext = r * 1.02;
    const texel = (2 * ext) / light.shadow.mapSize.x;
    const right = new THREE.Vector3(0, 1, 0).cross(dir);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = dir.clone().cross(right);
    const c = new THREE.Vector3()
      .addScaledVector(right, Math.round(center.dot(right) / texel) * texel)
      .addScaledVector(up, Math.round(center.dot(up) / texel) * texel)
      .addScaledVector(dir, center.dot(dir));
    light.position.copy(c).addScaledVector(dir, 4000);
    light.target.position.copy(c);
    const cam = light.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 100;
    cam.far = 8000 + (this.maxH || 600) * 2;
    cam.updateProjectionMatrix();
  }

  updateEnv(now) {
    if (!this.envDirty || now - this.lastEnv < 120) return;
    this.envDirty = false;
    this.lastEnv = now;
    const old = this.envRT;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 1000, { size: 128 });
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = lerp(0.12, 1.0, 1 - this.state.night) * (this.state.wx === 'rain' ? 0.8 : 1);
    if (old) old.dispose();
  }
}
