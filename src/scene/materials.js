// 材质库：程序化立面、地面、道路、江堤、植被、灯具等，全部基于 MeshStandardMaterial + 着色器补丁，
// 统一接入共享大气（高度雾、昼夜、灯光强度）。

import * as THREE from 'three';
import { U, patchMaterial, SDF_GLSL } from './atmosphere.js';

// ============ 建筑立面 ============
const FACADE_VPARS = /* glsl */ `
#ifdef GZ_MERGED
// 合并网格（真实建筑轮廓）：每顶点带墙面坐标 aWall = (沿周长 u, 墙段内 t, 墙段长 L)，
// aBid = 建筑编号 + 立面风格覆盖 × 32768；建筑参数存放在数据纹理 uBTex（每栋 4 个纹素）
attribute vec3 aWall;
attribute float aBid;
uniform highp sampler2D uBTex;
#else
attribute vec4 aFaceU;
attribute vec4 aFA;
attribute vec4 aFB;
attribute vec3 aColA;
attribute vec3 aColB;
#endif
varying vec4 vFA; varying vec4 vFB; varying vec3 vColA; varying vec3 vColB; varying vec4 vFaceU;
varying vec3 vLocal; varying vec3 vScale; varying vec3 vWNorm; varying float vU;
// 世界坐标与高度雾共用同一个 varying（减少逐顶点输出）
#define vWPos vGzFogW
`;
const FACADE_VMAIN = /* glsl */ `
#ifdef GZ_MERGED
{
  float bidF = floor(aBid + 0.5);
  float stO = floor(bidF / 32768.0);
  int id = int(bidF - stO * 32768.0) * 4;
  vec4 t0 = texelFetch(uBTex, ivec2(id % 2048, id / 2048), 0);
  vec4 t1 = texelFetch(uBTex, ivec2((id + 1) % 2048, (id + 1) / 2048), 0);
  vec4 t2 = texelFetch(uBTex, ivec2((id + 2) % 2048, (id + 2) / 2048), 0);
  vec4 t3 = texelFetch(uBTex, ivec2((id + 3) % 2048, (id + 3) / 2048), 0);
  vFA = t0; vFB = t1; vColA = t2.rgb; vColB = t3.rgb;
  if (stO > 0.5) vFA.x = stO;
  float base = t2.a;
  float top = t3.a;
  vec4 fw = modelMatrix * vec4(position, 1.0);
  vWPos = fw.xyz;
  vWNorm = normalize(mat3(modelMatrix) * normal);
  vU = aWall.x;
  vLocal = vec3(aWall.y - 0.5, (position.y - base) / max(top - base, 0.1), 0.0);
  vScale = vec3(aWall.z, top - base, 1e4);
  vFaceU = vec4(1.0, 0.0, 0.0, 0.0);
}
#else
{
  mat4 im = instanceMatrix;
  vec3 iS = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
  vScale = iS;
  vLocal = position;
  vec4 fw = modelMatrix * im * vec4(position, 1.0);
  vWPos = fw.xyz;
  vWNorm = normalize(mat3(modelMatrix) * (mat3(im) * (normal / (iS * iS))));
  float ang = atan(position.z, position.x);
  vU = aFaceU.x * position.x * iS.x + aFaceU.y * position.z * iS.z + aFaceU.z * ang * 0.25 * (iS.x + iS.z) + aFaceU.w;
  vFA = aFA; vFB = aFB; vColA = aColA; vColB = aColB; vFaceU = aFaceU;
}
#endif
`;
const FACADE_FPARS = /* glsl */ `
varying vec4 vFA; varying vec4 vFB; varying vec3 vColA; varying vec3 vColB; varying vec4 vFaceU;
varying vec3 vLocal; varying vec3 vScale; varying vec3 vWNorm; varying float vU;
// 世界坐标与高度雾共用同一个 varying（减少逐顶点输出）
#define vWPos vGzFogW
uniform float uTime; uniform float uNight; uniform float uLights; uniform float uLitAmt; uniform float uStreetOn; uniform float uWet; uniform float uDusk;
float boxAA(vec2 f, vec2 lo, vec2 hi, vec2 w){ vec2 a = smoothstep(lo - w, lo + w, f); vec2 b = 1.0 - smoothstep(hi - w, hi + w, f); return a.x*a.y*b.x*b.y; }
vec3 winCol(float r){
  vec3 warm = vec3(1.0, 0.64, 0.32); vec3 neu = vec3(1.0, 0.84, 0.62); vec3 cool = vec3(0.78, 0.88, 1.0);
  return r < 0.55 ? mix(warm, neu, r / 0.55) : mix(neu, cool, (r - 0.55) / 0.45);
}
// 远处窗灯：窗格小于数个像素时不再逐窗随机开关（会产生闪烁的颗粒），改为按大块区域平滑的平均亮度
// 远处窗灯：办公楼按楼层（整层加班）+ 大开间两级随机，住宅按相邻两户成组随机；
// 窗格趋于亚像素时逐渐退化为平均亮度，避免摩尔纹与移动时的闪烁
float farLit(vec2 cell, float seed, float ratio, vec2 fwc, float office){
  float v;
  if (office > 0.5) {
    float fl = gzH21(vec2(cell.y, seed));
    float bay = gzH21(vec2(floor(cell.x / 8.0), cell.y + seed * 3.1));
    v = step(fl, ratio) * (0.55 + 0.9 * bay) + 0.2 * step(bay, ratio);
  } else {
    v = step(gzH21(floor(cell / vec2(2.0, 1.0)) + seed * 1.37), ratio);
  }
  float mean = office > 0.5 ? ratio * 1.2 : ratio;
  return clamp(mix(v, mean, smoothstep(0.35, 1.0, max(fwc.x * (office > 0.5 ? 0.125 : 0.5), fwc.y))), 0.0, 1.0);
}

// 室内映射：窗后虚拟一个房间（后墙、侧墙、天花灯盘、地板、家具剪影），随视角产生真实的纵深视差。
// fc：房间内坐标 0..1（沿立面切线、沿高度）；wsz：房间开间与层高（米）；V：相机→片元方向；N / T：立面外法线与水平切线；
// lit：该房间的灯光强度（0 = 未开灯）；lc：灯光颜色；dayAmb：白天透入室内的环境光。
vec3 gzRoom(vec2 fc, vec2 wsz, float sgT, vec3 V, vec3 N, vec3 T, float rs, float lit, vec3 lc, float dayAmb){
  fc.x = sgT > 0.0 ? fc.x : 1.0 - fc.x;
  vec3 rd = vec3(dot(V, T), V.y, -dot(V, N));
  rd.z = max(rd.z, 0.05);
  rd.x = abs(rd.x) < 1e-4 ? 1e-4 : rd.x;
  rd.y = abs(rd.y) < 1e-4 ? -1e-4 : rd.y;
  float dep = wsz.x * (0.7 + 0.8 * rs) + 2.0;
  vec3 ro = vec3(fc * wsz, 0.0);
  float tx = ((rd.x > 0.0 ? wsz.x : 0.0) - ro.x) / rd.x;
  float ty = ((rd.y > 0.0 ? wsz.y : 0.0) - ro.y) / rd.y;
  float tz = dep / rd.z;
  float t = min(min(tx, ty), tz);
  vec3 h = ro + rd * t;
  float dn = clamp(h.z / dep, 0.0, 1.0);
  float r2 = fract(rs * 7.31);
  float r3 = fract(rs * 13.7);
  vec3 wallC = r2 < 0.5 ? vec3(0.86, 0.82, 0.74) : r2 < 0.8 ? vec3(0.74, 0.64, 0.52) : vec3(0.64, 0.7, 0.76);
  vec3 c; float k;
  if (tz <= tx && tz <= ty) {
    // 后墙 + 家具剪影（沙发 / 书桌 / 柜子）
    c = wallC; k = 0.5;
    vec2 q = h.xy / wsz;
    float fur = step(q.y, 0.26 + 0.16 * r3) * step(abs(q.x - (0.2 + 0.6 * r2)), 0.16 + 0.12 * r3);
    float cab = step(q.y, 0.72) * step(abs(q.x - (0.85 - 0.7 * r2)), 0.07) * step(0.55, r3);
    c *= 1.0 - 0.62 * max(fur, cab);
  } else if (tx <= ty) {
    c = wallC * 0.9; k = 0.62 - 0.3 * dn;
  } else if (rd.y > 0.0) {
    // 天花：吸顶灯盘
    vec2 q = vec2(h.x / wsz.x, dn);
    float panel = step(abs(q.x - 0.5), 0.2) * step(abs(q.y - 0.42), 0.15);
    c = vec3(0.92); k = 0.38 + 2.4 * panel;
  } else {
    c = r3 < 0.5 ? vec3(0.5, 0.38, 0.27) : vec3(0.6, 0.6, 0.57); k = 0.42 * (1.0 - 0.5 * dn);
  }
  return lc * c * k * lit + c * dayAmb * (0.35 + 0.65 * (1.0 - dn));
}
// 窗帘（住宅：两侧布帘或整幅拉上）/ 百叶（办公：上半部分放下）
// det：室内细节等级（窗格只有几个像素时使用房间的平均亮度，避免室内细节产生摩尔纹与闪烁）
vec3 gzWinE(vec2 fc, vec2 wsz, float sgT, vec3 V, vec3 N, vec3 T, float rs, float lit, vec3 lc, float dayAmb, float office, float det){
  vec3 roomAvg = lc * lit * 0.42 + vec3(0.8, 0.76, 0.7) * dayAmb * 0.75;
  vec3 room = det > 0.01 ? mix(roomAvg, gzRoom(fc, wsz, sgT, V, N, T, rs, lit, lc, dayAmb), det) : roomAvg;
  float cov;
  vec3 cc;
  if (office > 0.5) {
    float drop = step(0.45, fract(rs * 5.13)) * (0.25 + 0.6 * fract(rs * 3.77));
    cov = mix(drop * 0.85, step(1.0 - drop, fc.y) * (0.75 + 0.25 * step(0.5, fract(fc.y * wsz.y * 9.0))), det);
    cc = vec3(0.8, 0.8, 0.78);
  } else {
    float cw = 0.06 + 0.3 * fract(rs * 3.77);
    float full = step(0.84, fract(rs * 5.13));
    cov = mix(max(full, 2.0 * cw), max(full, step(0.5 - cw, abs(fc.x - 0.5))), det);
    cc = fract(rs * 9.1) < 0.6 ? vec3(0.88, 0.8, 0.66) : fract(rs * 9.1) < 0.85 ? vec3(0.78, 0.52, 0.36) : vec3(0.6, 0.66, 0.72);
  }
  vec3 curt = cc * (lc * 0.4 * lit + dayAmb * 1.6);
  return mix(room, curt, cov);
}
vec3 ledCol(float s){
  float k = fract(s * 0.618);
  vec3 c = k < 0.4 ? vec3(1.0, 0.66, 0.26) : k < 0.6 ? vec3(0.9, 0.95, 1.0) : k < 0.75 ? vec3(0.25, 0.75, 1.0) : k < 0.88 ? vec3(1.0, 0.3, 0.55) : vec3(0.6, 0.35, 1.0);
  return mix(c, vec3(1.0, 0.92, 0.82), 0.35);
}
`;

