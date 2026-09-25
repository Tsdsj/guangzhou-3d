"""Compare a dated OSM snapshot with the baselines the detail layer was built from (P4 update review).

Usage: .research/p0-2026-09-25/.venv/bin/python tools/snapshot-diff.py data/evidence/snapshots/<date>
Expects <dir>/shamian-map.json and/or <dir>/huacheng-map.json from the OSM map API
(https://api.openstreetmap.org/api/0.6/map.json?bbox=..., the same small-area endpoint used in P0).

Nothing is merged or edited automatically. The report lists element changes and their impact:
detailed buildings whose outline or identity tags moved (placement must be re-verified), road-tile
source ways that changed (tiles must be rebuilt), and review items whose tags changed (the pending
markings/endpoints may be resolvable). A newer version is a newer claim, not a verified fact.
"""
from pathlib import Path
import json, sys, hashlib
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
load = lambda p: json.loads((ROOT / p).read_text()) if not isinstance(p, Path) else json.loads(p.read_text())
snap = (Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'data/evidence/snapshots/2026-09-26')
report = dict(snapshot=str(snap.relative_to(ROOT)), files={}, areas={})

IDENTITY_TAGS = {'name', 'name:zh', 'addr:street', 'addr:housenumber', 'building', 'building:part', 'building:levels', 'height', 'roof:shape', 'old_name'}


def index(elements):
    return {(e['type'], e['id']): e for e in elements}


def geom_of_way(e, nodes):
    return [(round(nodes[n]['lon'], 7), round(nodes[n]['lat'], 7)) for n in e.get('nodes', []) if n in nodes]


manifest = load('data/detail/manifest.json')
placements = [b for t in manifest['tiles'] if t['kind'] == 'buildings' for b in t['buildings']]
road_ids = set()
for t in manifest['tiles']:
    if t['kind'] == 'roads':
        r = load(t['url'][2:])['samples']['road']
        road_ids |= {l['sourceId'] for l in r['lines']} | {c['sourceId'] for c in r['crossings']} | {m['sourceId'] for m in r['markings']}

# Shamian: building outlines against the P0 outline set used for every Shamian placement.
sham_path = snap / 'shamian-map.json'
if sham_path.exists():
    new = load(sham_path)
    report['files'][str(sham_path.relative_to(ROOT))] = hashlib.sha256(sham_path.read_bytes()).hexdigest()
    nodes = {e['id']: e for e in new['elements'] if e['type'] == 'node'}
    new_b = {'w' + str(e['id']): e for e in new['elements'] if e['type'] == 'way' and ('building' in e.get('tags', {}) or 'building:part' in e.get('tags', {}))}
    base = {f['properties']['id']: f for f in load('docs/research/p0-2026-09-25/shamian-osm-buildings.geojson')['features']}
    bounds = new['bounds']
    inside = lambda coords: all(bounds['minlon'] <= x <= bounds['maxlon'] and bounds['minlat'] <= y <= bounds['maxlat'] for x, y in coords)
    changes = []
    for bid, f in base.items():
        if not bid.startswith('w') or f['geometry']['type'] != 'Polygon':
            continue
        old_geom = [tuple(round(v, 7) for v in p) for p in f['geometry']['coordinates'][0]]
        if not inside(old_geom):
            continue  # outside the refreshed bbox: no claim either way
        e = new_b.get(bid)
        if not e:
            changes.append(dict(id='osm:' + bid, change='missing-in-new-snapshot'))
            continue
        g = geom_of_way(e, nodes)
        tags_old = {k: v for k, v in f['properties'].items() if k != 'id'}
        tag_diff = {k: [tags_old.get(k), e['tags'].get(k)] for k in set(tags_old) | set(e['tags']) if tags_old.get(k) != e['tags'].get(k)}
        moved = max((abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(old_geom, g)), default=0) if len(g) == len(old_geom) else None
        if tag_diff or moved is None or moved > 1e-7:
            changes.append(dict(id='osm:' + bid, change='modified', version=e.get('version'), timestamp=e.get('timestamp'),
                                tagDiff=tag_diff, vertexCount=[len(old_geom), len(g)], maxVertexShiftDeg=moved,
                                identityTagsChanged=sorted(set(tag_diff) & IDENTITY_TAGS)))
    # Base city snapshot time: an added element last edited before it lay outside the P0 crop, not a new edit.
    base_time = load('data/guangzhou.json')['osmTimestamp']
    added = [dict(id='osm:' + bid, version=e.get('version'), timestamp=e.get('timestamp'), tags=e['tags'],
                  reason='new-since-base-snapshot' if (e.get('timestamp') or '') > base_time else 'outside-P0-crop-pre-existing') for bid, e in new_b.items() if bid not in base]
    touched = {c['id'] for c in changes}
    impact = [dict(sampleId=b['sampleId'], sourceId=b['sourceId'], changed=sorted(set([b['sourceId'], *b['replaceIds']]) & touched)) for b in placements]
    report['areas']['shamian'] = dict(
        baseline='docs/research/p0-2026-09-25/shamian-osm-buildings.geojson', compared=sum(1 for bid, f in base.items() if bid.startswith('w')),
        changes=changes, added=added, counts=dict(Counter(c['change'] for c in changes)), addedByReason=dict(Counter(a['reason'] for a in added)),
        detailedBuildingsToReverify=[i for i in impact if i['changed']], detailedBuildingsUnchanged=[i['sampleId'] for i in impact if not i['changed']])

