import { unknownField } from '../src/world/evidence.js';

export const osmId = (e) => `osm:${e.k}${e.id}`;
const wordType = { n: 'node', w: 'way', r: 'relation' };
const reported = (tags, property, sourceId, numeric = false) => {
  const raw = tags[property];
  if (raw === undefined || raw === '') return unknownField();
  let value = raw;
  if (numeric) {
    const m = String(raw).trim().match(/^([+-]?\d+(?:[.,]\d+)?)\s*(m|ft)?$/i);
    const length = ['height', 'min_height', 'roof:height', 'width', 'ele'].includes(property);
    value = m && (!m[2] || length) ? Number(m[1].replace(',', '.')) * (m[2]?.toLowerCase() === 'ft' ? 0.3048 : 1) : null;
    if (value !== null && !['layer', 'ele'].includes(property) && value < 0) value = null;
  }
  return { value, status: value === null ? 'unknown' : 'reported', raw, sourceId, property };
};
const roadFields = (tags, sourceId) => Object.fromEntries(['width', 'lanes', 'lanes:forward', 'lanes:backward', 'ele', 'layer'].map((k) => [k, reported(tags, k, sourceId, true)]));

export function compileNetwork(input) {
  const sourceId = input.id;
  const nodes = {};
  const ways = {};
  for (const e of input.els) if (e.k === 'n' && e.g?.[0]) nodes[osmId(e)] = { id: osmId(e), lon: e.g[0][0], lat: e.g[0][1], tags: e.t, wayIds: [] };
  for (const e of input.els) if (e.k === 'w' && e.t.highway) {
    const id = osmId(e);
    const nodeIds = (e.nodes || []).map((n) => `osm:n${n}`);
    const missing = nodeIds.filter((n) => !nodes[n]);
    ways[id] = {
      id, nodeIds, geometry: e.g || [], tags: e.t, sourceId,
      transportClass: /^(footway|pedestrian|steps|path)$/.test(e.t.highway) ? 'pedestrian' : e.t.highway === 'cycleway' ? 'cycle' : 'road',
      // Classification is not a legal access decision: preserve all access/conditional tags.
      status: !nodeIds.length ? 'missing-node-identities' : missing.length ? 'incomplete' : 'complete',
      missing, fields: roadFields(e.t, sourceId),
    };
    for (const n of new Set(nodeIds)) if (nodes[n]) nodes[n].wayIds.push(id);
  }
  for (const node of Object.values(nodes)) node.wayIds.sort();
  const restrictions = input.els.filter((e) => e.k === 'r' && ['restriction', 'connectivity'].includes(e.t.type)).map((e) => {
    const members = (e.m || []).map((m) => ({ id: `osm:${m.k}${m.ref}`, type: wordType[m.k], role: m.r }));
    const missing = members.filter((m) => !(m.type === 'node' ? nodes[m.id] : m.type === 'way' ? ways[m.id] : null)).map((m) => m.id);
    const rolesPresent = ['from', 'via', 'to'].every((r) => members.some((m) => m.role === r));
    return { id: osmId(e), tags: e.t, members, sourceId, missing, status: missing.length || !rolesPresent ? 'incomplete' : 'complete' };
  });
  return { id: sourceId, bbox: input.bbox || null, coordinateSystem: 'WGS84 longitude,latitude', nodes, ways, restrictions, routingImplemented: false };
}

export function buildEvidence({ buildings, roads, renderBuildingKeys, renderRoadIds, sources, networkInputs = [], facades = {}, candidates = [] }) {
  const entities = {};
  for (const e of [...buildings, ...roads].sort((a, b) => osmId(a).localeCompare(osmId(b)))) {
    const id = osmId(e);
    const sourceId = e.sourceId || 'osmCity';
    if (!sources[sourceId]) throw new Error(`Unknown source: ${sourceId}`);
    entities[id] = {
      id, sourceId, sourceVersion: e.version ?? null, sourceModifiedAt: e.timestamp || null,
      kind: e.t.highway ? 'road' : e.t['building:part'] ? 'building-part' : e.t.type === 'building' ? 'building-relation' : 'building',
      tags: e.t,
      fields: e.t.highway ? roadFields(e.t, sourceId) : {
        height: reported(e.t, 'height', sourceId, true), levels: reported(e.t, 'building:levels', sourceId, true),
        minHeight: reported(e.t, 'min_height', sourceId, true),
        facadeColor: reported(e.t, 'building:colour', sourceId), facadeMaterial: reported(e.t, 'building:material', sourceId),
        roofShape: reported(e.t, 'roof:shape', sourceId), roofHeight: reported(e.t, 'roof:height', sourceId, true),
      },
      parentIds: [], memberIds: [], associationStatus: 'unresolved',
      // Old snapshots lost member refs; retaining the source does not certify old spatial heuristics.
      nodeIds: e.nodes?.map((n) => `osm:n${n}`) || null,
      facades: [],
    };
  }
  for (const e of buildings) if (e.k === 'r' && e.t.type === 'building') {
    const parent = entities[osmId(e)];
    for (const m of e.m || []) if (m.ref !== undefined && ['outline', 'part'].includes(m.r)) {
      const id = `osm:${m.k}${m.ref}`;
      if (!entities[id]) continue;
      parent.memberIds.push({ id, role: m.r });
      entities[id].parentIds.push(parent.id);
      entities[id].associationStatus = 'explicit';
    }
    if (parent.memberIds.length) parent.associationStatus = 'explicit';
  }
  const photos = facades.photos || {};
  for (const [id, faces] of Object.entries(facades.entities || {})) {
    if (!entities[id]) throw new Error(`Unknown entity in facade evidence: ${id}`);
    const ids = new Set();
    for (const face of faces) {
      if (!face.id || ids.has(face.id)) throw new Error(`Duplicate/missing facade ID: ${id}`);
      ids.add(face.id);
      for (const ref of face.evidenceIds || []) if (!photos[ref]) throw new Error(`Unknown photo: ${ref}`);
    }
    entities[id].facades = faces;
  }
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.id)) throw new Error(`Duplicate candidate: ${c.id}`);
    seen.add(c.id);
  }
  for (const c of candidates) {
    if (!c.id || !c.geometry || !['pending', 'approved', 'rejected'].includes(c.review?.status)) throw new Error('Invalid candidate');
    if (c.review.status === 'approved' && (!c.review.reviewedBy || !c.review.evidenceIds?.length)) throw new Error(`Candidate approval lacks evidence: ${c.id}`);
  }
  const renderIdentity = { buildings: renderBuildingKeys.map((key) => `osm:${key}`), roads: renderRoadIds.map((id) => `osm:w${id}`) };
  for (const id of [...renderIdentity.buildings, ...renderIdentity.roads]) if (!entities[id]) throw new Error(`Render record references unknown entity: ${id}`);
  const networks = networkInputs.map(compileNetwork);
  return {
    version: 1, coordinateSystem: 'WGS84 longitude,latitude; heights are relative unless documented',
    sources, entities, renderIdentity, photos, networks, candidates,
    coverage: { topology: networks.map((n) => ({ id: n.id, bbox: n.bbox })), facadeEntityIds: Object.keys(facades.entities || {}) },
    precision: { absolutePosition: 'unverified', measuredHeight: 'unverified', allFacades: 'incomplete' },
  };
}
