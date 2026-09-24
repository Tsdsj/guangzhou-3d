// 地形：城区基本平坦（地面统一为 0 m），只抬升两类真实地形（高程来自公开 DEM：AWS Terrain Tiles / SRTM）：
//   · 越秀山：只在 OSM 越秀公园、山林与雕塑公园的范围内取 DEM（越井岗、镇海楼一带相对城区约 45 m）；
//   · 城区以北、以东的白云山、瘦狗岭一线远山。
// 城区范围内 DEM 混有建筑高度造成的噪点：越秀山用小窗口低分位去噪，远山只取“大尺度低分位平滑后
// 仍明显高于城区”的山区部分。缺少 data/raw/dem.* 时远山为 0，越秀山按公园轮廓合成一座缓丘。

import fs from 'node:fs';
import { proj, unproj, Grid, signedDistance, bbox } from './lib.mjs';

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// 三次盒式模糊 ≈ 高斯（半径 r 个网格）
function blur(src, nx, nz, r) {
  let a = src;
  for (let pass = 0; pass < 3; pass++) {
    const t = new Float32Array(a.length);
    const o = new Float32Array(a.length);
    for (let j = 0; j < nz; j++) {
      let s = 0;
      let n = 0;
      for (let i = -r; i < nx + r; i++) {
        if (i + r < nx) {
          s += a[j * nx + i + r];
          n++;
        }
        if (i - r - 1 >= 0) {
          s -= a[j * nx + i - r - 1];
          n--;
        }
        if (i >= 0 && i < nx) t[j * nx + i] = s / n;
      }
    }
    for (let i = 0; i < nx; i++) {
      let s = 0;
      let n = 0;
      for (let j = -r; j < nz + r; j++) {
        if (j + r < nz) {
          s += t[(j + r) * nx + i];
          n++;
        }
        if (j - r - 1 >= 0) {
          s -= t[(j - r - 1) * nx + i];
          n--;
        }
        if (j >= 0 && j < nz) o[j * nx + i] = s / n;
      }
    }
    a = o;
  }
  return a;
}

// 海拔（米）：terrarium 瓦片拼接的 DEM，按经纬度双线性取值；没有 DEM 时返回 null
function loadDem(demJson, demBin) {
  if (!fs.existsSync(demJson) || !fs.existsSync(demBin)) return null;
  const H = JSON.parse(fs.readFileSync(demJson, 'utf8'));
  const dem = new Int16Array(new Uint8Array(fs.readFileSync(demBin)).buffer);
  const N = 2 ** H.zoom * 256;
  return (lon, lat) => {
    const x = ((lon + 180) / 360) * N - H.tx0 * 256;
    const r = (lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N - H.ty0 * 256;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const g = (a, b) => dem[Math.min(H.height - 1, Math.max(0, b)) * H.width + Math.min(H.width - 1, Math.max(0, a))] / 10;
    return (g(i, j) * (1 - fx) + g(i + 1, j) * fx) * (1 - fy) + (g(i, j + 1) * (1 - fx) + g(i + 1, j + 1) * fx) * fy;
  };
}

// 窗口低分位（建筑会抬高 DEM 表面，30% 分位更接近真实地面）
function lowPercentile(raw, nx, nz, B, q = 0.3) {
  const low = new Float32Array(nx * nz);
  const win = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      win.length = 0;
      for (let b = -B; b <= B; b++) for (let a = -B; a <= B; a++) {
        const ii = i + a;
        const jj = j + b;
        if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) win.push(raw[jj * nx + ii]);
      }
      win.sort((p, q2) => p - q2);
      low[j * nx + i] = win[Math.floor(win.length * q)];
    }
  }
  return low;
}

// 远山（米，相对城区地面）：40 m 网格
function farMountains(elev, region) {
  if (!elev) return null;
  const cs = 40;
  const nx = Math.ceil((region.x1 - region.x0) / cs);
  const nz = Math.ceil((region.z1 - region.z0) / cs);
  const raw = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const [lon, lat] = unproj(region.x0 + (i + 0.5) * cs, region.z0 + (j + 0.5) * cs);
      raw[j * nx + i] = elev(lon, lat);
    }
  }
  const low = lowPercentile(raw, nx, nz, 3);
  const S = blur(raw, nx, nz, 1);
  const M = blur(low, nx, nz, 12);
  const out = new Float32Array(nx * nz);
  for (let k = 0; k < out.length; k++) out[k] = Math.max(0, S[k] - 15) * smoothstep(32, 55, M[k]);
  return { x0: region.x0, z0: region.z0, cs, nx, nz, h: out };
}