# Huacheng: full element diff against the P0 map-API sample the road tiles were built from.
hua_path = snap / 'huacheng-map.json'
if hua_path.exists():
    new = load(hua_path)
    report['files'][str(hua_path.relative_to(ROOT))] = hashlib.sha256(hua_path.read_bytes()).hexdigest()
    old = load('data/evidence/huacheng-osm.json')
    a, b = index(old['elements']), index(new['elements'])
    modified = []
    for k in a.keys() & b.keys():
        x, y = a[k], b[k]
        if x.get('version') != y.get('version') or x.get('tags') != y.get('tags') or x.get('nodes') != y.get('nodes') or (k[0] == 'node' and (x['lat'], x['lon']) != (y['lat'], y['lon'])):
            modified.append(dict(type=k[0], id=k[1], version=[x.get('version'), y.get('version')], timestamp=y.get('timestamp'),
                                 tagDiff={t: [x.get('tags', {}).get(t), y.get('tags', {}).get(t)] for t in set(x.get('tags', {})) | set(y.get('tags', {})) if x.get('tags', {}).get(t) != y.get('tags', {}).get(t)}))
    review = load('docs/research/p3-source-review-2026-09-26/review.json') if (ROOT / 'docs/research/p3-source-review-2026-09-26/review.json').exists() else {}
    # Still-open review items from the P3 source review: 14 deferred markings and unresolved endpoints.
    pending = {m['sourceId'] for m in review.get('markings', []) if m.get('renderDecision', '').startswith('deferred')}
    pending |= {e['sourceId'] for e in review.get('endpoints', []) if 'pending' in e.get('status', '')}
    mod_ids = {f"osm:{m['type'][0]}{m['id']}" for m in modified}
    report['areas']['huacheng'] = dict(
        baseline='data/evidence/huacheng-osm.json', elements=[len(a), len(b)],
        added=sorted(f'{t}/{i}' for t, i in b.keys() - a.keys()), removed=sorted(f'{t}/{i}' for t, i in a.keys() - b.keys()),
        modified=modified, counts=dict(Counter(m['type'] for m in modified)),
        roadTileSourcesChanged=sorted(mod_ids & road_ids), pendingReviewItemsChanged=sorted(mod_ids & pending))

out = ROOT / 'docs/research/p4-update'
out.mkdir(parents=True, exist_ok=True)
name = f"diff-{snap.name}.json"
(out / name).write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
summary = {area: {k: (v if not isinstance(v, list) else len(v)) for k, v in d.items() if k not in ('changes',)} for area, d in report['areas'].items()}
print(json.dumps(summary, ensure_ascii=False, indent=1))
