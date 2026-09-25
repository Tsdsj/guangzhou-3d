import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeOSM } from './osm-source.mjs';
import { buildEvidence } from './evidence.mjs';

export function buildCityEvidence({ rawDir, inputDir = 'data/evidence', renderBuildingKeys, renderRoadIds }) {
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const config = read(path.join(inputDir, 'manifest.json'));
  if (config.version !== 1) throw new Error('Unsupported evidence manifest');
  const buildings = new Map();
  const snapshots = [];
  const loadSource = (name) => {
    const file = path.join(rawDir, name);
    const bytes = fs.readFileSync(file);
    const data = JSON.parse(bytes);
    snapshots.push({ file: name, snapshotAt: data.ts || null, sha256: createHash('sha256').update(bytes).digest('hex'), formatVersion: data.version || 1 });
    return data;
  };
  for (const name of ['bld-1.json', 'bld-2.json', 'bld-3.json', 'bld-4.json', 'relations.json']) {
    for (const e of loadSource(name).els) if (e.t.building || e.t['building:part'] || e.t.type === 'building') buildings.set(e.k + e.id, e);
  }
  const roadInput = loadSource('roads.json');
  const roads = roadInput.els.filter((e) => e.k === 'w' && e.t.highway);
  const sources = {
    osmCity: { license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright', snapshots },
    ...config.sources,
  };
  const networkInputs = config.networks.map((entry) => {
    const file = path.join(inputDir, entry.file);
    const bytes = fs.readFileSync(file);
    sources[entry.id] = { ...sources[entry.id], sha256: createHash('sha256').update(bytes).digest('hex') };
    return { ...normalizeOSM(JSON.parse(bytes), sources[entry.id]), id: entry.id, bbox: entry.bbox };
  });
  // Future full raw snapshots can carry real node IDs too; old coordinate-only files are not upgraded by guessing.
  if (roadInput.els.some((e) => e.k === 'n') && roads.some((e) => e.nodes?.length)) {
    networkInputs.unshift({ ...roadInput, id: 'osmCity', bbox: [113.205, 23.080, 113.387, 23.157] });
  }
  return buildEvidence({ buildings: [...buildings.values()], roads, renderBuildingKeys, renderRoadIds, sources, networkInputs,
    facades: read(path.join(inputDir, config.facades)), candidates: read(path.join(inputDir, config.candidates)) });
}
