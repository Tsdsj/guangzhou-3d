// 精细建筑块落位核查（默认清单 + 暂存清单）：参数包哈希、源控制点残差、实际替换的旧渲染记录、
// 填充体交叠、邻楼轮廓交叠、树干落入轮廓以及按实际树冠几何估算的树冠—轮廓平面交叠。
// 用法：node --import ./tools/lib/three-alias.mjs tools/verify-detail-placement.mjs
// 控制点残差为 0 只说明同一份源数据在代码中映射一致，不代表现实测绘精度。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { loadCity } from '../src/world/data.js';
import { classifyDetails, polygonsOverlap } from '../src/world/detail-spatial.js';
import { buildSample as productionSample } from '../src/models/detail-models.js';
import { buildSample as prototypeSample } from '../prototypes/p2/models.js';
import { measureModel } from '../src/models/model-preflight.js';
import { makeTreeGeometries } from '../src/scene/geometries.js';
import { BLD, TREE_REC } from '../src/world/schema.js';
import { TREE } from '../src/world/city.js';

const read = (p) => JSON.parse(fs.readFileSync(p));
const hash = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for (const [p, h] of Object.entries(read('.research/p2/main-data-baseline.json'))) if (hash(p) !== h) throw new Error(`Base changed ${p}`);
globalThis.fetch = async (url) => new Response(fs.readFileSync(String(url).replace(/^\.\//, '')));
const D = await loadCity();
await D.vegReady;

// 树冠平面半径与高度取自实际渲染几何（缩放 1 时），按记录中的缩放系数放大
const tg = makeTreeGeometries();
const extent = (geos) => {
  let r = 0, top = 0;
  for (const g of [].concat(geos)) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i))); top = Math.max(top, p.getY(i)); }
  }
  return { r, top };
};
const crowns = {
  [TREE.BANYAN]: { name: 'banyan', ...extent(tg.banyan) },
  [TREE.BROAD]: { name: 'broad', ...extent(tg.broad) },
  [TREE.KAPOK]: { name: 'kapok', ...extent(tg.kapok) },
  [TREE.PALM]: { name: 'palm', r: extent(tg.frond).r, top: tg.palmTop + 0.6 },
  [TREE.FANPALM]: { name: 'fanpalm', r: extent(tg.fan).r, top: tg.fanTop + 0.9 },
};
const distToPoly = (x, z, poly) => {
  let inside = false, min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    min = Math.min(min, Math.hypot(x - ax - t * dx, z - az - t * dz));
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside ? -min : min;
};
const rendered = Array.from({ length: D.nBuildings }, (_, i) => {
  const ri = D.S.bldMeta[i * BLD.N + BLD.RING0], p0 = D.S.bldRings[ri * 2], n = D.S.bldRings[ri * 2 + 1];
  return { id: D.buildingSourceIds[i], poly: Array.from({ length: n }, (_, k) => [D.S.bldPts[(p0 + k) * 2], D.S.bldPts[(p0 + k) * 2 + 1]]) };
});

