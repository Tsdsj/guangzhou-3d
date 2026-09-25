"""Real coverage and consistency of the two detail road tiles (花城大道 × 华穗路 / 华夏路).

Reports measured centreline length per named road (inside the tiles), the corridor length of 花城大道
along its own axis, the junction nodes shared with the side roads, and three consistency checks
that use only the fixed source data:
  * cross-section: rendered carriageway half-width vs the offset of separately mapped sidewalks
    (footway=sidewalk) measured every 10 m on both sides;
  * connections: pairs of rendered carriageways whose surfaces overlap without sharing a source node;
  * layers: special structures (tunnels, bridges, steps, passages) kept out of the ground surface.
Widths remain lane-based estimates; the sidewalk offset is a mapped centreline, not a kerb survey.
Run: .research/p0-2026-09-25/.venv/bin/python tools/road-coverage.py
"""
from pathlib import Path
import json, math, sys
from collections import defaultdict
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union, substring
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from road_layers import classify_way
from city_frame import load_city

ROOT = Path(__file__).resolve().parents[1]
load = lambda p: json.loads((ROOT / p).read_text())
meta, proj, unproj, section, ids = load_city()
manifest = load('data/detail/manifest.json')
tiles = {t['id']: t for t in manifest['tiles'] if t['kind'] == 'roads'}
payload = {k: load(t['url'][2:])['samples']['road'] for k, t in tiles.items()}
raw = load('data/evidence/huacheng-osm.json')['elements']
nodes = {e['id']: e for e in raw if e['type'] == 'node'}
ways = {'osm:w' + str(e['id']): e for e in raw if e['type'] == 'way'}
area = unary_union([box(*t['bounds']) for t in tiles.values()])

# Rendered carriageway lines (tile-local -> city) with their estimated widths.
lines = defaultdict(list)
width = {}
for k, t in tiles.items():
    cx, _, cz = t['position']
    for l in payload[k]['lines']:
        lines[l['sourceId']].append(LineString([(x + cx, z + cz) for x, z in l['points']]))
        width[l['sourceId']] = l['width']
tag = lambda sid: ways.get(sid, {}).get('tags', {})

by_name = defaultdict(float)
for sid, parts in lines.items():
    by_name[tag(sid).get('name', '(unnamed ' + tag(sid).get('highway', '?') + ')')] += sum(p.length for p in parts)

# 花城大道 corridor: project its carriageways onto the principal (east-west) axis of the tiles.
main = [p for sid, parts in lines.items() if tag(sid).get('name') == '花城大道' and tag(sid).get('highway') == 'primary' for p in parts]
xs = [c[0] for p in main for c in p.coords]
corridor = max(xs) - min(xs)
carriageways = sorted({sid for sid in lines if tag(sid).get('name') == '花城大道' and tag(sid).get('highway') == 'primary'})

# Junctions: nodes shared by 花城大道 and a side road inside the tiles.
node_ways = defaultdict(set)
for sid, e in ways.items():
    if e.get('tags', {}).get('highway'):
        for n in e['nodes']:
            node_ways[n].add(sid)
junctions = defaultdict(set)
for n, ws in node_ways.items():
    names = {tag(w).get('name') for w in ws}
    if '花城大道' in names and n in nodes and area.contains(Point(proj(nodes[n]['lon'], nodes[n]['lat']))):
        for other in names - {'花城大道', None}:
            junctions[other].add(n)

# Cross-section check against separately mapped sidewalks.
sidewalks = []
for sid, e in ways.items():
    t = e.get('tags', {})
    if t.get('footway') == 'sidewalk' and all(n in nodes for n in e['nodes']) and classify_way(t)['groundRenderable']:
        sidewalks.append((sid, LineString([proj(nodes[n]['lon'], nodes[n]['lat']) for n in e['nodes']])))
surface_all = unary_union([Polygon([(x + t['position'][0], z + t['position'][2]) for x, z in sf['outer']], [[(x + t['position'][0], z + t['position'][2]) for x, z in h] for h in sf['holes']]) for k, t in tiles.items() for sf in payload[k]['surfaces']])


def surface_reach(c, nx, nz, sign):
    # Distance from the centreline point to where the rendered surface ends along the normal.
    probe = LineString([(c.x, c.y), (c.x + sign * nx * 25, c.y + sign * nz * 25)])
    inside = probe.intersection(surface_all)
    segs = [g for g in getattr(inside, 'geoms', [inside]) if g.length > 0 and Point(c.x, c.y).distance(g) < 0.05]
    return round(max(Point(c.x, c.y).distance(Point(q)) for g in segs for q in g.coords), 2) if segs else 0.0