// 主立面逻辑：计算 albedo / 粗糙度 / 金属度 / 自发光 / 法线扰动
const FACADE_COLOR = /* glsl */ `
float gzStyle = floor(vFA.x + 0.5);
float fh = max(vFA.y, 0.5);
float seed = vFA.z;
float litR = vFA.w;
float cellW = max(vFB.x, 0.3);
float p1 = vFB.y;
float p2 = vFB.z;
float led = floor(vFB.w + 0.5);
vec3 Nw = normalize(vWNorm);
float hgt = vWPos.y;
float u = vU;
vec2 cc = vec2(u / cellW, hgt / fh);
vec2 cell = floor(cc);
vec2 f = fract(cc);
vec2 fw = fwidth(cc);
float detail = 1.0 - smoothstep(0.3, 0.75, max(fw.x, fw.y));
vec2 aa = max(fw * 0.8, vec2(0.003));
vec3 albedo = vColA;
float fRough = 0.85;
float fMetal = 0.0;
vec3 fEmis = vec3(0.0);
float fGlass = 0.0;
vec3 nP = vec3(0.0);
float rnd = gzH31(vec3(cell, seed));
float rndF = gzH21(vec2(cell.y, seed));
float rndC = gzH21(vec2(cell.x, seed + 7.13));
float nightK = uNight * uLights;
float grime = gzNoise(vec2(u * 0.35, hgt * 0.07 + seed)) * 0.55 + gzNoise(vec2(u * 1.9, hgt * 0.45)) * 0.45;
bool flatRoof = Nw.y > 0.965;
bool under = Nw.y < -0.6;
bool faceX = vFaceU.x > 0.5;
// 室内映射所需的视线与立面切线框架（导数须在分支之外求）
vec3 Vw = normalize(vWPos - cameraPosition);
vec3 Tw = normalize(vec3(Nw.z, 0.0, -Nw.x) + vec3(1e-5, 0.0, 0.0));
float pT = dot(vWPos, Tw);
float sgT = (dFdx(u) * dFdx(pT) + dFdy(u) * dFdy(pT)) < 0.0 ? -1.0 : 1.0;
// 窗灯细节等级：窗格大于约 3 像素时逐窗（室内映射），小于约 1.5 像素时为平滑的区域平均
float detE = 1.0 - smoothstep(0.3, 0.7, max(fw.x, fw.y));
float detR = 1.0 - smoothstep(0.07, 0.2, max(fw.x, fw.y));
float dayAmb = 0.05 * (1.0 - uNight) + 0.003;
float litAmt = litR * uLitAmt;
float blkR = gzH21(floor(cell / vec2(10.0, 3.0)) + seed * 1.37);
float pxE = max(fwidth(vLocal.x * vScale.x), fwidth(vLocal.z * vScale.z));
float pxY = fwidth(vLocal.y * vScale.y);

if (gzStyle == 20.0) {
  // 瓦屋面：沿屋坡的筒瓦垄、檐口与屋脊暗线
  float along = vLocal.x * vScale.x;
  float t = fract(along / 0.26);
  float groove = smoothstep(0.0, 0.16, t) * smoothstep(1.0, 0.8, t);
  float fwt = fwidth(along / 0.26);
  groove = mix(0.72, groove, 1.0 - smoothstep(0.35, 0.7, fwt));
  float course = fract(hgt / 0.32);
  vec3 tc = vColA * (0.8 + 0.28 * groove) * (0.92 + 0.12 * gzNoise(vWPos.xz * 0.6 + seed));
  tc *= 0.95 + 0.08 * smoothstep(0.0, 0.2, course);
  float eave = 1.0 - smoothstep(0.02, 0.1, vLocal.y);
  float ridge = smoothstep(0.93, 0.99, vLocal.y);
  albedo = mix(tc, vColB, max(eave * 0.6, ridge * 0.8));
  if (vFaceU.w > 0.5) albedo = mix(vColA * 0.7, vec3(0.34, 0.34, 0.33), 0.6);
  fRough = 0.7 - uWet * 0.35;
  fMetal = p1 > 0.5 ? 0.35 : 0.0;
  if (p1 > 0.5) albedo = vColA * (0.8 + 0.25 * groove);
} else if (gzStyle == 17.0) {
  albedo = vColA * (0.7 + 0.5 * gzNoise(vWPos.xz * 0.8));
  fRough = 0.95;
} else if (flatRoof) {
  float rn = gzNoise(vWPos.xz * 0.3 + seed) * 0.5 + gzNoise(vWPos.xz * 2.3) * 0.5;
  albedo = mix(vec3(0.2, 0.2, 0.195), vec3(0.34, 0.335, 0.32), rn);
  if (gzStyle == 6.0 || gzStyle == 13.0) albedo = vColA * 0.7;
  if (gzStyle == 15.0 || gzStyle == 18.0 || gzStyle == 19.0 || gzStyle == 16.0) albedo = vColA * 0.8;
  fRough = 0.92 - uWet * 0.4;
  // 冠顶 LED
  if (led > 0.5) fEmis += ledCol(seed) * 1.4 * nightK * (1.0 - smoothstep(0.4, 1.2, min((0.5 - abs(vLocal.x)) * vScale.x, (0.5 - abs(vLocal.z)) * vScale.z)));
} else if (under) {
  albedo = vColA * 0.5;
  fRough = 0.9;
  if (gzStyle == 5.0 || gzStyle == 21.0 || gzStyle == 9.0) {
    // 骑楼廊下：暖色吊灯照亮拱廊
    albedo = mix(vColA, vec3(0.9, 0.88, 0.84), 0.4) * 0.8;
    fEmis = vec3(1.0, 0.64, 0.32) * 0.55 * uStreetOn * uLights;
  }
} else if (gzStyle == 1.0) {
  // 玻璃幕墙：竖梃 + 层间窗槛墙，玻璃面板带随机反射扰动
  float mull = 1.0 - boxAA(f, vec2(0.035, -1.0), vec2(0.965, 2.0), aa);
  float span = 1.0 - smoothstep(0.1 - aa.y, 0.1 + aa.y, f.y);
  float frame = max(mull, span * 0.9);
  frame = mix(0.14, frame, 1.0 - smoothstep(0.18, 0.5, max(fw.x, fw.y)));
  // 玻璃面板：大尺度的反射起伏 + 轻微的逐板差异（避免马赛克感）
  float wav = gzNoise(vec2(u * 0.045, hgt * 0.018) + seed);
  vec3 gc = vColA * (0.93 + 0.12 * rnd * detail) * (0.96 + 0.06 * rndF) * (0.86 + 0.28 * wav);
  albedo = mix(gc, mix(vColB, gc, 0.3), frame);
  fRough = mix(0.05 + 0.12 * rnd, 0.42, frame);
  fMetal = mix(0.88, 0.4, frame);
  fGlass = 1.0 - frame;
  nP = vec3(rnd - 0.5, 0.0, rndF - 0.5) * 0.035 * detail * fGlass + vec3(wav - 0.5, 0.0, 0.0) * 0.05 * fGlass;
  // 首层通高大堂
  float lob = 0.0;
  if (hgt < 7.5) {
    lob = boxAA(vec2(fract(u / (cellW * 2.0)), hgt / 7.5), vec2(0.03, 0.02), vec2(0.97, 0.94), aa * vec2(0.5, 0.15));
    albedo = mix(vColB * 0.9, vec3(0.05, 0.06, 0.07), lob);
    fRough = mix(0.5, 0.06, lob); fMetal = mix(0.4, 0.8, lob); fGlass = lob; nP = vec3(0.0);
  }
  // 办公室：4 个竖梃开间合为一个房间，按楼层成片亮灯（加班的楼层），灯光偏中性白
  float rN = 4.0;
  vec2 rc = vec2(floor(cc.x / rN), cell.y);
  float rsR = gzH31(vec3(rc, seed + 2.0));
  float floorOn = step(rndF, litAmt * 0.9);
  float onR = floorOn * step(rsR, 0.8) * (0.8 + 0.4 * fract(rsR * 3.3));
  vec3 lcR = winCol(0.5 + 0.45 * fract(rndF * 7.3));
  vec3 nearE = gzWinE(vec2(fract(cc.x / rN), f.y), vec2(cellW * rN, fh), sgT, Vw, Nw, Tw, rsR, onR * nightK, lcR, dayAmb, 1.0, detR);
  vec3 farE = lcR * 0.45 * farLit(cell, seed, litAmt * 0.9, fw, 1.0) * nightK + dayAmb * 0.35;
  fEmis = mix(farE, nearE, detE) * fGlass;
  if (hgt < 7.5) fEmis = vec3(1.0, 0.86, 0.66) * lob * (0.9 * uStreetOn * uLights + dayAmb * 4.0);
} else if (gzStyle == 2.0 || gzStyle == 14.0) {
  // 石材 / 铝板办公楼：窗洞或竖向窗带
  float win = gzStyle == 14.0 ? boxAA(f, vec2(0.3, 0.04), vec2(0.7, 0.96), aa) : boxAA(f, vec2(0.17, 0.28), vec2(0.83, 0.86), aa);
  float wa = gzStyle == 14.0 ? 0.37 : 0.38;
  vec3 wall = vColA * (0.9 + 0.14 * grime);
  vec3 gl = vColB * (0.55 + 0.3 * rnd);
  albedo = mix(mix(wall, gl, wa), mix(wall, gl, win), detail);
  fRough = mix(0.78, 0.12, win * detail);
  fMetal = mix(0.0, 0.6, win * detail);
  fGlass = win;
  float on = step(rnd, litAmt * 0.8) * (0.8 + 0.4 * rndF);
  vec3 lc = winCol(0.4 + rnd * 0.55);
  vec3 nearE = gzWinE(f, vec2(cellW, fh), sgT, Vw, Nw, Tw, rnd, on * nightK, lc, dayAmb, 1.0, detR) * win;
  vec3 farE = (winCol(0.6) * 0.45 * farLit(cell, seed, litAmt * 0.7, fw, 1.0) * nightK + dayAmb * 0.35) * wa;
  fEmis = mix(farE, nearE, detE);
} else if (gzStyle == 3.0) {
  // 高层住宅：阳台竖列、窗、空调外机、层间线
  float balc = step(0.5, rndC);
  float win = boxAA(f, vec2(0.14, 0.3), vec2(0.86, 0.86), aa);
  float rail = (1.0 - smoothstep(0.27 - aa.y, 0.27 + aa.y, f.y)) * step(0.04, f.y) * balc;
  float slab = 1.0 - smoothstep(0.05 - aa.y, 0.05 + aa.y, f.y);
  float ac = boxAA(f, vec2(0.02, 0.32), vec2(0.13, 0.5), aa) * step(0.55, rnd) * (1.0 - balc);
  vec3 wall = vColA * (0.93 + 0.1 * grime);
  vec3 a2 = wall;
  a2 = mix(a2, vec3(0.16, 0.18, 0.2) * (0.8 + 0.4 * rnd), win * (1.0 - rail));
  a2 = mix(a2, vColB, max(rail * 0.9, slab * 0.55));
  a2 = mix(a2, vec3(0.8, 0.8, 0.78), ac);
  vec3 avgC = mix(wall, vec3(0.2), 0.3) * 0.95;
  albedo = mix(avgC, a2, detail);
  float glass = win * (1.0 - rail);
  fRough = mix(0.8, 0.15, glass * detail);
  fMetal = mix(0.0, 0.45, glass * detail);
  fGlass = glass;
  // 住宅：暖光为主，少量冷白光（灯管）与电视蓝光
  float on = step(rnd, litAmt) * (0.7 + 0.5 * rndF);
  vec3 wc = winCol(0.02 + rnd * 0.5);
  float tv = step(0.9, gzH21(cell + 3.3));
  if (tv > 0.5) wc = mix(vec3(0.5, 0.66, 1.0), vec3(0.7, 0.8, 1.0), 0.5 + 0.5 * sin(uTime * 3.0 + rnd * 20.0)) * 0.7;
  vec3 nearE = gzWinE(f, vec2(cellW, fh), sgT, Vw, Nw, Tw, rnd, on * nightK, wc, dayAmb, 0.0, detR) * glass;
  vec3 farE = (winCol(0.25) * 0.45 * farLit(cell, seed, litAmt, fw, 0.0) * nightK + dayAmb * 0.35) * 0.42;
  fEmis = mix(farE, nearE, detE);
} else if (gzStyle == 4.0 || gzStyle == 7.0) {
  // 老式多层 / 城中村握手楼：小窗、防盗网、空调、雨水污渍，底层铺面
  bool vil = gzStyle == 7.0;
  float win = vil ? boxAA(f, vec2(0.24, 0.3), vec2(0.76, 0.76), aa) : boxAA(f, vec2(0.27, 0.32), vec2(0.73, 0.8), aa);
  float bars = max(step(0.8, fract(u / 0.13)), step(0.84, fract(hgt / 0.3)));
  float cage = win * bars * step(0.3, rndC);
  float ac = boxAA(f, vec2(0.77, 0.34), vec2(0.95, 0.52), aa) * step(0.38, rnd);
  float laundry = vil ? boxAA(f, vec2(0.25, 0.12), vec2(0.75, 0.28), aa) * step(0.7, rnd) : 0.0;
  float stain = smoothstep(0.35, 0.0, abs(f.x - 0.5)) * (1.0 - f.y) * 0.28 * step(0.45, rndC);
  vec3 wall = vColA * (0.84 + 0.2 * grime) * (1.0 - stain * detail);
  wall *= 1.0 - 0.12 * smoothstep(0.6, 1.0, gzNoise(vec2(u * 0.2, hgt * 0.04 + seed * 3.0)));
  vec3 a2 = mix(wall, vec3(0.11, 0.12, 0.13), win);
  a2 = mix(a2, vec3(0.36, 0.34, 0.31), cage * 0.85);
  a2 = mix(a2, vec3(0.82, 0.82, 0.8), ac);
  a2 = mix(a2, gzHsv(fract(rnd * 3.7), 0.55, 0.8), laundry);
  albedo = mix(mix(wall, vec3(0.12), 0.18), a2, detail);
  fRough = mix(0.88, 0.25, win * detail) - uWet * 0.3;
  fGlass = win * (1.0 - cage * 0.5);
  float on = step(rnd, litAmt) * (0.7 + 0.5 * rndF);
  vec3 wc = vil && rndC > 0.4 ? vec3(0.82, 0.92, 1.0) : winCol(0.05 + rnd * 0.5);
  vec3 nearE = gzWinE(f, vec2(cellW, fh), sgT, Vw, Nw, Tw, rnd, on * nightK, wc, dayAmb, 0.0, detR) * fGlass;
  vec3 farE = (winCol(0.3) * 0.45 * farLit(cell, seed, litAmt, fw, 0.0) * nightK + dayAmb * 0.35) * 0.26;
  fEmis = mix(farE, nearE, detE);
  // 底层铺面
  if (hgt < 3.4 && (p1 > 0.5 || vil)) {
    vec2 sf = vec2(fract(u / 4.2), hgt / 3.4);
    float shut = step(0.45, gzH21(vec2(floor(u / 4.2), seed)));
    float door = boxAA(sf, vec2(0.08, 0.0), vec2(0.92, 0.82), aa);
    vec3 sc = shut > 0.5 ? vec3(0.42, 0.44, 0.45) * (0.85 + 0.15 * step(0.5, fract(hgt * 6.0))) : vec3(0.07);
    albedo = mix(wall * 0.85, sc, door);
    fEmis = shut > 0.5 ? vec3(0.0) : vec3(1.0, 0.78, 0.52) * door * 0.9 * uStreetOn * uLights;
    fRough = 0.6;
  }
} else if (gzStyle == 5.0 || gzStyle == 12.0) {
  // 骑楼 / 洋楼立面：拱券长窗、窗框、百叶、壁柱、檐口线脚与岁月污渍
  bool colo = gzStyle == 12.0;
  vec2 wf = f;
  float x0 = colo ? 0.3 : 0.24;
  float x1 = colo ? 0.7 : 0.76;
  float y0 = 0.2;
  float yTop = colo ? 0.78 : 0.8;
  float archH = p1 < 0.5 ? 0.14 : p1 < 1.5 ? 0.07 : 0.0;
  float rect = boxAA(wf, vec2(x0, y0), vec2(x1, yTop - archH), aa);
  vec2 ad = (wf - vec2(0.5, yTop - archH)) / vec2((x1 - x0) * 0.5, max(archH, 0.001));
  float arch = archH > 0.0 ? (1.0 - smoothstep(0.92, 1.08, length(ad))) * step(yTop - archH, wf.y) : 0.0;
  float win = max(rect, arch);
  float rectB = boxAA(wf, vec2(x0 - 0.06, y0 - 0.05), vec2(x1 + 0.06, yTop - archH), aa);
  vec2 adB = (wf - vec2(0.5, yTop - archH)) / vec2((x1 - x0) * 0.5 + 0.06, max(archH, 0.001) + 0.05);
  float archB = (1.0 - smoothstep(0.92, 1.08, length(adB))) * step(yTop - archH, wf.y);
  float frame = clamp(max(rectB, archB) - win, 0.0, 1.0);
  float pil = 1.0 - boxAA(wf, vec2(0.07, -1.0), vec2(0.93, 2.0), aa);
  float corn = smoothstep(0.88 - aa.y, 0.9 + aa.y, wf.y);
  float sill = boxAA(wf, vec2(x0 - 0.08, y0 - 0.07), vec2(x1 + 0.08, y0 - 0.01), aa);
  float closed = step(0.7, rnd);
  vec3 wall = vColA * (0.88 + 0.16 * grime);
  wall *= 1.0 - 0.22 * smoothstep(0.5, 1.0, gzNoise(vec2(u * 0.7, hgt * 0.22 + seed))) * (colo ? 0.4 : 1.0);
  wall *= 1.0 - 0.12 * (1.0 - wf.y) * step(0.5, rndC);
  vec3 a2 = wall;
  a2 = mix(a2, wall * 1.1 + 0.02, pil * 0.7);
  a2 = mix(a2, mix(wall, vec3(0.94, 0.92, 0.88), 0.55), max(corn, sill) * 0.85);
  a2 = mix(a2, colo ? vec3(0.95, 0.94, 0.9) : vColB, frame);
  vec3 shutter = (colo ? vec3(0.28, 0.45, 0.32) : vColB * 0.85) * (0.85 + 0.15 * step(0.5, fract(hgt * 7.0)));
  a2 = mix(a2, closed > 0.5 ? shutter : vec3(0.09, 0.09, 0.1), win);
  albedo = mix(mix(wall, vec3(0.2), 0.14), a2, detail);
  fGlass = win * (1.0 - closed);
  fRough = mix(0.85, 0.2, fGlass * detail) - uWet * 0.3;
  fMetal = fGlass * detail * 0.3;
  float on = step(rnd, litAmt * 1.2) * (0.7 + 0.5 * rndF);
  vec3 nearE = gzWinE(f, vec2(cellW, fh), sgT, Vw, Nw, Tw, rnd, on * nightK, winCol(0.02 + rnd * 0.35), dayAmb, 0.0, detR) * fGlass;
  vec3 farE = (winCol(0.2) * 0.45 * farLit(cell, seed, litAmt * 1.2, fw, 0.0) * nightK + dayAmb * 0.35) * 0.3 * (1.0 - closed);
  fEmis = mix(farE, nearE, detE);
} else if (gzStyle == 6.0 || gzStyle == 13.0) {
  // 青砖墙：砖缝、花岗岩勒脚、小木窗；镬耳墙顶部黑色压檐 + 白色灰塑带
  float row = floor(hgt / 0.09);
  vec2 bc = vec2((u + row * 0.12) / 0.25, hgt / 0.09);
  float mortar = max(smoothstep(0.84, 1.0, fract(bc.y)), smoothstep(0.93, 1.0, fract(bc.x)));
  float fine = 1.0 - smoothstep(0.25, 0.6, max(fwidth(bc.x), fwidth(bc.y)));
  vec3 wall = vColA * (0.9 + 0.18 * gzH21(floor(bc) + seed)) ;
  wall = mix(vColA, wall, fine);
  wall = mix(wall, wall * 1.28 + 0.03, mortar * 0.55 * fine);
  wall *= 0.9 + 0.12 * grime;
  if (p1 > 0.5) wall = vColA * (0.9 + 0.12 * grime) * (1.0 - 0.15 * smoothstep(0.6, 1.0, gzNoise(vec2(u, hgt * 0.3))));
  if (hgt < 1.05) wall = vec3(0.5, 0.49, 0.46) * (0.9 + 0.12 * gzNoise(vec2(u * 2.0, hgt * 4.0)));
  albedo = wall;
  fRough = 0.9 - uWet * 0.35;
  if (gzStyle == 13.0) {
    float e = 0.6;
    float lx = vLocal.x;
    float yTop = e + (1.0 - e) * sqrt(max(0.0, 1.0 - 4.0 * lx * lx));
    float dTop = (yTop - vLocal.y) * vScale.y;
    float trim = 1.0 - smoothstep(0.32, 0.42, dTop);
    float band = smoothstep(0.42, 0.5, dTop) * (1.0 - smoothstep(0.95, 1.05, dTop)) * step(e * vScale.y + 0.4, vLocal.y * vScale.y);
    albedo = mix(albedo, vec3(0.86, 0.85, 0.81), band * 0.9);
    albedo = mix(albedo, vColB, trim);
  } else {
    float hasWin = step(0.5, rnd);
    float win = boxAA(f, vec2(0.36, 0.4), vec2(0.64, 0.78), aa) * hasWin;
    albedo = mix(albedo, vec3(0.16, 0.12, 0.09), win * detail);
    float on = step(rnd, litR * uLitAmt * 1.5) * win;
    fEmis = winCol(0.05) * on * 0.9 * nightK * detail;
  }
} else if (gzStyle == 8.0) {
  // 商业裙楼：首层通透橱窗，上部横向线条与 LED 大屏
  if (hgt < 6.0) {
    vec2 sf = vec2(fract(u / 6.0), hgt / 6.0);
    float gl = boxAA(sf, vec2(0.04, 0.02), vec2(0.96, 0.9), aa);
    albedo = mix(vColA, vec3(0.08, 0.09, 0.1), gl);
    fRough = mix(0.6, 0.08, gl);
    fMetal = gl * 0.5;
    fGlass = gl;
    fEmis = vec3(1.0, 0.82, 0.6) * gl * 1.0 * uStreetOn * uLights;
  } else {
    float band = smoothstep(0.86, 0.9, fract(hgt / fh));
    albedo = mix(vColA * (0.9 + 0.1 * grime), vColA * 0.6, band * 0.7);
    vec2 sc = vec2(floor(u / 16.0), floor(hgt / 12.0));
    float scr = step(0.78, gzH21(sc + seed));
    vec2 sfr = vec2(fract(u / 16.0), fract(hgt / 12.0));
    float inS = boxAA(sfr, vec2(0.08, 0.1), vec2(0.92, 0.9), aa) * scr;
    albedo = mix(albedo, vec3(0.05), inS);
    vec3 sCol = gzHsv(fract(gzH21(sc) + uTime * 0.03 + sfr.y * 0.2), 0.7, 1.0);
    fEmis = sCol * inS * (1.2 + 1.2 * uNight) * uLights * (0.35 + 0.65 * uNight);
    fRough = 0.6;
  }
} else if (gzStyle == 9.0) {
  // 铺面：玻璃门、招牌带、卷帘门
  vec2 sf = vec2(fract(u / cellW), hgt / fh);
  float shut = step(0.72, rnd);
  float door = boxAA(sf, vec2(0.1, 0.0), vec2(0.9, 0.74), aa);
  float band = step(0.8, sf.y) * step(sf.y, 0.97);
  vec3 bandC = gzHsv(fract(gzH21(vec2(cell.x, seed)) * 3.1), 0.7, 0.75);
  albedo = vColA;
  albedo = mix(albedo, shut > 0.5 ? vec3(0.45, 0.46, 0.47) * (0.85 + 0.15 * step(0.5, fract(hgt * 8.0))) : vec3(0.08, 0.08, 0.09), door);
  albedo = mix(albedo, bandC, band);
  fRough = mix(0.7, 0.1, door * (1.0 - shut));
  fEmis = (vec3(1.0, 0.72, 0.42) * door * (1.0 - shut) * 0.95 * (0.7 + 0.6 * rndC) + bandC * band * 0.9) * uStreetOn * uLights;
} else if (gzStyle == 10.0) {
  // 东塔：白色竖向陶板肋
  float fin = 1.0 - boxAA(f, vec2(0.17, -1.0), vec2(0.83, 2.0), aa);
  float span = 1.0 - smoothstep(0.06 - aa.y, 0.06 + aa.y, f.y);
  float fr = mix(0.62, max(fin, span * 0.7), detail);
  albedo = mix(vColA * (0.85 + 0.25 * rnd * detail), vColB, fr);
  fRough = mix(0.08, 0.55, fr);
  fMetal = mix(0.8, 0.05, fr);
  fGlass = 1.0 - fr;
  nP = vec3(f.x - 0.5, 0.0, 0.0) * 0.8 * fin * detail;
  float rN = 3.0;
  float rsR = gzH31(vec3(floor(cc.x / rN), cell.y, seed + 2.0));
  float onR = step(rndF, litAmt * 0.9) * step(rsR, 0.85);
  vec3 nearE = gzWinE(vec2(fract(cc.x / rN), f.y), vec2(cellW * rN, fh), sgT, Vw, Nw, Tw, rsR, onR * nightK, winCol(0.62), dayAmb, 1.0, detR);
  vec3 farE = winCol(0.62) * 0.45 * farLit(cell, seed, litAmt * 0.9, fw, 1.0) * nightK + dayAmb * 0.35;
  fEmis = mix(farE, nearE, detE) * fGlass;
} else if (gzStyle == 11.0) {
  // 西塔：钻石形斜交网格
  float gs = 16.0;
  float kk = 0.75;
  float d1 = abs(fract((u + hgt * kk) / gs) - 0.5);
  float d2 = abs(fract((u - hgt * kk) / gs) - 0.5);
  float lw = 0.045 + fwidth((u + hgt * kk) / gs) * 1.5;
  float line = max(1.0 - smoothstep(lw * 0.5, lw, 0.5 - d1), 1.0 - smoothstep(lw * 0.5, lw, 0.5 - d2));
  line = max(line, (1.0 - smoothstep(0.03, 0.06, f.y)) * 0.4 * detail);
  albedo = mix(vColA * (0.85 + 0.25 * rnd * detail), vColB, line);
  fRough = mix(0.06, 0.4, line);
  fMetal = mix(0.85, 0.2, line);
  fGlass = 1.0 - line;
  float rsR = gzH31(vec3(floor(u / 8.0), cell.y, seed + 2.0));
  float onR = step(rndF, litAmt * 0.9) * step(rsR, 0.85);
  vec3 nearE = gzWinE(vec2(fract(u / 8.0), f.y), vec2(8.0, fh), sgT, Vw, Nw, Tw, rsR, onR * nightK, winCol(0.7), dayAmb, 1.0, detR);
  vec3 farE = winCol(0.7) * 0.45 * farLit(cell, seed, litAmt * 0.9, fw, 1.0) * nightK + dayAmb * 0.35;
  fEmis = mix(farE, nearE, detE) * fGlass;
  fEmis += vec3(0.7, 0.85, 1.0) * line * 0.7 * nightK;
} else if (gzStyle == 15.0) {
  // 招牌：底色 + 程序化“汉字”（横竖笔画），夜间霓虹
  float bw = faceX ? vScale.x : vScale.z;
  float bh = vScale.y;
  vec2 tl = faceX ? vec2((vLocal.x + 0.5) * vScale.x, vLocal.y * vScale.y) : vec2((vLocal.z + 0.5) * vScale.z, vLocal.y * vScale.y);
  bool vert = bh > bw * 1.4;
  float cs = vert ? bw * 0.78 : min(bh * 0.78, 0.62);
  vec2 org = vert ? vec2((bw - cs) * 0.5, 0.0) : vec2(0.0, (bh - cs) * 0.5);
  vec2 g = (tl - org) / cs;
  vec2 ci = floor(g);
  vec2 cf = fract(g);
  float inBoard = vert ? step(0.0, g.x) * step(g.x, 1.0) * step(0.25, g.y) * step(g.y, bh / cs - 0.25) : step(0.0, g.y) * step(g.y, 1.0) * step(0.3, g.x) * step(g.x, bw / cs - 0.3);
  float s = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float yk = 0.24 + 0.26 * fk;
    float on = step(0.3, gzH21(ci + vec2(fk, 3.1) + seed));
    float x0 = 0.14 + 0.28 * gzH21(ci + vec2(fk, 5.7));
    float x1 = 0.58 + 0.28 * gzH21(ci + vec2(fk, 7.3));
    s = max(s, on * (1.0 - step(0.05, abs(cf.y - yk))) * step(x0, cf.x) * step(cf.x, x1));
  }
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float xk = 0.34 + 0.32 * fk + 0.08 * (gzH21(ci + vec2(fk, 1.3)) - 0.5);
    float on = step(0.25, gzH21(ci + vec2(fk, 9.9) + seed));
    float y0 = 0.12 + 0.3 * gzH21(ci + vec2(fk, 2.2));
    float y1 = 0.55 + 0.33 * gzH21(ci + vec2(fk, 4.4));
    s = max(s, on * (1.0 - step(0.055, abs(cf.x - xk))) * step(y0, cf.y) * step(cf.y, y1));
  }
  s *= inBoard * step(0.1, cf.x) * step(cf.x, 0.9) * step(0.08, cf.y) * step(cf.y, 0.92);
  float fade = 1.0 - smoothstep(0.08, 0.2, max(fwidth(g.x), fwidth(g.y)));
  s *= fade;
  float lum = dot(vColA, vec3(0.3, 0.55, 0.15));
  vec3 txt = lum > 0.35 ? vec3(0.45, 0.05, 0.04) : (gzH21(ci + 9.1) > 0.5 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.8, 0.28));
  float frameB = 1.0 - step(0.06, min(min(tl.x, bw - tl.x), min(tl.y, bh - tl.y)));
  albedo = mix(vColA, txt, s * 0.92);
  albedo = mix(albedo, vec3(0.85, 0.7, 0.3), frameB * 0.6);
  fRough = 0.45;
  fEmis = (vColA * 0.7 + txt * s * 2.2 + vec3(1.0, 0.8, 0.4) * frameB * 1.2) * uStreetOn * uLights * (0.85 + 0.15 * sin(uTime * 2.5 + seed));
} else if (gzStyle == 16.0) {
  albedo = vColA * (0.85 + 0.2 * gzNoise(vWPos.xy * 0.8 + vWPos.zy * 0.5));
  fRough = 0.45;
  fMetal = 0.55;
  if (led > 0.5) {
    float top = smoothstep(0.93, 0.99, vLocal.y);
    float blink = step(0.5, fract(uTime * 0.5 + seed * 0.1));
    fEmis += vec3(1.0, 0.1, 0.05) * top * 6.0 * blink * uNight;
    fEmis += ledCol(seed) * 0.8 * nightK * (1.0 - top);
  }
} else if (gzStyle == 18.0) {
  // 灯笼
  albedo = vColA;
  fRough = 0.5;
  fEmis = vec3(1.0, 0.18, 0.08) * (0.4 + 2.8 * uStreetOn) * uLights;
} else if (gzStyle == 19.0) {
  // 陈家祠屋脊陶塑：彩色人物花鸟
  vec2 rc = vec2(floor(u / 0.45), floor(hgt / 0.5));
  float k = gzH21(rc + seed);
  vec3 cols[5];
  cols[0] = vec3(0.24, 0.5, 0.36); cols[1] = vec3(0.85, 0.62, 0.2); cols[2] = vec3(0.2, 0.36, 0.6); cols[3] = vec3(0.72, 0.24, 0.16); cols[4] = vec3(0.9, 0.88, 0.8);
  albedo = mix(vColA, cols[int(k * 4.99)], detail * 0.85);
  fRough = 0.35;
  fMetal = 0.1;
} else if (gzStyle == 22.0) {
  // 路口信号灯：红黄绿三灯，按周期切换（相位随路口错开）
  albedo = vColA;
  fRough = 0.45;
  if (faceX) {
    float slot = floor(clamp(vLocal.y, 0.0, 0.999) * 3.0);
    vec2 lp = vec2(vLocal.x * vScale.x, (fract(vLocal.y * 3.0) - 0.5) * vScale.y / 3.0);
    float disc = 1.0 - smoothstep(0.1, 0.15, length(lp));
    float cyc = mod(uTime + seed * 3.7, 40.0);
    float state = cyc < 18.0 ? 0.0 : cyc < 21.0 ? 1.0 : 2.0;
    vec3 lc = slot < 0.5 ? vec3(0.1, 1.0, 0.45) : slot < 1.5 ? vec3(1.0, 0.7, 0.1) : vec3(1.0, 0.08, 0.05);
    float on = 1.0 - step(0.1, abs(slot - state));
    albedo = mix(albedo, lc * 0.2, disc);
    fEmis = lc * disc * on * (1.6 + 3.0 * uNight);
  }
} else if (gzStyle == 21.0) {
  // 骑楼廊柱与拱券
  albedo = vColA * (0.88 + 0.14 * grime);
  albedo *= mix(0.72, 1.0, smoothstep(0.0, 1.3, hgt));
  float corner = 1.0 - smoothstep(0.0, 0.2, min(0.5 - abs(vLocal.x), 1.0) * vScale.x);
  albedo = mix(albedo, albedo * 1.12, corner);
  fRough = 0.85 - uWet * 0.3;
} else {
  albedo = vColA * (0.92 + 0.12 * grime);
  fRough = 0.8 - uWet * 0.3;
}

// 窗灯整体亮度（招牌、灯笼、大屏保持原亮度）
if (gzStyle != 15.0 && gzStyle != 18.0 && gzStyle != 8.0 && gzStyle != 22.0) fEmis *= 0.85;
// 近地面接触阴影（伪 AO）
if (!flatRoof && gzStyle != 20.0) albedo *= mix(0.78, 1.0, smoothstep(0.0, 3.0, hgt));
// LED 立面灯光秀（两岸与 CBD）
if (led > 0.5 && !flatRoof && !under && gzStyle != 16.0) {
  float ex = (0.5 - abs(vLocal.x)) * vScale.x;
  float ez = (0.5 - abs(vLocal.z)) * vScale.z;
  float eD = faceX ? ex : ez;
  float topD = (1.0 - vLocal.y) * vScale.y;
  vec3 lc = ledCol(seed);
  // 灯带线宽不小于一个像素，远处按覆盖率减弱亮度，避免细线闪烁
  float oE = (1.0 - smoothstep(0.35, 0.35 + max(pxE * 1.5, 0.3), eD)) * min(1.0, 0.6 / max(pxE, 1e-3));
  float oT = (1.0 - smoothstep(0.4, 0.4 + max(pxY * 1.5, 0.4), topD)) * min(1.0, 0.7 / max(pxY, 1e-3));
  float outline = max(oE, oT);
  if (led > 2.5) {
    float cr = smoothstep(vScale.y - 14.0, vScale.y, vLocal.y * vScale.y);
    fEmis += lc * (cr * 0.7 + outline * 1.1) * nightK;
  } else if (led > 1.5) {
    float wave = smoothstep(0.55, 1.0, sin(hgt * 0.06 - uTime * 1.4 + seed * 2.0));
    vec3 wc2 = gzHsv(fract(seed * 0.071 + uTime * 0.025 + hgt * 0.0012), 0.45, 1.0);
    fEmis += (wc2 * wave * 0.55 + lc * outline * 1.1) * nightK;
  } else {
    fEmis += lc * outline * 1.1 * nightK;
  }
}
albedo *= 1.0 - uWet * 0.18;
diffuseColor.rgb = albedo;
`;