function checkManifest(manifestPath, staged) {
  const manifest = read(manifestPath);
  const groups = classifyDetails(D, manifest);
  const owners = new Map(), rows = [];
  for (const tile of manifest.tiles.filter((t) => t.kind === 'buildings' && (!staged || t.trialOnly))) {
    const file = tile.url.replace(/^\.\//, ''), bytes = fs.readFileSync(file);
    if (bytes.length !== tile.bytes || hash(file) !== tile.sha256) throw new Error(`Payload hash/bytes mismatch ${tile.id}`);
    const payload = JSON.parse(bytes);
    const build = tile.trialOnly ? prototypeSample : productionSample;
    for (const b of tile.buildings) {
      for (const id of b.replaceIds) {
        if (owners.has(id)) throw new Error(`${id} replaced by ${owners.get(id)} and ${tile.id}`);
        owners.set(id, tile.id);
      }
      const sample = build(b.sampleId, payload.samples);
      const matrix = new T.Matrix4().compose(new T.Vector3(...b.position), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), b.rotationY), new T.Vector3(...b.scale));
      const controls = sample.planBoundary.map(([x, z]) => new T.Vector3(x, 0, z).applyMatrix4(matrix));
      const residual = Math.max(...controls.map((p) => Math.min(...b.footprint.map((q) => Math.hypot(p.x - q[0], p.z - q[1])))));
      const det = matrix.elements[0] * matrix.elements[10] - matrix.elements[8] * matrix.elements[2];
      const physical = measureModel(sample.group, sample.planBoundary);
      const replacedRender = D.buildingSourceIds.filter((id) => groups.sourceTiles.get(id) === tile.id && b.replaceIds.includes(id));
      const neighbours = rendered.filter((r) => !b.replaceIds.includes(r.id) && polygonsOverlap(r.poly, b.footprint)).map((r) => r.id);
      const trees = { centresInside: 0, crownOverlaps: [], bySpecies: {} };
      D.trees.forEach((list, sp) => {
        const c = crowns[sp];
        for (let o = 0; o < list.length; o += TREE_REC.N) {
          const x = list[o + TREE_REC.X], z = list[o + TREE_REC.Z], s = list[o + TREE_REC.S];
          const d = distToPoly(x, z, b.footprint);
          if (d < 0) trees.centresInside++;
          if (d < c.r * s) {
            trees.crownOverlaps.push({ species: c.name, x: +x.toFixed(1), z: +z.toFixed(1), scale: s, crownRadiusM: +(c.r * s).toFixed(2), trunkToFootprintM: +d.toFixed(2), crownTopM: +(c.top * s).toFixed(1) });
            trees.bySpecies[c.name] = (trees.bySpecies[c.name] || 0) + 1;
          }
        }
      });
      if (residual > 0.02 || det <= 0 || physical.nonFiniteValues) throw new Error(`Placement check failed: ${b.sampleId}`);
      rows.push({
        tile: tile.id, staged: !!tile.trialOnly, sampleId: b.sampleId, sourceId: b.sourceId, replaceIds: b.replaceIds,
        replacedRenderRecords: replacedRender, fillRecordsGrouped: [...groups.fillTiles.values()].filter((id) => id === tile.id).length,
        sourceControlResidualM: residual, horizontalDeterminant: det, modelTopM: +physical.maxY.toFixed(3), maxPlanOverhangM: +physical.maxPlanOverhangM.toFixed(3),
        neighbourFootprintOverlaps: neighbours, treeCentresInsideFootprint: trees.centresInside, treeCrownPlanOverlaps: trees.crownOverlaps.length, treeCrownOverlapsBySpecies: trees.bySpecies,
        treeCrownOverlapSamples: trees.crownOverlaps.sort((a, q) => a.trunkToFootprintM - q.trunkToFootprintM).slice(0, 6),
        precision: b.precision, label: b.label?.name ?? null, integration: b.integration ?? null,
      });
    }
  }
  return rows;
}

const rows = checkManifest('data/detail/manifest.json', false);
const staged = checkManifest('data/detail/trial-manifest.json', true);
const report = {
  date: new Date().toISOString().slice(0, 10),
  basis: 'fixed OSM snapshot outlines in the existing city-local frame; residuals show internal mapping consistency only, not field accuracy',
  crownModel: Object.fromEntries(Object.values(crowns).map((c) => [c.name, { radiusAtScale1M: +c.r.toFixed(2), topAtScale1M: +c.top.toFixed(2) }])),
  crownNote: 'trees are procedural (not surveyed); a plan overlap means the rendered crown can touch or pass through the facade envelope; trees are kept, not removed',
  defaultBuildings: rows,
  stagedBuildings: staged,
};
fs.mkdirSync('docs/research/p3-acceptance', { recursive: true });
fs.writeFileSync('docs/research/p3-acceptance/placement.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(rows.map(({ sampleId, tile, replacedRenderRecords, fillRecordsGrouped, sourceControlResidualM, modelTopM, neighbourFootprintOverlaps, treeCentresInsideFootprint, treeCrownPlanOverlaps, treeCrownOverlapsBySpecies }) => ({ sampleId, tile, replacedRenderRecords, fillRecordsGrouped, sourceControlResidualM, modelTopM, neighbourFootprintOverlaps, treeCentresInsideFootprint, treeCrownPlanOverlaps, treeCrownOverlapsBySpecies })), null, 1));
console.log('staged', staged.length);
