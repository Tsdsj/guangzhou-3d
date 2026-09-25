"""Facade-study inputs: data/evidence/facade-studies.json + OSM outlines -> prototypes/p2/facade-studies.json.

For every study the photographed face selects a source edge (outward normal nearest the recorded
facing, then nearest the named street). The model frame is centred on the outline centroid with z
out of that face, so the renderer applies only an explicit rotation + translation. Photo records are
rebuilt from the saved Commons metadata and the local thumbnails are hash-checked.
Run with the project GIS venv: .research/p0-2026-09-25/.venv/bin/python tools/build-facade-studies.py
"""
from pathlib import Path
import json, math, hashlib, re, sys
from shapely.geometry import Polygon, LineString, Point
sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from city_frame import load_city

ROOT = Path(__file__).resolve().parents[1]
load = lambda p: json.loads((ROOT / p).read_text())
evidence = load('data/evidence/facade-studies.json')
meta, proj, unproj, section, ids = load_city()
rendered = set(ids['buildings'])
osm_path = evidence['sources']['osmShamian']['path']
features = {f['properties']['id']: f for f in load(osm_path)['features']}

# Named street centrelines from the rendered city data (used only to break facing ties).
rm, rp, names = section('roadMeta'), section('roadPts'), meta['roadNames']
streets = {}
for k in range(len(ids['roads'])):
    p0, n, ni = int(rm[k * 8]), int(rm[k * 8 + 1]), int(rm[k * 8 + 6])
    if ni >= 0 and n > 1:
        streets.setdefault(names[ni], []).append(LineString([(rp[(p0 + j) * 4], rp[(p0 + j) * 4 + 1]) for j in range(n)]))

info = {p['title'][5:]: p for p in load('docs/research/p3-building-expansion/commons-imageinfo.json')}
downloads = {d['id']: d for d in load('docs/research/p3-building-expansion/photo-downloads.json')}
strip = lambda s: re.sub(r'<[^>]+>', '', s or '').strip()


def photo_record(pid):
    d = downloads[pid]
    data = (ROOT / d['path']).read_bytes()
    assert hashlib.sha256(data).hexdigest() == d['localSha256'], pid
    i = info[d['file']]
    return dict(path='../../' + d['path'], url=i['descriptionurl'], file=d['file'], artist=strip(i['artist']), date=(i['dateOriginal'] or '')[:19],
                license=i['license'], licenseUrl=i['licenseUrl'], originalSha1=i['sha1'], thumbSha256=d['localSha256'],
                derivative=d['localDerivative'], pixelRegistrationVerified=False)


FACING = {'N': 0, 'E': 90, 'S': 180, 'W': 270}


def outward(ring, i, poly):
    a, b = ring[i], ring[(i + 1) % len(ring)]
    L = math.dist(a, b)
    nx, nz = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    c = poly.centroid
    if (mid[0] - c.x) * nx + (mid[1] - c.y) * nz < 0:
        nx, nz = -nx, -nz
    return nx, nz, L, mid


def pick_edge(ring, poly, facing, street):
    rows = []
    for i in range(len(ring)):
        nx, nz, L, mid = outward(ring, i, poly)
        if L < 2:
            continue
        compass = math.degrees(math.atan2(nx, -nz)) % 360  # east=+x, north=-z
        off = abs((compass - FACING[facing] + 180) % 360 - 180)
        dist = min((line.distance(Point(mid)) for line in streets.get(street, [])), default=float('inf'))
        rows.append(dict(edge=i, lengthM=round(L, 3), compass=round(compass, 1), offDeg=round(off, 1), streetDistM=round(dist, 2)))
    cand = [r for r in rows if r['offDeg'] <= 35]
    if not cand:
        raise SystemExit(f'No edge faces {facing}')
    best = min(cand, key=lambda r: (r['streetDistM'], -r['lengthM']))
    return best, rows