export function makeFacadeMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0 });
  if (opts.merged) m.defines = { GZ_MERGED: '' };
  return patchMaterial(m, {
    key: opts.merged ? 'facade-merged' : 'facade',
    uniforms: opts.merged ? { uBTex: { value: opts.btex } } : {},
    vPars: FACADE_VPARS,
    vMain: FACADE_VMAIN,
    fPars: FACADE_FPARS,
    replace: [
      ['color_fragment', FACADE_COLOR, 'after'],
      ['roughnessmap_fragment', 'roughnessFactor = clamp(fRough, 0.04, 1.0);', 'after'],
      ['metalnessmap_fragment', 'metalnessFactor = clamp(fMetal, 0.0, 1.0);', 'after'],
      [
        'normal_fragment_maps',
        `if (length(nP) > 0.0) { vec3 T = normalize(cross(vec3(0.0,1.0,0.0), Nw) + vec3(1e-4)); vec3 pw = normalize(Nw + T * nP.x + vec3(0.0,1.0,0.0) * nP.z);
           normal = normalize((viewMatrix * vec4(pw, 0.0)).xyz); }`,
        'after',
      ],
      ['emissivemap_fragment', 'totalEmissiveRadiance += fEmis;', 'after'],
    ],
  });
}

// ============ 地面（含江岸步道、郊野）============
const SDF_PARS = SDF_GLSL;
const WORLD_VPARS = `varying vec3 vWPos;`;
const WORLD_VMAIN = `{ vec4 wp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
wp = instanceMatrix * wp;
#endif
vWPos = (modelMatrix * wp).xyz; }`;

