// 后期（pmndrs/postprocessing + N8AO）：
// HDR 渲染 → N8AO 环境光遮蔽（楼宇接地、街巷与檐下的接触阴影）→ SMAA 抗锯齿 → 多级 mipmap 泛光
// → 曝光 / 湿润暖调 → Khronos PBR Neutral 色调映射（保色相、高光平滑滚降，夜景灯光不刺眼）→ 饱和度 / 对比度 → 暗角。

import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, BloomEffect, SMAAEffect, SMAAPreset,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { clamp, lerp } from '../core/rng.js';

// 色调映射前：曝光 + 冷暖色偏
class ExposureEffect extends Effect {
  constructor() {
    super(
      'GzExposure',
      /* glsl */ `uniform float uExposure; uniform vec3 uTint;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){ outputColor = vec4(inputColor.rgb * uExposure * uTint, inputColor.a); }`,
      { uniforms: new Map([['uExposure', new THREE.Uniform(1)], ['uTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))]]) },
    );
  }
}

// 色调映射后：饱和度、对比度、轻微的暗部提亮（湿润空气的散射感）
class GradeEffect extends Effect {
  constructor() {
    super(
      'GzGrade',
      /* glsl */ `uniform float uSat; uniform float uContrast; uniform float uLift;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSat);
        vec3 s = pow(max(c, 0.0), vec3(1.0 / 2.2));
        s = (s - 0.5) * uContrast + 0.5 + uLift * (1.0 - s);
        c = pow(clamp(s, 0.0, 1.0), vec3(2.2));
        outputColor = vec4(c, inputColor.a);
      }`,
      { uniforms: new Map([['uSat', new THREE.Uniform(1)], ['uContrast', new THREE.Uniform(1)], ['uLift', new THREE.Uniform(0)]]) },
    );
  }
}

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
    const C = this.ao.configuration;
    C.aoRadius = 6;
    C.distanceFalloff = 1.0;
    C.intensity = 2.2;
    C.color = new THREE.Color(0x0b0a0a);
    C.halfRes = true;
    C.depthAwareUpsampling = true;
    C.transparencyAware = false;
    C.gammaCorrection = false;
    this.ao.setQualityMode('Low');
    this.composer.addPass(this.ao);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.bloom = new BloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, luminanceThreshold: 1.1, luminanceSmoothing: 0.35, intensity: 0.5, radius: 0.62, levels: 7 });
    this.exposure = new ExposureEffect();
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ offset: 0.38, darkness: 0.42 });
    this.effects = new EffectPass(camera, this.smaa, this.bloom, this.exposure, this.tone, this.grade, this.vignette);
    this.effects.dithering = true;
    this.composer.addPass(this.effects);
    this.aoOn = true;
  }
  setSize(w, h) {
    this.composer.setSize(w, h, false);
  }
  setAO(on) {
    this.aoOn = on;
    this.ao.enabled = on;
  }
  // 画质档位：0 全效果；1 SMAA 降为中档；2 再减少泛光层级并关闭 AO（尺寸变化由随后的 setSize 生效）
  setTier(t) {
    this.smaa.applyPreset(t >= 1 ? SMAAPreset.MEDIUM : SMAAPreset.HIGH);
    this.bloom.mipmapBlurPass.levels = t >= 2 ? 5 : 7;
    this.setAO(t < 2);
  }
  apply(state) {
    const n = state.night;
    const wet = state.wx === 'rain' || state.wx === 'huinan';
    // 夜间只让真正的强光源（广州塔、灯带、车灯、招牌）起辉光，窗灯只带一层柔和的光晕
    this.bloom.intensity = lerp(0.22, 0.62, n) + (wet ? 0.1 : 0);
    this.bloom.luminanceMaterial.threshold = lerp(1.6, 0.95, n);
    this.bloom.luminanceMaterial.smoothing = lerp(0.25, 0.45, n);
    this.bloom.mipmapBlurPass.radius = lerp(0.55, 0.7, n) + (wet ? 0.08 : 0);
    this.exposure.uniforms.get('uExposure').value = state.exposure * lerp(1.08, 1.18, n);
    // 湿润暖调：白天略带暖黄，夜间偏暖橙
    this.exposure.uniforms.get('uTint').value.set(1.02 + 0.03 * n, 1.0, 0.97 - 0.05 * n);
    const G = this.grade.uniforms;
    G.get('uSat').value = state.wx === 'huinan' ? 0.9 : state.wx === 'rain' ? 0.94 : 1.1 - state.haze * 0.1;
    G.get('uContrast').value = state.wx === 'huinan' ? 0.98 : 1.08 - state.haze * 0.05;
    G.get('uLift').value = 0.012 + state.haze * 0.012;
    this.vignette.darkness = lerp(0.36, 0.5, n);
    // 夜间 AO 以接触阴影为主，减弱强度避免灯光区域发脏
    this.ao.configuration.intensity = lerp(2.2, 1.5, n);
  }
  // 按相机高度调整 AO：街景看檐下与墙角，中空看楼宇之间的遮蔽；高空俯视时 AO 几乎不可见，关闭以节省开销
  update(camera, target) {
    if (!this.aoOn) return;
    const h = Math.max(1, camera.position.y);
    const d = camera.position.distanceTo(target);
    const on = h < 1400;
    if (this.ao.enabled !== on) this.ao.enabled = on;
    this.ao.configuration.aoRadius = clamp(Math.min(h, d) * 0.012, 1.6, 16);
  }
  render(dt) {
    this.composer.render(dt);
  }
}
