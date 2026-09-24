// 从 Overpass API 下载广州中心城区的 OpenStreetMap 原始数据到 data/raw/（© OpenStreetMap contributors, ODbL）。
// 需要可访问外网的 Node 18+：
//
//   node tools/fetch-osm.mjs && node tools/build-city.mjs
//
// 输出格式与构建脚本约定一致：{ ts, n, els: [{ id, k: 'w'|'r'|'n', t: tags, g: [[lon, lat]...] | m: [{ r: role, g }] }] }

import fs from 'node:fs';

const API = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const OUT = 'data/raw/';
const B = '23.085,113.212,23.152,113.380'; // 城市精细范围（南, 西, 北, 东）
const R = '23.080,113.205,23.157,113.387'; // 道路 / 地块略外扩

const QUERIES = {
  'bld-1.json': `(way["building"](23.085,113.212,23.152,113.254);relation["building"](23.085,113.212,23.152,113.254);way["building:part"](23.085,113.212,23.152,113.254););out tags geom;`,
  'bld-2.json': `(way["building"](23.085,113.254,23.152,113.296);relation["building"](23.085,113.254,23.152,113.296);way["building:part"](23.085,113.254,23.152,113.296););out tags geom;`,
  'bld-3.json': `(way["building"](23.085,113.296,23.152,113.338);relation["building"](23.085,113.296,23.152,113.338);way["building:part"](23.085,113.296,23.152,113.338););out tags geom;`,
  'bld-4.json': `(way["building"](23.085,113.338,23.152,113.380);relation["building"](23.085,113.338,23.152,113.380);way["building:part"](23.085,113.338,23.152,113.380););out tags geom;`,
  'roads.json': `way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian|service)$"](${R});out tags geom;`,
  'water.json': `(way["natural"="water"](23.030,113.150,23.200,113.450);relation["natural"="water"](23.030,113.150,23.200,113.450);way["waterway"="riverbank"](23.030,113.150,23.200,113.450);relation["waterway"="riverbank"](23.030,113.150,23.200,113.450););out body geom(23.020,113.140,23.210,113.460);`,
  'landuse.json': `(way["leisure"~"^(park|garden|pitch|stadium|playground|golf_course|nature_reserve|track|sports_centre)$"](${R});way["landuse"~"^(grass|forest|recreation_ground|village_green|cemetery|construction|railway|commercial|residential|retail|industrial|meadow|orchard|farmland|education|religious)$"](${R});way["natural"~"^(wood|scrub|grassland|wetland|sand|beach)$"](${R});way["amenity"~"^(school|university|college|hospital|parking)$"](${R});way["place"~"^(square)$"](${R});way["area:highway"](${R}););out tags geom(${R});`,
  'relations.json': `(relation["building"](${B});relation["leisure"~"^(park|garden|stadium|golf_course|nature_reserve|sports_centre)$"](${R});relation["landuse"~"^(grass|forest|recreation_ground|construction|residential|commercial|retail|industrial|education)$"](${R});relation["natural"~"^(wood|scrub|wetland)$"](${R});relation["amenity"~"^(school|university|college|hospital)$"](${R}););out body geom;`,
  'misc.json': `(way["railway"~"^(rail|light_rail|subway|monorail|tram)$"](${R});way["man_made"~"^(bridge|pier)$"](${R});node["natural"="tree"](${R});node["tourism"~"attraction|museum"](${R});way["tourism"~"attraction|museum"](${R});node["historic"](${R});way["historic"](${R}););out tags geom;`,
};

const R7 = (v) => Math.round(v * 1e7) / 1e7;
const geom = (g) => (g || []).filter(Boolean).map((p) => [R7(p.lon), R7(p.lat)]);

async function run(q) {
  const body = 'data=' + encodeURIComponent(`[out:json][timeout:240][maxsize:1073741824];${q}`);
  for (let i = 0; i < 8; i++) {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const text = await r.text();
    if (r.ok && text.trim().startsWith('{')) return JSON.parse(text);
    console.warn(`  重试（HTTP ${r.status}）…`);
    await new Promise((s) => setTimeout(s, 4000 + i * 3000));
  }
  throw new Error('Overpass 请求失败');
}

fs.mkdirSync(OUT, { recursive: true });
for (const [file, q] of Object.entries(QUERIES)) {
  console.log('下载', file);
  const J = await run(q);
  const els = [];
  for (const e of J.elements) {
    if (e.type === 'way') els.push({ id: e.id, k: 'w', t: e.tags || {}, g: geom(e.geometry) });
    else if (e.type === 'relation') els.push({ id: e.id, k: 'r', t: e.tags || {}, m: (e.members || []).filter((m) => m.type === 'way' && m.geometry).map((m) => ({ r: m.role, g: geom(m.geometry) })) });
    else if (e.type === 'node') els.push({ id: e.id, k: 'n', t: e.tags || {}, g: [[R7(e.lon), R7(e.lat)]] });
  }
  fs.writeFileSync(OUT + file, JSON.stringify({ ts: J.osm3s && J.osm3s.timestamp_osm_base, n: els.length, els }));
  console.log(`  ${els.length} 个要素`);
}