export function makeGroundMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  return patchMaterial(m, {
    key: 'ground',
    vPars: WORLD_VPARS,
    vMain: WORLD_VMAIN,
    fPars: `varying vec3 vWPos; uniform float uWet; uniform float uStreetOn; uniform float uLights; ${SDF_PARS}`,
    replace: [
      [
        'color_fragment',
        `
        vec2 sd = gzSdf(vWPos.xz);
        if (sd.x < 0.0) discard;
        float n1 = gzNoise(vWPos.xz * 0.05);
        float n2 = gzNoise(vWPos.xz * 0.6);
        vec3 pave = vec3(0.3, 0.29, 0.275) * (0.86 + 0.18 * n1 + 0.08 * n2);
        // 数据范围之外仍是连绵的城区，远处才逐渐过渡为郊野
        float edge = max(max(uCityBox.x - vWPos.x, vWPos.x - uCityBox.z), max(uCityBox.y - vWPos.z, vWPos.z - uCityBox.w));
        float rural = smoothstep(1800.0, 4200.0, edge + (n1 - 0.5) * 900.0);
        float urb = gzNoise(vWPos.xz * 0.004 + 7.0);
        vec3 field = mix(vec3(0.1, 0.16, 0.07), vec3(0.3, 0.29, 0.26), smoothstep(0.3, 0.7, urb)) * (0.85 + 0.25 * n2);
        vec3 col = mix(pave, field, rural);
        float rough = 0.9;
        if (sd.y < uProm) {
          // 滨江步道花岗岩铺装
          vec2 tp = vWPos.xz / vec2(1.2, 0.6);
          vec2 tf = fract(tp);
          float joint = max(smoothstep(0.93, 1.0, tf.x), smoothstep(0.9, 1.0, tf.y));
          float fine = 1.0 - smoothstep(0.2, 0.5, max(fwidth(tp.x), fwidth(tp.y)));
          vec3 stone = vec3(0.52, 0.48, 0.44) * (0.9 + 0.14 * gzH21(floor(tp)));
          stone = mix(stone, stone * 0.7, joint * fine);
          float coping = 1.0 - smoothstep(1.0, 1.6, sd.y);
          stone = mix(stone, vec3(0.62, 0.6, 0.56), coping);
          float bandL = smoothstep(uProm * 0.35, uProm * 0.38, sd.y) * (1.0 - smoothstep(uProm * 0.5, uProm * 0.53, sd.y));
          stone = mix(stone, vec3(0.42, 0.3, 0.26), bandL * 0.6);
          col = stone;
          rough = 0.75;
        } else if (sd.x < 3.0) {
          col = mix(vec3(0.46, 0.44, 0.41), col, smoothstep(0.5, 3.0, sd.x));
        }
        col *= 1.0 - uWet * 0.3;
        diffuseColor.rgb = col;
        float gzRough = rough - uWet * 0.5;
        `,
        'after',
      ],
      ['roughnessmap_fragment', 'roughnessFactor = clamp(gzRough, 0.08, 1.0);', 'after'],
    ],
  });
}

