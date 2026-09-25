"""Second-pass review of the 63 Overture supplementary outlines against the dated OSM snapshots.

Classes (geometry only; no imagery or identity evidence is available for these outlines):
  covered-by-osm       >= 50 % of the candidate lies inside current OSM building outlines
  partial-conflict     some overlap but < 50 %: outline disagreement to resolve with imagery
  no-osm-counterpart   no overlap: a possibly unmapped structure, or a false positive
Nothing is promoted; every candidate keeps productionEligible = false.
Run: .research/p0-2026-09-25/.venv/bin/python tools/review-overture-candidates.py
"""
from pathlib import Path
import json
from collections import Counter
from shapely.geometry import shape, Polygon
from shapely.ops import unary_union
ROOT = Path(__file__).resolve().parents[1]
load = lambda p: json.loads((ROOT / p).read_text())
cands = load('docs/research/p3-building-screening/outline-screening.geojson')['features']


def osm_buildings(path):
    d = load(path)
    nodes = {e['id']: (e['lon'], e['lat']) for e in d['elements'] if e['type'] == 'node'}
    polys = []
    for e in d['elements']:
        t = e.get('tags', {})
        if e['type'] == 'way' and ('building' in t or 'building:part' in t) and len(e['nodes']) >= 4 and all(n in nodes for n in e['nodes']):
            p = Polygon([nodes[n] for n in e['nodes']])
            if p.is_valid:
                polys.append(p)
    return unary_union(polys), d['bounds']


sources = {'shamian': 'data/evidence/snapshots/2026-09-26/shamian-map.json', 'huacheng': 'data/evidence/snapshots/2026-09-26/huacheng-map.json'}
refs = {k: osm_buildings(v) for k, v in sources.items()}
rows = []
for f in cands:
    p = f['properties']
    g = shape(f['geometry'])
    osm, b = refs[p['area']]
    inside_bounds = b['minlon'] <= g.centroid.x <= b['maxlon'] and b['minlat'] <= g.centroid.y <= b['maxlat']
    ratio = g.intersection(osm).area / g.area if g.area else 0
    cls = 'outside-refreshed-bbox' if not inside_bounds else 'covered-by-osm' if ratio >= 0.5 else 'partial-conflict' if ratio > 0.02 else 'no-osm-counterpart'
    rows.append(dict(id=p['id'], area=p['area'], areaM2=p['areaM2'], sourceDatasets=p['sourceDatasets'], overlapWithOsm2026_09_26=round(ratio, 3), reviewClass=cls,
                     decision='hold-no-imagery-or-identity' if cls != 'covered-by-osm' else 'not-needed-osm-already-represents', productionEligible=False))
summary = dict(Counter(r['reviewClass'] for r in rows))
out = ROOT / 'docs/research/p3-building-screening/overture-second-pass.json'
out.write_text(json.dumps(dict(date='2026-09-26', basis='geometry against 2026-09-26 OSM map-API snapshots; single source dataset ' + ', '.join(sorted({d for r in rows for d in r['sourceDatasets']})), summary=summary, rows=rows), ensure_ascii=False, indent=1) + '\n')
print(json.dumps(summary, ensure_ascii=False), 'small (<100 m²):', sum(1 for r in rows if r['areaM2'] < 100))
