// 地形网格：越秀山与北部远山（高度场见 geo.height）。城区附近用 30 m 原始精度（与道路、建筑、地块的
// 贴地高度完全一致），更远处每 3 格取 1（90 m）；只为有起伏的格子生成三角形，其余地面仍是平面。

import * as THREE from 'three';

function mesh(geo, i0, j0, i1, j1, step, keep) {
  const G = geo.T;
  const nx = Math.floor((i1 - i0) / step) + 1;
  const nz = Math.floor((j1 - j0) / step) + 1;
  const hAt = (i, j) => G.data[Math.min(G.nz - 1, j) * G.nx + Math.min(G.nx - 1, i)] / 10;
  const pos = new Float32Array(nx * nz * 3);
  for (let b = 0; b < nz; b++) {
    for (let a = 0; a < nx; a++) {
      const i = i0 + a * step;
      const j = j0 + b * step;
      const k = (b * nx + a) * 3;
      pos[k] = G.x0 + i * G.cs;
      pos[k + 1] = hAt(i, j);
      pos[k + 2] = G.z0 + j * G.cs;
    }
  }
  const idx = [];
  for (let b = 0; b < nz - 1; b++) {
    for (let a = 0; a < nx - 1; a++) {
      const v00 = b * nx + a;
      const v10 = v00 + 1;
      const v01 = v00 + nx;
      const v11 = v01 + 1;
      const hs = [pos[v00 * 3 + 1], pos[v10 * 3 + 1], pos[v01 * 3 + 1], pos[v11 * 3 + 1]];
      if (Math.max(...hs) < 0.02 || !keep(i0 + a * step, j0 + b * step)) continue;
      // 沿 00–11 对角线分成两个三角形（与 geo.height 的插值规则一致），法线朝上
      idx.push(v00, v01, v11, v00, v11, v10);
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function buildTerrainMeshes(geo, matNear, matFar, city, margin = 1500) {
  const group = new THREE.Group();
  const G = geo.T;
  if (!G) return group;
  const ci = (x) => Math.max(0, Math.min(G.nx - 1, Math.round((x - G.x0) / G.cs)));
  const cj = (z) => Math.max(0, Math.min(G.nz - 1, Math.round((z - G.z0) / G.cs)));
  const ni0 = ci(city.x0 - margin);
  const ni1 = ci(city.x1 + margin);
  const nj0 = cj(city.z0 - margin);
  const nj1 = cj(city.z1 + margin);
  const near = mesh(geo, ni0, nj0, ni1, nj1, 1, () => true);
  if (near) {
    const m = new THREE.Mesh(near, matNear);
    m.castShadow = true;
    m.receiveShadow = true;
    m.layers.set(1);
    group.add(m);
  }
  // 远处：与近处范围重叠一格，由近处网格的深度偏移盖住，避免接缝
  const step = 3;
  const inNear = (i, j) => i >= ni0 + step && i < ni1 - step && j >= nj0 + step && j < nj1 - step;
  const far = mesh(geo, 0, 0, G.nx - 1, G.nz - 1, step, (i, j) => !inNear(i, j));
  if (far) {
    const m = new THREE.Mesh(far, matFar);
    m.receiveShadow = true;
    m.layers.set(1);
    group.add(m);
  }
  return group;
}