// ============ 山地：林木覆盖的山坡（坡度越陡越深、山脊略浅），远山保留淡淡的轮廓 ============
export function makeTerrainMaterial(far = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  if (!far) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  else m.defines = { GZ_FOG_CAP: '0.86' };
  return patchMaterial(m, {
    key: far ? 'terrain-far' : 'terrain',
    vPars: WORLD_VPARS,
    vMain: WORLD_VMAIN,
    fPars: `varying vec3 vWPos; uniform float uWet; ${SDF_PARS}`,
    replace: [
      [
        'color_fragment',
        `
        vec2 sd = gzSdf(vWPos.xz);
        if (sd.x < 0.0) discard;
        vec3 wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        float slope = 1.0 - abs(wn.y);
        float n1 = gzNoise(vWPos.xz * 0.02);
        float n2 = gzNoise(vWPos.xz * 0.15);
        vec3 forest = mix(vec3(0.05, 0.1, 0.035), vec3(0.1, 0.16, 0.06), n1) * (0.8 + 0.35 * n2);
        vec3 scrub = vec3(0.14, 0.17, 0.08) * (0.85 + 0.3 * n2);
        vec3 col = mix(forest, scrub, smoothstep(0.35, 0.7, n1 + vWPos.y * 0.0012));
        col *= 1.0 - 0.35 * smoothstep(0.2, 0.6, slope);
        diffuseColor.rgb = col * (1.0 - uWet * 0.2);
        `,
        'after',
      ],
    ],
  });
}

