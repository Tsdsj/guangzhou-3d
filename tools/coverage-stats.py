"""Coverage of the evidence-based detail layer (P4 progress metric).

Counts what is actually integrated, never candidates:
  * Shamian study area = OSM building outlines (not building:part) within 50 m of roads named 沙面*;
  * street-facing facade area = outline edges within 25 m of a 沙面* road along their outward normal,
    times the rendered height (detail model height where integrated, base record height otherwise);
  * photographed faces = the model front plus the extra faces documented for the first five models;
  * road coverage = rendered centreline inside detail road tiles vs the whole city road length.
Areas use estimated heights, so they are progress proxies, not measured facade areas.
Run: .research/p0-2026-09-25/.venv/bin/python tools/coverage-stats.py
"""
from pathlib import Path
import json, math, sys
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from city_frame import load_city

ROOT = Path(__file__).resolve().parents[1]
load = lambda p: json.loads((ROOT / p).read_text())
meta, proj, unproj, section, ids = load_city()
bm = section('bldMeta')
render_h = {}
for i, sid in enumerate(ids['buildings']):
    render_h.setdefault(sid, bm[i * 24 + 3] - bm[i * 24 + 2])
rm, rp, names = section('roadMeta'), section('roadPts'), meta['roadNames']
sham_roads = []
for k in range(len(ids['roads'])):
    p0, n, ni = int(rm[k * 8]), int(rm[k * 8 + 1]), int(rm[k * 8 + 6])
    if ni >= 0 and names[ni].startswith('沙面') and n > 1:
        sham_roads.append(LineString([(rp[(p0 + j) * 4], rp[(p0 + j) * 4 + 1]) for j in range(n)]))
roads_u = unary_union(sham_roads)

all_feats = load('docs/research/p0-2026-09-25/shamian-osm-buildings.geojson')['features']
feats = [f for f in all_feats if f['geometry']['type'] == 'Polygon' and f['properties'].get('building') and not f['properties'].get('building:part')]
parts = [('osm:' + f['properties']['id'], Polygon([proj(*p) for p in f['geometry']['coordinates'][0][:-1]])) for f in all_feats
         if f['geometry']['type'] == 'Polygon' and f['properties'].get('building:part')]
area_buildings = []
for f in feats:
    ring = [proj(*p) for p in f['geometry']['coordinates'][0][:-1]]
    poly = Polygon(ring)
    if poly.is_valid and poly.distance(roads_u) < 50:
        area_buildings.append(('osm:' + f['properties']['id'], ring, poly))

manifest = load('data/detail/manifest.json')
placements = {b['sourceId']: (t, b) for t in manifest['tiles'] if t['kind'] == 'buildings' for b in t['buildings']}
tops = {b['sampleId']: b['modelTopM'] for b in load('docs/research/p3-acceptance/placement.json')['defaultBuildings']}
# Extra photographed faces of the first five models (see their P2/P3 records); compass in degrees.
EXTRA = {'B2': [90], 'C01': [0]}
PARTIAL_SIDES_M = {'C01': 2 * 9.6}


def edges(ring, poly):
    c = poly.centroid
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        L = math.dist(a, b)
        if L < 0.5:
            continue
        nx, nz = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if (mid[0] - c.x) * nx + (mid[1] - c.y) * nz < 0:
            nx, nz = -nx, -nz
        yield i, L, nx, nz, mid


def compass(nx, nz):
    return math.degrees(math.atan2(nx, -nz)) % 360


rows = []
tot_street = tot_photo = tot_walls_detail = tot_photo_detail = 0.0
for sid, ring, poly in area_buildings:
    placed = placements.get(sid)
    sample = placed[1]['sampleId'] if placed else None
    h = tops.get(sample) if sample else render_h.get(sid)
    if h is None:  # outline rendered through its building:part records (e.g. 64号, 60号, 69号): tallest part inside it
        inner = [render_h[pid] for pid, pp in parts if pid in render_h and pp.intersection(poly).area > 0.5 * pp.area]
        h = max(inner, default=0) or None
    if h is None:
        continue
    street = photo = walls = 0.0
    photo_edges = set()
    if placed:
        t, b = placed
        fx, fz = math.sin(b['rotationY']), math.cos(b['rotationY'])
        ang = []
        if t['id'] == 'shamian-dajie':
            s = load(t['url'][2:])['samples']['buildings'][sample]
            # Faces are recorded as source-edge indices of the same outline.
            photo_edges |= {f['edge'] for f in s['model']['faces']}
        else:
            ang = [compass(fx, fz)] + EXTRA.get(sample, [])
    for i, L, nx, nz, mid in edges(ring, poly):
        walls += L * h
        probe = LineString([mid, (mid[0] + nx * 25, mid[1] + nz * 25)])
        faces_street = probe.intersects(roads_u)
        if faces_street:
            street += L * h
        if placed and (i in photo_edges or any(abs((compass(nx, nz) - a + 180) % 360 - 180) < 30 for a in ang)):
            photo += L * h
    if placed:
        photo += PARTIAL_SIDES_M.get(sample, 0) * h
        tot_walls_detail += walls
        tot_photo_detail += photo
    tot_street += street
    tot_photo += min(photo, street) if street else 0
    rows.append(dict(sourceId=sid, sample=sample, heightM=round(h, 2), heightSource='detail model (estimated)' if placed else 'base render record (inferred)',
                     streetFacadeM2=round(street, 1), photographedFacadeM2=round(photo, 1) if placed else 0, allWallsM2=round(walls, 1)))

road = load('docs/research/p3-road-coverage/report.json')
city_road_m = meta['stats']['roadKm'] * 1000
report = dict(
    date='2026-09-26',
    definitions=__doc__.strip().splitlines()[2:8],
    shamian=dict(buildingsInStudyArea=len(rows), detailedBuildings=sum(1 for r in rows if r['sample']),
                 detailedShareByCount=round(sum(1 for r in rows if r['sample']) / len(rows), 4),
                 streetFacadeM2=round(tot_street, 1), photographedStreetFacadeM2=round(tot_photo, 1),
                 photographedStreetFacadeShare=round(tot_photo / tot_street, 4),
                 detailedBuildingsAllWallsM2=round(tot_walls_detail, 1), detailedBuildingsPhotographedM2=round(tot_photo_detail, 1),
                 detailedBuildingsPhotographedShare=round(tot_photo_detail / tot_walls_detail, 4)),
    city=dict(osmBuildingRecords=meta['stats']['buildings'], proceduralFill=meta['stats']['fill'], detailedBuildings=len(placements),
              detailedShareOfOsmRecords=round(len(placements) / meta['stats']['buildings'], 6)),
    roads=dict(detailCentrelineM=road['renderedCentrelineTotalM'], huachengCorridorM=road['huachengCorridorM'], cityRoadM=round(city_road_m),
               detailShareOfCityRoadLength=round(road['renderedCentrelineTotalM'] / city_road_m, 5), junctions=sorted(road['junctionsWithHuachengAvenue'])),
    notMeaning='counts integrated evidence-based models only; heights and facade areas are estimates; this is not measured or whole-city 1:1 coverage',
    buildings=rows,
)
out = ROOT / 'docs/research/p4-coverage'
out.mkdir(parents=True, exist_ok=True)
(out / 'coverage.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
print(json.dumps({k: v for k, v in report.items() if k not in ('buildings', 'definitions')}, ensure_ascii=False, indent=1))
