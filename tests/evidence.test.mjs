import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Missing modules are reported as a capability assertion during the initial red run.
const optional = async (path) => import(path).catch((e) => { if (e.code === 'ERR_MODULE_NOT_FOUND') return {}; throw e; });
const osm = await optional('../tools/osm-source.mjs');
const evidence = await optional('../tools/evidence.mjs');
const runtime = await optional('../src/world/evidence.js');
const requireFn = (api, key) => { assert.equal(typeof api[key], 'function', `${key} must be implemented`); return api[key]; };

test('OSM 归一化保留真实节点 ID、版本及 via-way 成员', () => {
  const normalize = requireFn(osm, 'normalizeOSM');
  const result = normalize({ elements: [
    { type: 'node', id: 1, lon: 113, lat: 23 }, { type: 'node', id: 2, lon: 113.001, lat: 23 },
    { type: 'way', id: 10, version: 3, timestamp: '2026-09-01T00:00:00Z', nodes: [2, 1], tags: { highway: 'primary', oneway: '-1' } },
    { type: 'relation', id: 20, tags: { type: 'restriction', restriction: 'no_u_turn' }, members: [
      { type: 'way', ref: 10, role: 'from' }, { type: 'way', ref: 11, role: 'via' }, { type: 'way', ref: 12, role: 'to' },
    ] },
  ] }, { id: 'sample', timestamp: '2026-09-25T00:00:00Z' });
  const way = result.els.find((e) => e.k === 'w');
  assert.deepEqual(way.nodes, [2, 1]);
  assert.deepEqual(way.g, [[113.001, 23], [113, 23]]);
  assert.equal(way.version, 3);
  assert.equal(way.timestamp, '2026-09-01T00:00:00Z');
  assert.deepEqual(result.els.find((e) => e.k === 'r').m.map((m) => [m.k, m.ref, m.r]), [['w', 10, 'from'], ['w', 11, 'via'], ['w', 12, 'to']]);
});

test('缺失的中间节点不会被悄悄删除并生成跨越缺口的线', () => {
  const normalize = requireFn(osm, 'normalizeOSM');
  const result = normalize({ elements: [
    { type: 'node', id: 1, lon: 113, lat: 23 }, { type: 'node', id: 3, lon: 114, lat: 23 },
    { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'footway' } },
  ] });
  const way = result.els.find((e) => e.k === 'w');
  assert.deepEqual(way.nodes, [1, 2, 3]);
  assert.deepEqual(way.g, []);
  assert.equal(way.geometryStatus, 'incomplete');
});

test('拓扑以节点身份连接，平面重合的两个节点不合并，地下路径不丢失', () => {
  const compile = requireFn(evidence, 'compileNetwork');
  const network = compile({ id: 'test', els: [
    { k: 'n', id: 1, g: [[113, 23]], t: {} }, { k: 'n', id: 2, g: [[113.1, 23]], t: {} },
    { k: 'n', id: 3, g: [[113.1, 23]], t: {} }, { k: 'n', id: 4, g: [[113.2, 23]], t: {} },
    { k: 'w', id: 10, nodes: [1, 2], g: [[113, 23], [113.1, 23]], t: { highway: 'primary', oneway: 'yes' } },
    { k: 'w', id: 11, nodes: [3, 4], g: [[113.1, 23], [113.2, 23]], t: { highway: 'footway', tunnel: 'yes', layer: '-1' } },
  ] });
  assert.deepEqual(network.nodes['osm:n2'].wayIds, ['osm:w10']);
  assert.deepEqual(network.nodes['osm:n3'].wayIds, ['osm:w11']);
  assert.equal(network.ways['osm:w11'].tags.tunnel, 'yes');
  assert.equal(network.ways['osm:w11'].transportClass, 'pedestrian');
  assert.equal(network.ways['osm:w10'].fields.width.status, 'unknown');
});

test('P0 样区的11条限制（含4条via-way）完整保留，且不冒充全城覆盖', () => {
  const normalize = requireFn(osm, 'normalizeOSM');
  const compile = requireFn(evidence, 'compileNetwork');
  const raw = JSON.parse(fs.readFileSync('docs/research/p0-2026-09-25/source-samples/osm-huacheng-map.json'));
  const network = compile({ ...normalize(raw), id: 'huacheng', bbox: [113.311, 23.1205, 113.3195, 23.124] });
  assert.equal(network.restrictions.length, 11);
  assert.equal(network.restrictions.filter((r) => r.members.some((m) => m.role === 'via' && m.type === 'way')).length, 4);
  assert.ok(network.restrictions.every((r) => r.status === 'complete'));
  assert.equal(Object.values(network.ways).filter((w) => w.tags.highway === 'footway').length, 131);
  assert.deepEqual(network.bbox, [113.311, 23.1205, 113.3195, 23.124]);
});