// ============ 铁路道床：碎石道砟、混凝土轨枕、两条钢轨（标准轨距 1435 mm）；远处退化为平均色 ============
export function makeRailMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  return patchMaterial(m, {
    key: 'rail',
    vPars: `${WORLD_VPARS} attribute vec2 aRail; varying vec2 vRail;`,
    vMain: `${WORLD_VMAIN} vRail = aRail;`,
    fPars: `varying vec3 vWPos; varying vec2 vRail; uniform float uWet;`,
    replace: [
      [
        'color_fragment',
        `
        float u = vRail.x;
        float v = vRail.y;
        float n1 = gzNoise(vWPos.xz * 1.7);
        float n2 = gzNoise(vWPos.xz * 0.08);
        vec3 ballast = mix(vec3(0.3, 0.28, 0.25), vec3(0.4, 0.37, 0.33), n1) * (0.85 + 0.2 * n2);
        // 道床两侧边坡略暗（油污与灰尘）
        ballast *= mix(1.0, 0.72, smoothstep(1.3, 1.7, abs(v)));
        float fu = fwidth(u);
        float fv = fwidth(v);
        float sleeperK = 1.0 - smoothstep(0.08, 0.3, fu);
        float sl = (1.0 - smoothstep(0.11 - fu, 0.11 + fu, abs(fract(u / 0.6) - 0.5) * 0.6)) * step(abs(v), 1.3);
        vec3 col = mix(ballast, vec3(0.47, 0.46, 0.44), sl * mix(0.35, 1.0, sleeperK));
        float railD = abs(abs(v) - 0.7175);
        float railW = 0.036 + fv * 0.5;
        float rl = (1.0 - smoothstep(railW, railW + fv, railD)) * min(1.0, 0.1 / max(fv, 1e-3));
        col = mix(col, vec3(0.58, 0.58, 0.6), rl);
        diffuseColor.rgb = col * (1.0 - uWet * 0.25);
        float gzRough = mix(0.92, 0.28, rl) - uWet * 0.3;
        float gzMetal = rl * 0.8;
        `,
        'after',
      ],
      ['roughnessmap_fragment', 'roughnessFactor = clamp(gzRough, 0.08, 1.0);', 'after'],
      ['metalnessmap_fragment', 'metalnessFactor = gzMetal;', 'after'],
    ],
  });
}

// ============ 街区地块（草坪、广场、麻石、泳池、湖面……）============
export function makeParcelMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  return patchMaterial(m, {
    key: 'parcel',
    vPars: `${WORLD_VPARS} attribute float aKind; varying float vKind;`,
    vMain: `${WORLD_VMAIN} vKind = aKind;`,
    fPars: `varying vec3 vWPos; varying float vKind; uniform float uWet; uniform float uTime; ${SDF_PARS}`,
    replace: [
      [
        'color_fragment',
        `
        vec2 sd = gzSdf(vWPos.xz);
        if (sd.x < 0.4 || sd.y < uProm + 0.5) discard;
        float k = floor(vKind + 0.5);
        float n1 = gzNoise(vWPos.xz * 0.07);
        float n2 = gzNoise(vWPos.xz * 0.9);
        vec3 col; float rough = 0.9; float metal = 0.0;
        if (k == 0.0 || k == 3.0) {
          col = mix(vec3(0.07, 0.15, 0.045), vec3(0.13, 0.22, 0.07), n1) * (0.85 + 0.25 * n2);
          if (k == 3.0) {
            // 园路：噪声等值线形成的蜿蜒小径（宽约 3 m），小径两侧偶有花坛
            float pn = gzNoise(vWPos.xz * 0.018 + 3.0);
            float gw = max(fwidth(pn), 1e-4);
            float path = 1.0 - smoothstep(0.018, 0.018 + gw * 1.5, abs(pn - 0.5));
            float pn2 = gzNoise(vWPos.xz * 0.011 + 17.0);
            path = max(path, 1.0 - smoothstep(0.012, 0.012 + max(fwidth(pn2), 1e-4) * 1.5, abs(pn2 - 0.45)));
            float bed = smoothstep(0.035, 0.03, abs(pn - 0.5) - 0.018) * step(0.72, gzNoise(vWPos.xz * 0.2)) * (1.0 - path);
            col = mix(col, mix(vec3(0.5, 0.12, 0.2), vec3(0.75, 0.55, 0.12), n2), bed * 0.8);
            col = mix(col, vec3(0.36, 0.34, 0.31) * (0.9 + 0.12 * n2), path);
          }
        } else if (k == 1.0) {
          vec2 tp = vWPos.xz / 1.6;
          float fine = 1.0 - smoothstep(0.2, 0.5, max(fwidth(tp.x), fwidth(tp.y)));
          float joint = max(smoothstep(0.94, 1.0, fract(tp.x)), smoothstep(0.94, 1.0, fract(tp.y)));
          col = vec3(0.42, 0.4, 0.37) * (0.88 + 0.14 * gzH21(floor(tp)) * fine + 0.06 * n1);
          col = mix(col, col * 0.78, joint * fine);
          float band = step(0.9, fract(vWPos.x / 24.0)) + step(0.9, fract(vWPos.z / 24.0));
          col = mix(col, vec3(0.38, 0.35, 0.32), clamp(band, 0.0, 1.0) * 0.5);
          rough = 0.8;
        } else if (k == 2.0) {
          vec2 tp = vWPos.xz / vec2(1.4, 0.45);
          float fine = 1.0 - smoothstep(0.2, 0.5, max(fwidth(tp.x), fwidth(tp.y)));
          float joint = max(smoothstep(0.93, 1.0, fract(tp.x + floor(tp.y) * 0.37)), smoothstep(0.88, 1.0, fract(tp.y)));
          col = vec3(0.36, 0.35, 0.33) * (0.85 + 0.2 * gzH21(floor(tp)) * fine + 0.1 * n1);
          col = mix(col, col * 0.7, joint * fine);
          rough = 0.8;
        } else if (k == 4.0) {
          col = vec3(0.14, 0.3, 0.1) * (0.9 + 0.15 * step(0.5, fract(vWPos.x / 6.0)));
        } else if (k == 5.0) {
          col = mix(vec3(0.03, 0.13, 0.14), vec3(0.06, 0.2, 0.2), n2);
          rough = 0.06; metal = 0.25;
        } else if (k == 6.0) {
          col = vec3(0.3, 0.25, 0.19) * (0.85 + 0.25 * n2);
        } else if (k == 8.0) {
          // 停车场：沥青 + 车位线
          col = vec3(0.09, 0.092, 0.095) * (0.85 + 0.2 * n1);
          vec2 pp = vWPos.xz / vec2(2.6, 5.5);
          float fine = 1.0 - smoothstep(0.2, 0.5, max(fwidth(pp.x), fwidth(pp.y)));
          float st = step(0.93, fract(pp.x)) * step(0.15, fract(pp.y * 0.5)) * fine;
          col = mix(col, vec3(0.62), st * 0.7);
          rough = 0.85;
        } else if (k == 9.0) {
          // 小区 / 院落：透水砖铺地与零散草坪、花坛
          vec2 tp = vWPos.xz / 0.9;
          float fine = 1.0 - smoothstep(0.2, 0.5, max(fwidth(tp.x), fwidth(tp.y)));
          vec3 pave = mix(vec3(0.3, 0.29, 0.27), vec3(0.36, 0.33, 0.3), gzH21(floor(tp)) * fine) * (0.9 + 0.1 * n1);
          float lawn = smoothstep(0.52, 0.6, gzNoise(vWPos.xz * 0.035 + 5.0));
          vec3 grass = mix(vec3(0.08, 0.16, 0.05), vec3(0.14, 0.23, 0.07), n2);
          col = mix(pave, grass, lawn);
          rough = mix(0.8, 0.9, lawn);
        } else if (k == 10.0) {
          // 塑胶跑道：砖红 + 白色分道线
          col = vec3(0.42, 0.13, 0.08) * (0.9 + 0.12 * n2);
          rough = 0.8;
        } else if (k == 11.0) {
          // 林地：深色林下地被
          col = mix(vec3(0.05, 0.1, 0.035), vec3(0.09, 0.15, 0.05), n1) * (0.85 + 0.25 * n2);
          rough = 0.95;
        } else {
          col = vec3(0.4, 0.38, 0.35);
        }
        col *= 1.0 - uWet * 0.25;
        diffuseColor.rgb = col;
        float gzRough = rough - uWet * 0.45;
        float gzMetal = metal;
        `,
        'after',
      ],
      ['roughnessmap_fragment', 'roughnessFactor = clamp(gzRough, 0.05, 1.0);', 'after'],
      ['metalnessmap_fragment', 'metalnessFactor = gzMetal;', 'after'],
    ],
  });
}