studies, placements, report = {}, [], []
for b in evidence['buildings']:
    oid = b['sourceId'].split(':')[1]
    f = features[oid]
    ring = [proj(*p) for p in f['geometry']['coordinates'][0][:-1]]
    poly = Polygon(ring)
    assert poly.is_valid, b['id']
    faces, chosen = [], []
    for face in b['faces']:
        best, rows = pick_edge(ring, poly, face['facing'], face['street'])
        chosen.append(dict(facing=face['facing'], street=face['street'], **best, candidates=rows))
        faces.append({k: v for k, v in face.items() if k not in ('facing', 'street', 'photos', 'observed')} | {'edge': best['edge']})
    nx, nz, _, _ = outward(ring, faces[0]['edge'], poly)
    theta = math.atan2(nx, nz)
    co, si = math.cos(theta), math.sin(theta)
    cx, cz = poly.centroid.x, poly.centroid.y
    plan = [[(x - cx) * co - (z - cz) * si, (x - cx) * si + (z - cz) * co] for x, z in ring]
    # The primary face must sit on a constant z in the model frame (explicit rotation, no fit).
    e = faces[0]['edge']
    assert abs(plan[e][1] - plan[(e + 1) % len(plan)][1]) < 1e-6 and plan[e][1] > 0, b['id']
    rendered_ids = [i for i in b['replaceIds'] if i in rendered]
    assert rendered_ids, f"{b['id']}: none of {b['replaceIds']} is a rendered base record"
    photos = {pid: photo_record(pid) for pid in b['photos']}
    top = sum(b['model']['storeys']) + b['model'].get('entablature', 0.7) + ((b['model'].get('parapet') or {}).get('h', 0))
    if (b['model'].get('roof') or {}).get('kind') == 'hip':
        # Label clears the estimated hip ridge (same bounding rectangle as the kit's roof).
        o = b['model']['roof'].get('overhang', 0.5)
        span = min(max(p[0] for p in plan) - min(p[0] for p in plan), max(p[1] for p in plan) - min(p[1] for p in plan)) + 2 * o
        top += span / 2 * math.tan(math.radians(b['model']['roof'].get('pitch', 24)))
    studies[b['id']] = dict(version=1, id=b['id'], kind='facade-study', sourceId=b['sourceId'], name=b['name'], address=b['address'],
                            identity=b['identity'], plan=plan, width=chosen[0]['lengthM'], depth=round(max(p[1] for p in plan) - min(p[1] for p in plan), 3),
                            model=b['model'] | {'faces': faces}, faceEvidence=[{k: face[k] for k in ('facing', 'street', 'photos', 'observed')} for face in b['faces']],
                            photos=photos, heightEvidence=b.get('heightEvidence'), conflicts=b.get('conflicts', []), unknowns=b.get('unknowns', []),
                            heightStatus='estimated', measuredHeightM=None, metricAccuracy='unverified', productionEligible=b.get('gate', {}).get('status') == 'default',
                            productionGate=b.get('gate'),
                            evidencePath='data/evidence/facade-studies.json', sourcePath=osm_path,
                            sourceSha256=hashlib.sha256((ROOT / osm_path).read_bytes()).hexdigest())
    placements.append(dict(sampleId=b['id'], sourceId=b['sourceId'], replaceIds=b['replaceIds'], position=[cx, 0, cz], rotationY=theta, scale=[1, 1, 1],
                           footprint=ring, precision='estimated', headingBasis=f"photo face {b['faces'][0]['facing']} on source edge {e} facing {b['faces'][0]['street']}",
                           label={'name': b['name'], 'sub': '照片结构参考 · 尺寸估计', 'y': round(top + 2, 1)}))
    report.append(dict(id=b['id'], sourceId=b['sourceId'], renderedReplaceIds=rendered_ids, faces=chosen, modelTopM=round(top, 2), heightEvidence=b.get('heightEvidence')))

out = dict(version=1, basis=evidence['basis'], studies=studies, placements=placements)
(ROOT / 'prototypes/p2/facade-studies.json').write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
(ROOT / 'docs/research/p3-building-expansion').mkdir(parents=True, exist_ok=True)
(ROOT / 'docs/research/p3-building-expansion/edges.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
for r in report:
    f0 = r['faces'][0]
    print(r['id'], r['sourceId'], 'edge', f0['edge'], f0['lengthM'], 'm', f0['compass'], 'deg', f0['street'], f0['streetDistM'], 'm', 'top', r['modelTopM'], 'rendered', r['renderedReplaceIds'])