test('未解析的关系成员显式标缺失，而不静默丢弃规则', () => {
  const compile = requireFn(evidence, 'compileNetwork');
  const network = compile({ id: 'incomplete', els: [{ k: 'r', id: 9, t: { type: 'restriction', restriction: 'only_straight_on' }, m: [{ k: 'w', ref: 999, r: 'from' }] }] });
  assert.equal(network.restrictions.length, 1);
  assert.equal(network.restrictions[0].status, 'incomplete');
  assert.ok(network.restrictions[0].missing.includes('osm:w999'));
});

test('有来源的事实优先于推断；同级冲突保留，实测状态不能无证据生成', () => {
  const resolve = requireFn(runtime, 'resolveField');
  assert.equal(resolve([{ value: 13, status: 'estimated' }, { value: 4, status: 'reported', sourceId: 'osm', property: 'building:levels' }]).value, 4);
  assert.equal(resolve([{ value: 5, status: 'verified' }]).status, 'unknown');
  const conflict = resolve([{ value: 3, status: 'reported', sourceId: 'a' }, { value: 4, status: 'reported', sourceId: 'b' }]);
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.value, null);
});

test('未知背面不从正面克隆，未审核候选不能通过渲染替换入口', () => {
  const create = requireFn(runtime, 'createEvidenceIndex');
  const index = create({ version: 1, sources: {}, entities: { 'osm:w1': { id: 'osm:w1', facades: [{ id: 'front', coverage: 'partial', evidenceIds: ['photo'] }, { id: 'rear', coverage: 'unknown', evidenceIds: [] }] } }, networks: [], candidates: [{ id: 'ovt:a', review: { status: 'pending' } }] });
  assert.equal(index.getEntity('osm:w1').facades.find((f) => f.id === 'rear').coverage, 'unknown');
  assert.equal(index.getReplacement('ovt:a'), null);
  assert.equal(index.getEntity('missing'), null);
});

test('建筑身份不依赖数组位置，部件只有显式成员证据才归属父对象', () => {
  const build = requireFn(evidence, 'buildEvidence');
  const buildings = [
    { k: 'w', id: 1, t: { building: 'yes', height: '30 ft', 'building:colour': 'yellow' } },
    { k: 'w', id: 2, t: { 'building:part': 'yes', 'building:levels': '3' } },
    { k: 'r', id: 3, t: { type: 'building' }, m: [{ k: 'w', ref: 1, r: 'outline' }, { k: 'w', ref: 2, r: 'part' }] },
  ];
  const args = { buildings, roads: [], renderBuildingKeys: ['w1', 'w2'], renderRoadIds: [], sources: { osmCity: {} } };
  const a = build(args);
  const b = build({ ...args, buildings: [...buildings].reverse(), renderBuildingKeys: ['w2', 'w1'] });
  assert.deepEqual(a.entities['osm:w1'], b.entities['osm:w1']);
  assert.deepEqual(a.renderIdentity.buildings, ['osm:w1', 'osm:w2']);
  assert.deepEqual(b.renderIdentity.buildings, ['osm:w2', 'osm:w1']);
  assert.deepEqual(a.entities['osm:w2'].parentIds, ['osm:r3']);
  assert.equal(a.entities['osm:w1'].fields.height.value, 9.144);
  assert.equal(a.entities['osm:w1'].fields.height.status, 'reported');
  assert.equal(a.entities['osm:w2'].fields.height.status, 'unknown');
});

test('资料引用损坏或候选重复时构建失败，不产出看似可信的数据包', () => {
  const build = requireFn(evidence, 'buildEvidence');
  const args = { buildings: [{ k: 'w', id: 1, t: { building: 'yes' } }], roads: [], sources: { osmCity: {} }, renderBuildingKeys: ['w1'], renderRoadIds: [] };
  assert.throws(() => build({ ...args, facades: { entities: { 'osm:w9': [{ id: 'front' }] }, photos: {} } }), /unknown entity/i);
  assert.throws(() => build({ ...args, facades: { entities: { 'osm:w1': [{ id: 'front', evidenceIds: ['missing'] }] }, photos: {} } }), /unknown photo/i);
  const c = { id: 'ovt:a', review: { status: 'pending' }, geometry: { type: 'Polygon', coordinates: [] } };
  assert.throws(() => build({ ...args, candidates: [c, c] }), /duplicate candidate/i);
});