// ============ 道路：沥青、车道线、斑马线、中央绿化带、老城麻石巷 ============
export function makeRoadMaterial(onDeck = false, paintOnly = false) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  return patchMaterial(m, {
    key: onDeck ? 'roadDeck' : paintOnly ? 'roadPaint' : 'road',
    vPars: `${WORLD_VPARS} attribute vec4 aRoad; attribute vec3 aClr; varying vec4 vRoad; varying vec3 vClr;`,
    vMain: `${WORLD_VMAIN} vRoad = aRoad; vClr = aClr;`,
    fPars: `varying vec3 vWPos; varying vec4 vRoad; varying vec3 vClr; uniform float uWet; uniform float uStreetOn; uniform vec4 uDetailRoadBoxes[2]; uniform vec2 uDetailRoadActive; ${SDF_PARS}`,
    replace: [
      [
        'color_fragment',
        `
        ${onDeck ? '' : 'vec2 sd = gzSdf(vWPos.xz); if (sd.x < 0.3) discard;'}
        bool gzDetailCovered = false;
        ${onDeck ? '' : `for(int i=0;i<2;i++){vec4 b=uDetailRoadBoxes[i]; if(uDetailRoadActive[i]>.5 && vWPos.x>=b.x && vWPos.z>=b.y && vWPos.x<b.z && vWPos.z<b.w)gzDetailCovered=true;}`}
        ${paintOnly ? 'if(!gzDetailCovered)discard;' : onDeck ? '' : 'if(gzDetailCovered && mod(floor(vRoad.w+.5),10.0)!=3.0)discard;'}
        // aRoad.w 编码：等级 + 10 × 车道数（双向路为单向车道数，单行路为总车道数）
        float ua = vRoad.x; float va = vRoad.y; float W = vRoad.z;
        float code = floor(vRoad.w + 0.5);
        float lanesN = max(1.0, floor(code / 10.0 + 0.001));
        float cls = code - lanesN * 10.0;
        bool oneway = cls > 5.5;
        float s0 = vClr.x; float s1 = vClr.y;
        float n1 = gzNoise(vWPos.xz * 0.25);
        float n2 = gzNoise(vWPos.xz * 2.7);
        vec3 col = vec3(0.07, 0.072, 0.076) * (0.82 + 0.25 * n1 + 0.1 * n2);
        // 新铺沥青与修补块的色差
        col *= 0.92 + 0.16 * smoothstep(0.55, 0.75, gzNoise(vec2(ua * 0.02, va * 0.08) + 13.0));
        float rough = 0.86;
        float av = abs(va);
        float inMid = step(s0, ua) * step(ua, s1);
        float pxw = max(fwidth(va), 0.01);
        float line = 0.0; float gzMedian = 0.0; vec3 lcol = vec3(0.85);
        if (cls == 3.0) {
          // 老城街巷 / 步行街：麻石条铺地
          vec2 tp = vec2(ua / 1.1, va / 0.5);
          float fine = 1.0 - smoothstep(0.25, 0.6, max(fwidth(tp.x), fwidth(tp.y)));
          col = vec3(0.3, 0.29, 0.27) * (0.85 + 0.2 * gzH21(floor(tp)) * fine + 0.1 * n1);
          col = mix(col, col * 0.72, max(smoothstep(0.92, 1.0, fract(tp.x + floor(tp.y) * 0.4)), smoothstep(0.9, 1.0, fract(tp.y))) * fine);
          rough = 0.75;
        } else {
          // 路口范围内（两条路重叠处）只画素沥青，保证重叠的路面完全一致，不产生深度冲突闪烁
          float jf = floor(vClr.z + 0.5);
          float jS = mod(jf, 2.0);
          float jE = step(1.5, jf);
          col *= mix(1.0, mix(0.75, 1.0, smoothstep(W * 0.5 - 0.6, W * 0.5 - 1.2, av)), inMid);
          float med = (!oneway && cls == 0.0) ? 1.6 : 0.0;
          float lw = oneway ? (W - 1.2) / lanesN : (W * 0.5 - med - 0.6) / lanesN;
          // 车道坐标：单行路从左侧路缘起算，双向路从中线起算
          float q = oneway ? va + W * 0.5 - 0.6 : av - med;
          float wheel = 0.0;
          for (float i = 0.0; i < 6.0; i += 1.0) {
            if (i >= lanesN) break;
            float lc = (i + 0.5) * lw;
            wheel = max(wheel, 1.0 - smoothstep(0.25, 0.6, abs(abs(q - lc) - 0.85)));
          }
          col *= 1.0 - 0.1 * wheel * inMid;
          if (med > 0.0 && av < med && inMid > 0.5) {
            gzMedian = 1.0;
            // 中央分隔带：花岗岩路缘 + 绿篱（在路口处断开）
            col = av < med - 0.3 ? mix(vec3(0.1, 0.19, 0.07), vec3(0.2, 0.28, 0.1), n2) : vec3(0.5, 0.49, 0.46);
            rough = 0.9;
          } else {
            // 停止线 + 斑马线：位于本路段自身范围内、紧贴路口（靠右行驶：+v 侧驶向 s1）
            float zS = jS * step(s0 + 0.6, ua) * step(ua, s0 + 5.2);
            float zE = jE * step(s1 - 5.2, ua) * step(ua, s1 - 0.6);
            float zebra = step(0.5, fract(va / 1.0)) * step(av, W * 0.5 - 0.8) * max(zS, zE);
            float fu = max(fwidth(ua), 0.01);
            float stopS = oneway ? 0.0 : jS * (1.0 - smoothstep(0.2, 0.2 + fu, abs(ua - (s0 + 6.2)))) * step(va, 0.0);
            float stopE = jE * (1.0 - smoothstep(0.2, 0.2 + fu, abs(ua - (s1 - 6.2)))) * (oneway ? 1.0 : step(0.0, va));
            float stop = max(stopS, stopE) * step(med, av) * step(av, W * 0.5 - 0.8);
            float runS = s0 + (jS > 0.5 ? 6.5 : 0.0);
            float runE = s1 - (jE > 0.5 ? 6.5 : 0.0);
            float inRun = step(runS, ua) * step(ua, runE);
            if (!oneway && med == 0.0) {
              // 双黄中心线
              float dy = min(abs(va - 0.18), abs(va + 0.18));
              line = max(line, (1.0 - smoothstep(0.07, 0.07 + pxw, dy)) * inRun);
              if (av < 0.3) lcol = vec3(0.85, 0.62, 0.12);
            }
            for (float i = 1.0; i < 6.0; i += 1.0) {
              if (i >= lanesN) break;
              float dash = step(0.45, fract(ua / 9.0));
              line = max(line, (1.0 - smoothstep(0.07, 0.07 + pxw, abs(q - i * lw))) * dash * inRun);
            }
            // 导向箭头：路口前的直行箭头（简化为车道中央的短粗线）
            float arrow = 0.0;
            if (lanesN >= 2.0) {
              float ra = oneway ? s1 - ua : (va > 0.0 ? s1 - ua : ua - s0);
              float jA = oneway ? jE : (va > 0.0 ? jE : jS);
              float lcA = (floor(q / lw) + 0.5) * lw;
              arrow = jA * step(14.0, ra) * step(ra, 19.0) * (1.0 - smoothstep(0.16, 0.16 + pxw, abs(q - lcA)));
            }
            float eL = W * 0.5 - 0.55;
            line = max(line, (1.0 - smoothstep(0.08, 0.08 + pxw, abs(av - eL))) * inMid);
            ${paintOnly ? '' : 'line = max(line, max(max(zebra, stop), arrow));'}
          }
        }
        ${paintOnly ? 'if(max(line,gzMedian)<.2)discard;' : ''}
        col = mix(col, lcol * 0.75, line * 0.9);
        col *= 1.0 - uWet * 0.25;
        diffuseColor.rgb = col;
        float gzRough = mix(rough, 0.55, line) - uWet * 0.55;
        `,
        'after',
      ],
      ['roughnessmap_fragment', 'roughnessFactor = clamp(gzRough, 0.06, 1.0);', 'after'],
    ],
  });
}

// ============ 江堤：花岗岩条石、水渍线、石栏杆、夜间洗墙灯 ============
export function makeWallMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide });
  return patchMaterial(m, {
    key: 'wall',
    vPars: `${WORLD_VPARS} attribute float aS; varying float vS;`,
    vMain: `${WORLD_VMAIN} vS = aS;`,
    fPars: `varying vec3 vWPos; varying float vS; uniform float uWet; uniform float uStreetOn; uniform float uLights;`,
    replace: [
      [
        'color_fragment',
        `
        float y = vWPos.y;
        vec2 bp = vec2(vS / 1.3 + floor(y / 0.45) * 0.5, y / 0.45);
        float fine = 1.0 - smoothstep(0.2, 0.5, max(fwidth(bp.x), fwidth(bp.y)));
        float joint = max(smoothstep(0.94, 1.0, fract(bp.x)), smoothstep(0.9, 1.0, fract(bp.y)));
        vec3 col = vec3(0.44, 0.42, 0.39) * (0.86 + 0.18 * gzH21(floor(bp)) * fine);
        col = mix(col, col * 0.72, joint * fine);
        float wl = smoothstep(-2.4, -1.6, y) * (1.0 - smoothstep(-1.2, -0.6, y));
        col = mix(col, vec3(0.16, 0.17, 0.12), wl * 0.7);
        col = mix(col, col * 0.55, 1.0 - smoothstep(-2.5, -1.8, y));
        if (y > 0.0) {
          // 石栏杆：望柱 + 栏板
          float post = step(0.82, fract(vS / 2.4));
          col = vec3(0.62, 0.6, 0.56) * (0.92 + 0.1 * gzNoise(vec2(vS * 3.0, y * 4.0)));
          col = mix(col, col * 0.85, post * 0.5);
          col *= mix(0.8, 1.05, smoothstep(0.75, 0.95, y));
        }
        diffuseColor.rgb = col * (1.0 - uWet * 0.2);
        float lampSpot = (1.0 - smoothstep(0.0, 0.35, abs(fract(vS / 6.0) - 0.5))) ;
        float wash = smoothstep(-1.9, -0.2, y) * (1.0 - step(0.0, y));
        vec3 gzWallE = vec3(1.0, 0.72, 0.4) * wash * (0.35 + 0.65 * lampSpot) * 0.55 * uStreetOn * uLights;
        `,
        'after',
      ],
      ['roughnessmap_fragment', 'roughnessFactor = 0.85 - uWet * 0.45;', 'after'],
      ['emissivemap_fragment', 'totalEmissiveRadiance += gzWallE;', 'after'],
    ],
  });
}

// ============ 树木（树冠噪声明暗 + 随风摆动）============
// 超出切换距离的树由远景公告板绘制，这里整棵塌缩为一点（略放宽 25 m，与公告板交界处宁可重叠不留空隙）
const TREE_LOD_CULL = /* glsl */ `if (distance(instanceMatrix[3].xyz, cameraPosition) > uTreeLod.x + 25.0) transformed = vec3(0.0);`;

export function makeTreeMaterial(kind) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  return patchMaterial(m, {
    key: `tree-${kind}`,
    vPars: `attribute float aLeaf; attribute vec3 aTint; varying float vLeaf; varying vec3 vTint; varying vec3 vTW; uniform float uTime; uniform vec2 uTreeLod;`,
    vReplace: [
      [
        'begin_vertex',
        `{
          vec3 org = vec3(instanceMatrix[3].x, 0.0, instanceMatrix[3].z);
          float sway = sin(uTime * 1.3 + org.x * 0.05 + org.z * 0.07) * 0.5 + sin(uTime * 2.7 + org.z * 0.11) * 0.25;
          float hk = max(position.y, 0.0);
          transformed.x += sway * 0.018 * hk * hk * aLeaf * 0.08;
          transformed.z += sway * 0.012 * hk * hk * aLeaf * 0.08;
          ${TREE_LOD_CULL}
        }`,
        'after',
      ],
    ],
    vMain: `vLeaf = aLeaf; vTint = aTint; { vec4 wp = instanceMatrix * vec4(transformed, 1.0); vTW = (modelMatrix * wp).xyz; }`,
    fPars: `varying float vLeaf; varying vec3 vTint; varying vec3 vTW; uniform float uWet;`,
    replace: [
      [
        'color_fragment',
        `{
          float ln = gzNoise(vTW.xz * 0.9 + vTW.y * 0.7) * 0.6 + gzNoise(vTW.xy * 2.3 + vTW.z) * 0.4;
          vec3 c = diffuseColor.rgb;
          if (vLeaf > 0.5) { c *= vTint * (0.72 + 0.5 * ln); }
          diffuseColor.rgb = c * (1.0 - uWet * 0.12);
        }`,
        'after',
      ],
      ['roughnessmap_fragment', 'roughnessFactor = mix(0.95, 0.6, vLeaf * uWet);', 'after'],
    ],
  });
}

