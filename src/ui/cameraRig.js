// 镜头：OrbitControls（旋转 / 平移 / 缩放）+ 预设视角平滑飞行 + 电影漫游路径 + 环绕巡航。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    const c = (this.controls = new OrbitControls(camera, dom));
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.screenSpacePanning = false;
    // 允许略微仰视（街景仰望高楼），相机本身由主循环限制在地面以上
    c.maxPolarAngle = Math.PI * 0.56;
    c.minDistance = 4;
    c.maxDistance = 16000;
    c.zoomToCursor = true;
    c.rotateSpeed = 0.55;
    c.panSpeed = 1.0;
    c.zoomSpeed = 1.15;
    c.autoRotateSpeed = 0.35;
    c.addEventListener('start', () => {
      if (this.tween || this.cine || c.autoRotate) this.onInterrupt?.();
      this.tween = null;
      this.cine = null;
      c.autoRotate = false;
    });
    this.tween = null;
    this.cine = null;
    this._p = new THREE.Vector3();
    this._q = new THREE.Vector3();
  }
  flyTo(pos, target, dur = 1.9, after = null) {
    this.cine = null;
    this.controls.autoRotate = false;
    const d = this.camera.position.distanceTo(pos);
    this.tween = { t: 0, dur: dur * Math.min(1.25, 0.7 + d / 4000), p0: this.camera.position.clone(), p1: pos.clone(), q0: this.controls.target.clone(), q1: target.clone(), lift: Math.min(900, d * 0.18), after };
  }
  orbit(target, pos) {
    this.flyTo(pos, target, 1.6, () => {
      this.controls.autoRotate = true;
    });
  }
  cinematic(points, looks, duration) {
    this.tween = null;
    this.controls.autoRotate = false;
    this.cine = { t: 0, duration, path: new THREE.CatmullRomCurve3(points, true, 'centripetal'), look: new THREE.CatmullRomCurve3(looks, true, 'centripetal') };
  }
  get busy() {
    return !!(this.tween || this.cine);
  }
  update(dt) {
    const c = this.controls;
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const k = ease(Math.min(1, tw.t / tw.dur));
      this._p.lerpVectors(tw.p0, tw.p1, k);
      this._p.y += Math.sin(Math.PI * k) * tw.lift;
      this._q.lerpVectors(tw.q0, tw.q1, k);
      this.camera.position.copy(this._p);
      c.target.copy(this._q);
      if (k >= 1) {
        this.tween = null;
        tw.after?.();
      }
    } else if (this.cine) {
      const cn = this.cine;
      cn.t = (cn.t + dt / cn.duration) % 1;
      cn.path.getPointAt(cn.t, this._p);
      cn.look.getPointAt(cn.t, this._q);
      this.camera.position.copy(this._p);
      c.target.copy(this._q);
    }
    c.update(dt);
    if (c.target.y < 0) c.target.y = 0;
    if (this.camera.position.y < 1.4) this.camera.position.y = 1.4;
  }
}