// 越秀山：在山体范围（公园、山林等多边形的并集）内取去噪后的 DEM 相对城区地面（约 14 m）的高度；
// 范围边缘 60 m 内渐变到 0，湖面及湖岸为 0。没有 DEM 时按轮廓合成：距边界越远越高，主峰越井岗一带最高。
function yuexiuHill(rings, sdAll, elev) {
  if (!rings.length) return null;
  const cs = 10;
  const bb = rings.map(bbox);
  const bx0 = Math.min(...bb.map((b) => b[0]));
  const bz0 = Math.min(...bb.map((b) => b[1]));
  const bx1 = Math.max(...bb.map((b) => b[2]));
  const bz1 = Math.max(...bb.map((b) => b[3]));
  const g = new Grid(bx0 - 80, bz0 - 80, cs, Math.ceil((bx1 - bx0 + 160) / cs), Math.ceil((bz1 - bz0 + 160) / cs));
  for (const r of rings) g.fillRings([r], 1, 'or');
  const sd = signedDistance(g.data, g.nx, g.nz, cs);
  let dem = null;
  if (elev) {
    const raw = new Float32Array(g.nx * g.nz);
    for (let j = 0; j < g.nz; j++) {
      for (let i = 0; i < g.nx; i++) {
        const [lon, lat] = unproj(g.x0 + (i + 0.5) * cs, g.z0 + (j + 0.5) * cs);
        raw[j * g.nx + i] = elev(lon, lat);
      }
    }
    dem = blur(lowPercentile(raw, g.nx, g.nz, 3), g.nx, g.nz, 4);
  }
  const [px, pz] = proj(113.2625, 23.143); // 越井岗（中山纪念碑）
  const h = new Float32Array(g.nx * g.nz);
  for (let j = 0; j < g.nz; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const din = -sd[k];
      // DEM 的山体可略超出公园轮廓（山坡延伸到周边院落，如山东麓的广东电视塔）
      if (din <= (dem ? -70 : 0)) continue;
      const x = g.x0 + (i + 0.5) * cs;
      const z = g.z0 + (j + 0.5) * cs;
      let v;
      if (dem) v = Math.max(0, dem[k] - 14) * 1.1 * smoothstep(-70, 30, din);
      else v = 48 * (0.55 + 0.45 * Math.exp(-(((x - px) ** 2 + (z - pz) ** 2) / (2 * 420 * 420)))) * smoothstep(0, 230, din) * smoothstep(0, 60, din);
      h[k] = v * smoothstep(4, 45, sdAll(x, z));
    }
  }
  return { x0: g.x0, z0: g.z0, cs, nx: g.nx, nz: g.nz, h: blur(h, g.nx, g.nz, 2) };
}

function sampler(G) {
  if (!G) return () => 0;
  return (x, z) => {
    let fx = (x - G.x0) / G.cs - 0.5;
    let fz = (z - G.z0) / G.cs - 0.5;
    if (fx < 0 || fz < 0 || fx > G.nx - 1 || fz > G.nz - 1) return 0;
    const i = Math.min(G.nx - 2, Math.floor(fx));
    const j = Math.min(G.nz - 2, Math.floor(fz));
    fx -= i;
    fz -= j;
    const k = j * G.nx + i;
    return (G.h[k] * (1 - fx) + G.h[k + 1] * fx) * (1 - fz) + (G.h[k + G.nx] * (1 - fx) + G.h[k + G.nx + 1] * fx) * fz;
  };
}

// 返回：grid = 输出给运行端的 30 m 节点高度场（Uint16，单位 0.1 m）；H(x, z) 按同一高度场双线性取值，
// 构建期摆放道路、建筑、树木等与运行端的地形网格完全一致
export function buildTerrain({ rawDir, hillRings, sdAll, region }) {
  const elev = loadDem(rawDir + 'dem.json', rawDir + 'dem.bin');
  const far = farMountains(elev, region);
  const hill = yuexiuHill(hillRings, sdAll, elev);
  const sFar = sampler(far);
  const sHill = sampler(hill);
  const cs = 30;
  const nx = Math.ceil((region.x1 - region.x0) / cs) + 1;
  const nz = Math.ceil((region.z1 - region.z0) / cs) + 1;
  const data = new Uint16Array(nx * nz);
  let max = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const v = sFar(region.x0 + i * cs, region.z0 + j * cs) + sHill(region.x0 + i * cs, region.z0 + j * cs);
      data[j * nx + i] = Math.round(Math.min(6500, v) * 10);
      if (v > max) max = v;
    }
  }
  const grid = { x0: region.x0, z0: region.z0, cs, nx, nz, data };
  return { H: heightAt(grid), grid, max, hasDem: !!far };
}

// 节点高度场取值：每格沿 (i, j)–(i+1, j+1) 对角线分成两个三角形线性插值，与运行端地形网格的三角形完全重合
// （运行端 src/world/geo.js 的 height() 使用同样的规则）
export function heightAt(G) {
  return (x, z) => {
    let fx = (x - G.x0) / G.cs;
    let fz = (z - G.z0) / G.cs;
    if (fx < 0 || fz < 0 || fx >= G.nx - 1 || fz >= G.nz - 1) return 0;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    fx -= i;
    fz -= j;
    const k = j * G.nx + i;
    const d = G.data;
    const h00 = d[k];
    const h11 = d[k + G.nx + 1];
    return (fx > fz ? h00 + fx * (d[k + 1] - h00) + fz * (h11 - d[k + 1]) : h00 + fz * (d[k + G.nx] - h00) + fx * (h11 - d[k + G.nx])) / 10;
  };
}