// 棕榈叶：程序化羽状叶透明贴图
export function makeFrondMaterial(tex, kind) {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.8, color: 0xffffff });
  return patchMaterial(m, {
    key: `frond-${kind}`,
    vPars: `attribute vec3 aTint; varying vec3 vTint; uniform float uTime; uniform vec2 uTreeLod;`,
    vReplace: [
      [
        'begin_vertex',
        `{
          vec3 org = vec3(instanceMatrix[3].x, 0.0, instanceMatrix[3].z);
          float sway = sin(uTime * 1.7 + org.x * 0.07 + org.z * 0.05 + position.x * 0.3);
          float r = length(position.xz);
          transformed.y += sway * 0.05 * r;
          transformed.xz += normalize(position.xz + 1e-4) * sway * 0.02 * r;
          ${TREE_LOD_CULL}
        }`,
        'after',
      ],
    ],
    vMain: `vTint = aTint;`,
    fPars: `varying vec3 vTint;`,
    replace: [['color_fragment', 'diffuseColor.rgb *= vTint;', 'after']],
  });
}

// 远景树公告板：每棵树一个始终朝向相机的四边形，片元里画出树冠轮廓（阔叶树团状、棕榈星状、木棉稀疏）
// 与细树干，并用球面法线参与光照与阴影。每棵约 2 个三角形，替代 1 km 外的三维树模型。
// uBB[种类] = (树冠中心高度, 水平半径, 竖直半径, 树干半宽)，均为单位缩放下的米数；树种顺序与 TREE 枚举一致。
export const TREE_BB = [
  { bb: [9.6, 9.5, 4.0, 0.8], leaf: [0.13, 0.24, 0.08], bark: [0.2, 0.17, 0.14] },
  { bb: [17.6, 5.2, 2.6, 0.24], leaf: [0.07, 0.19, 0.04], bark: [0.62, 0.6, 0.56] },
  { bb: [6.8, 3.2, 1.8, 0.2], leaf: [0.07, 0.18, 0.04], bark: [0.4, 0.34, 0.27] },
  { bb: [12.0, 5.0, 5.2, 0.35], leaf: [0.2, 0.3, 0.11], bark: [0.36, 0.33, 0.29] },
  { bb: [6.9, 4.2, 3.2, 0.2], leaf: [0.17, 0.29, 0.1], bark: [0.2, 0.17, 0.14] },
];
export function makeTreeBillboardMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  return patchMaterial(m, {
    key: 'tree-bb',
    uniforms: {
      uBB: { value: TREE_BB.map((t) => new THREE.Vector4(...t.bb)) },
      uBBLeaf: { value: TREE_BB.map((t) => new THREE.Vector3(...t.leaf)) },
      uBBBark: { value: TREE_BB.map((t) => new THREE.Vector3(...t.bark)) },
    },
    vPars: `attribute vec4 aB0; attribute vec2 aB1; attribute vec3 aTint; uniform vec4 uBB[5]; uniform vec2 uTreeLod; uniform float uPxAng;
      varying vec4 vBQ; varying vec2 vBP; varying vec3 vBTint; varying vec2 vBK;`,
    vReplace: [
      ['beginnormal_vertex', 'vec3 objectNormal = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);', 'replace'],
      [
        'begin_vertex',
        `vec4 bbP = uBB[int(aB1.x + 0.5)] * aB0.w;
         float bbD = distance(aB0.xyz, cameraPosition);
         // 很远时树冠至少保持约 2.6 像素宽，避免亚像素的树冠时隐时现、成片绿地变稀
         bbP.yz *= max(1.0, 1.3 * bbD * uPxAng / bbP.y);
         vec3 bbC = aB0.xyz + vec3(0.0, bbP.x, 0.0);
         vec3 bbR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
         vec3 bbU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
         // 俯视时树冠呈圆形、树干缩短到看不见
         float bbUp = abs(normalize(bbC - cameraPosition).y);
         float bbRy = mix(bbP.z, bbP.y, bbUp);
         float bbTl = bbP.x * (1.0 - bbUp);
         float bbQy = mix(-max(bbTl, bbRy), bbRy, position.y);
         vec3 transformed = bbC + bbR * position.x * bbP.y + bbU * bbQy;
         if (bbD < uTreeLod.x || bbD > uTreeLod.y) transformed = bbC;
         vBQ = vec4(position.x, bbQy / bbRy, bbTl / bbRy, bbP.w / bbP.y);
         vBP = vec2(bbD, bbP.y);
         vBTint = aTint; vBK = aB1;`,
        'replace',
      ],
    ],
    fPars: `uniform vec3 uBBLeaf[5]; uniform vec3 uBBBark[5]; uniform float uWet; uniform float uPxAng;
      varying vec4 vBQ; varying vec2 vBP; varying vec3 vBTint; varying vec2 vBK;`,
    replace: [
      [
        'color_fragment',
        `int bbK = int(vBK.x + 0.5);
        vec2 bbQ = vBQ.xy;
        float bbAng = atan(bbQ.y, bbQ.x);
        float bbEdge = (bbK == 1 || bbK == 2)
          ? 0.4 + 0.6 * pow(abs(cos(bbAng * 4.0 + vBK.y * 6.283)), 1.5)
          : 0.8 + 0.2 * gzNoise(vec2(bbAng * 2.2 + vBK.y * 17.0, vBK.y * 5.0));
        float bbR2 = dot(bbQ, bbQ) / (bbEdge * bbEdge);
        bool bbCrown = bbR2 < 1.0 && !(bbK == 3 && gzNoise(bbQ * 3.2 + vBK.y * 11.0) < 0.28);
        float bbPx = vBP.x * uPxAng * 0.55 / vBP.y;
        bool bbTrunk = !bbCrown && bbQ.y < 0.0 && bbQ.y > -vBQ.z && abs(bbQ.x) < max(vBQ.w, bbPx);
        if (!bbCrown && !bbTrunk) discard;
        vec3 bbCol = bbCrown
          ? uBBLeaf[bbK] * vBTint * (0.72 + 0.5 * gzNoise(bbQ * 4.0 + vBK.y * 23.0)) * mix(0.55, 1.0, clamp(bbQ.y * 0.5 + 0.5, 0.0, 1.0))
          : uBBBark[bbK];
        diffuseColor.rgb = bbCol * (1.0 - uWet * 0.12);`,
        'after',
      ],
      [
        'normal_fragment_begin',
        `float faceDirection = 1.0;
        vec3 normal = bbCrown
          ? normalize(vec3(bbQ.x, bbQ.y * 0.8 + 0.25, sqrt(max(1.0 - bbR2, 0.0)) + 0.15))
          : normalize(vec3(sign(bbQ.x) * 0.4, 0.0, 1.0));
        vec3 nonPerturbedNormal = normal;`,
        'replace',
      ],
    ],
  });
}

// ============ 路灯灯头、灯光投影 ============
export function makeLampHeadMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.35, metalness: 0.1 });
  return patchMaterial(m, {
    key: 'lamphead',
    fPars: `uniform float uStreetOn; uniform float uLights;`,
    replace: [['emissivemap_fragment', 'totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * 4.5 * uStreetOn * uLights;', 'after']],
  });
}

export function makePoolMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uStreetOn: U.uStreetOn, uLights: U.uLights },
    vertexShader: /* glsl */ `
      attribute float aType; varying vec2 vUv; varying float vType;
      void main(){ vUv = position.xz; vType = aType;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uStreetOn; uniform float uLights; varying vec2 vUv; varying float vType;
      void main(){ float r = length(vUv) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.2);
        vec3 c = vType > 2.5 ? vec3(1.0, 0.6, 0.3) * 1.5 : vType > 0.5 && vType < 1.5 ? vec3(1.0, 0.7, 0.42) : vec3(1.0, 0.76, 0.5);
        gl_FragColor = vec4(c * a * 0.3 * uStreetOn * uLights, 1.0); }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
    fog: false,
  });
}

export function makeConcreteMaterial(color = 0x9a978f, key = 'concrete') {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  return patchMaterial(m, {
    key,
    vPars: WORLD_VPARS,
    vMain: WORLD_VMAIN,
    fPars: `varying vec3 vWPos; uniform float uWet;`,
    replace: [['color_fragment', 'diffuseColor.rgb *= (0.88 + 0.16 * gzNoise(vWPos.xz * 0.3 + vWPos.y * 0.5)) * (1.0 - uWet * 0.18);', 'after']],
  });
}

// 桥梁 / 高架 / 灯带用的自发光材质
export function makeGlowMaterial(color, strength = 3, mode = 'night') {
  const c = new THREE.Color(color);
  const m = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.2 });
  return patchMaterial(m, {
    key: `glow-${mode}`,
    uniforms: { uGlowC: { value: c }, uGlowK: { value: strength } },
    vPars: WORLD_VPARS,
    vMain: WORLD_VMAIN,
    fPars: `uniform vec3 uGlowC; uniform float uGlowK; uniform float uStreetOn; uniform float uLights; uniform float uTime; varying vec3 vWPos;`,
    replace: [
      [
        'emissivemap_fragment',
        mode === 'chase'
          ? 'totalEmissiveRadiance += uGlowC * uGlowK * uStreetOn * uLights * (0.55 + 0.45 * sin(vWPos.x * 0.05 + vWPos.z * 0.05 - uTime * 2.0));'
          : 'totalEmissiveRadiance += uGlowC * uGlowK * uStreetOn * uLights;',
        'after',
      ],
    ],
  });
}

// 簕杜鹃花槽：高架桥两侧的紫红色花带
export function makeFlowerMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  return patchMaterial(m, {
    key: 'flower',
    vPars: WORLD_VPARS,
    vMain: WORLD_VMAIN,
    fPars: `varying vec3 vWPos;`,
    replace: [
      [
        'color_fragment',
        `{ float n = gzNoise(vWPos.xz * 1.1 + vWPos.y) * 0.6 + gzNoise(vWPos.xz * 3.7) * 0.4;
           vec3 leaf = vec3(0.09, 0.2, 0.06);
           vec3 bloom = mix(vec3(0.62, 0.05, 0.3), vec3(0.8, 0.12, 0.42), gzNoise(vWPos.xz * 0.3));
           diffuseColor.rgb = mix(leaf, bloom, smoothstep(0.38, 0.62, n)); }`,
        'after',
      ],
    ],
  });
}
