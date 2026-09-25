// 从 Overpass API 下载广州中心城区的 OpenStreetMap 原始数据到 data/raw/（© OpenStreetMap contributors, ODbL）。
// 需要可访问外网的 Node 18+：
//
//   node tools/fetch-osm.mjs && node tools/build-city.mjs
//
// 输出格式与构建脚本约定一致：{ ts, n, els: [{ id, k: 'w'|'r'|'n', t: tags, g: [[lon, lat]...] | m: [{ r: role, g }] }] }

import fs from 'node:fs';
import { normalizeOSM } from './osm-source.mjs';

const API = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const OUT = 'data/raw/';
const B = '23.085,113.212,23.152,113.380'; // 城市精细范围（南, 西, 北, 东）
const R = '23.080,113.205,23.157,113.387'; // 道路 / 地块略外扩

const QUERIES = {
  'bld-1.json': `(way["building"](23.085,113.212,23.152,113.254);relation["building"](23.085,113.212,23.152,113.254);way["building:part"](23.085,113.212,23.152,113.254););out tags geom;`,
  'bld-2.json': `(way["building"](23.085,113.254,23.152,113.296);relation["building"](23.085,113.254,23.152,113.296);way["building:part"](23.085,113.254,23.152,113.296););out tags geom;`,
  'bld-3.json': `(way["building"](23.085,113.296,23.152,113.338);relation["building"](23.085,113.296,23.152,113.338);way["building:part"](23.085,113.296,23.152,113.338););out tags geom;`,
  'bld-4.json': `(way["building"](23.085,113.338,23.152,113.380);relation["building"](23.085,113.338,23.152,113.380);way["building:part"](23.085,113.338,23.152,113.380););out tags geom;`,
  'roads.json': `(way["highway"](${R});node["highway"](${R});relation["type"="restriction"](${R});relation["type"="connectivity"](${R}););(._;>;);out body geom;`,
  'water.json': `(way["natural"="water"](23.030,113.150,23.200,113.450);relation["natural"="water"](23.030,113.150,23.200,113.450);way["waterway"="riverbank"](23.030,113.150,23.200,113.450);relation["waterway"="riverbank"](23.030,113.150,23.200,113.450););out body geom(23.020,113.140,23.210,113.460);`,
  'landuse.json': `(way["leisure"~"^(park|garden|pitch|stadium|playground|golf_course|nature_reserve|track|sports_centre)$"](${R});way["landuse"~"^(grass|forest|recreation_ground|village_green|cemetery|construction|railway|commercial|residential|retail|industrial|meadow|orchard|farmland|education|religious)$"](${R});way["natural"~"^(wood|scrub|grassland|wetland|sand|beach)$"](${R});way["amenity"~"^(school|university|college|hospital|parking)$"](${R});way["place"~"^(square)$"](${R});way["area:highway"](${R}););out tags geom(${R});`,
  'relations.json': `(relation["building"](${B});relation["type"="building"](${B});relation["leisure"~"^(park|garden|stadium|golf_course|nature_reserve|sports_centre)$"](${R});relation["landuse"~"^(grass|forest|recreation_ground|construction|residential|commercial|retail|industrial|education)$"](${R});relation["natural"~"^(wood|scrub|wetland)$"](${R});relation["amenity"~"^(school|university|college|hospital)$"](${R}););out body geom;`,
  'misc.json': `(way["railway"~"^(rail|light_rail|subway|monorail|tram)$"](${R});way["man_made"~"^(bridge|pier)$"](${R});node["natural"="tree"](${R});node["tourism"~"attraction|museum"](${R});way["tourism"~"attraction|museum"](${R});node["historic"](${R});way["historic"](${R}););out tags geom;`,
};

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
  const data = normalizeOSM(J, { id: file, url: API, license: 'ODbL-1.0', retrievedAt: new Date().toISOString() });
  fs.writeFileSync(OUT + file, JSON.stringify(data));
  console.log(`  ${data.n} 个要素`);
}