stations = []
for sid, parts in lines.items():
    if tag(sid).get('highway') not in ('primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link'):
        continue
    half = width[sid] / 2
    for p in parts:
        for s in [d for d in range(5, int(p.length), 10)]:
            a, b = p.interpolate(s - 0.5), p.interpolate(s + 0.5)
            tx, tz = b.x - a.x, b.y - a.y
            L = math.hypot(tx, tz)
            nx, nz = -tz / L, tx / L
            c = p.interpolate(s)
            row = dict(sourceId=sid, name=tag(sid).get('name'), s=s, renderedHalfWidthM=round(half, 2))
            for side, sign in (('left', 1), ('right', -1)):
                probe = LineString([(c.x, c.y), (c.x + sign * nx * 25, c.y + sign * nz * 25)])
                hits = [(Point(c.x, c.y).distance(probe.intersection(w)), wid) for wid, w in sidewalks if probe.intersects(w)]
                hits = [(d, wid) for d, wid in hits if d > 0]
                row[side] = dict(sidewalkOffsetM=round(min(hits)[0], 2), sidewalkId=min(hits)[1], surfaceReachM=surface_reach(c, nx, nz, sign)) if hits else None
            stations.append(row)
covered = [r for r in stations if r['left'] or r['right']]
conflicts = [r for r in covered for side in ('left', 'right') if r[side] and r[side]['sidewalkOffsetM'] < r['renderedHalfWidthM']]
# After the sidewalk-priority rule the rendered surface itself must stop before the mapped strip.
surface_conflicts = [r for r in covered for side in ('left', 'right') if r[side] and r[side]['surfaceReachM'] > r[side]['sidewalkOffsetM'] - 0.85 + 0.05]

# Connections: overlapping carriageway surfaces without a shared source node.
surf = {sid: unary_union(parts).buffer(width[sid] / 2, cap_style='flat') for sid, parts in lines.items()}
false_links = []
keys = sorted(surf)
for i, a in enumerate(keys):
    for b in keys[i + 1:]:
        if surf[a].intersects(surf[b]) and surf[a].intersection(surf[b]).area > 1:
            shared = set(ways.get(a, {}).get('nodes', [])) & set(ways.get(b, {}).get('nodes', []))
            if not shared:
                false_links.append(dict(a=a, b=b, nameA=tag(a).get('name'), nameB=tag(b).get('name'), overlapM2=round(surf[a].intersection(surf[b]).area, 1),
                                        layerA=tag(a).get('layer'), layerB=tag(b).get('layer'), bridgeA=tag(a).get('bridge'), bridgeB=tag(b).get('bridge')))
deferred = sorted({d['sourceId'] for p in payload.values() for d in p['deferredStructures']})
ground_mixed = [sid for sid in lines if sid in deferred]

report = dict(
    date='2026-09-26', basis='detail road tiles huasui/huaxia vs fixed P0 OSM sample; lengths in the existing city-local metres',
    tileBoundingSpanM=round(area.bounds[2] - area.bounds[0], 1),
    huachengCorridorM=round(corridor, 1), huachengCarriageways=len(carriageways),
    huachengCarriagewayCentrelineM=round(sum(p.length for p in main), 1),
    renderedCentrelineByNameM={k: round(v, 1) for k, v in sorted(by_name.items(), key=lambda kv: -kv[1])},
    renderedCentrelineTotalM=round(sum(by_name.values()), 1),
    junctionsWithHuachengAvenue={k: sorted(v) for k, v in junctions.items()},
    surfaceM2=round(sum(Polygon(s['outer'], s['holes']).area for p in payload.values() for s in p['surfaces']), 1),
    walkwayM2=round(sum(Polygon(s['outer'], s['holes']).area for p in payload.values() for s in p['walkways']), 1),
    crossingPaths=len({c['sourceId'] for p in payload.values() for c in p['crossings']}),
    paintedCrossingSources=len({m['sourceId'] for p in payload.values() for m in p['markings']}),
    sidewalkCheck=dict(stations=len(stations), stationsWithMappedSidewalk=len(covered),
                       nominalWidthBeyondSidewalkCentreline=len(conflicts), renderedSurfaceIntoSidewalkStrip=len(surface_conflicts), examples=(surface_conflicts or conflicts)[:8],
                       note='offset = distance from the carriageway centreline to a mapped sidewalk centreline within 25 m; a sidewalk half-width is not mapped, so offset < rendered half-width means the estimated carriageway overlaps the mapped path'),
    falseConnections=false_links, specialStructuresInGroundSurface=ground_mixed,
    deferredSpecialStructures=len(deferred),
)
(ROOT / 'docs/research/p3-road-coverage').mkdir(parents=True, exist_ok=True)
(ROOT / 'docs/research/p3-road-coverage/report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
(ROOT / 'docs/research/p3-road-coverage/stations.json').write_text(json.dumps(stations, ensure_ascii=False) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ('sidewalkCheck', 'falseConnections')}, ensure_ascii=False, indent=1))
print('sidewalk check', {k: v for k, v in report['sidewalkCheck'].items() if k != 'examples'})
print('false connections', len(false_links))
for f in false_links[:12]: print('  ', f)
