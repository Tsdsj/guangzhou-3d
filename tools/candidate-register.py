"""Shamian asset-production register (P4): every study-area outline with its evidence state.

States, strongest first:
  detailed            integrated in data/detail/manifest.json
  photo-and-address   OSM addr matches a Commons photo titled with that address (ready for a facade study)
  identity-only       OSM name or address, no matched free photo yet
  outline-only        no name/address in the snapshot; needs identity work before any modelling
Address-titled Commons photos that match no OSM address are listed separately: they need a position
or plan match before use, never a guess from proximity alone.
Run: .research/p0-2026-09-25/.venv/bin/python tools/candidate-register.py
"""
from pathlib import Path
import json, re, csv

ROOT = Path(__file__).resolve().parents[1]
load = lambda p: json.loads((ROOT / p).read_text())
coverage = load('docs/research/p4-coverage/coverage.json')
feats = {'osm:' + f['properties']['id']: f['properties'] for f in load('docs/research/p0-2026-09-25/shamian-osm-buildings.geojson')['features']}
search = load('docs/research/p3-building-expansion/commons-search.json')
cats = load('docs/research/p3-building-expansion/commons-categories.json')
titles = sorted({t for v in search.values() for t in (v['hits'] or [])} | {t for v in cats.values() for t in (v['members'] or []) if t.startswith('File:')})

STREETS = {'大街': '沙面大街', '南街': '沙面南街', '北街': '沙面北街', '一街': '沙面一街', '二街': '沙面二街', '三街': '沙面三街', '四街': '沙面四街', '五街': '沙面五街'}
photo_addr = {}
for t in titles:
    m = re.match(r'File:沙面(大街|南街|北街|一街|二街|三街|四街|五街)([0-9、\-]+)号', t)
    if not m:
        continue
    for num in re.split('[、]', m.group(2)):
        photo_addr.setdefault((STREETS[m.group(1)], num), []).append(t)
studies = load('prototypes/p2/facade-studies.json')['studies']
rows, matched = [], set()
for b in coverage['buildings']:
    p = feats.get(b['sourceId'], {})
    street, nums = p.get('addr:street'), [n.strip() for n in (p.get('addr:housenumber') or '').replace(';', ',').split(',') if n.strip()]
    photos = sorted({t for n in nums for t in photo_addr.get((street, n), [])})
    matched |= {(street, n) for n in nums if (street, n) in photo_addr}
    state = 'detailed' if b['sample'] else 'photo-and-address' if photos else 'identity-only' if (p.get('name') or nums) else 'outline-only'
    rows.append(dict(sourceId=b['sourceId'], state=state, sample=b['sample'], name=p.get('name'), address=f"{street or ''}{'/'.join(nums)}" if nums else None,
                     levelsTag=p.get('building:levels'), photos=photos, streetFacadeM2=b['streetFacadeM2']))
unmatched = sorted(f"{s}{n}号" for (s, n) in photo_addr if (s, n) not in matched)
summary = {}
for r in rows:
    summary[r['state']] = summary.get(r['state'], 0) + 1
out = ROOT / 'docs/research/p4-coverage'
(out / 'register.json').write_text(json.dumps(dict(date='2026-09-26', states=summary, unmatchedAddressPhotos=unmatched, rows=rows), ensure_ascii=False, indent=1) + '\n')
with open(out / 'register.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['sourceId', 'state', 'sample', 'name', 'address', 'levelsTag', 'photoCount', 'streetFacadeM2'])
    for r in sorted(rows, key=lambda r: (['detailed', 'photo-and-address', 'identity-only', 'outline-only'].index(r['state']), -r['streetFacadeM2'])):
        w.writerow([r['sourceId'], r['state'], r['sample'] or '', r['name'] or '', r['address'] or '', r['levelsTag'] or '', len(r['photos']), r['streetFacadeM2']])
print(json.dumps(summary, ensure_ascii=False), 'unmatched address photos:', len(unmatched))
for r in rows:
    if r['state'] == 'photo-and-address':
        print('  ready', r['sourceId'], r['name'], r['address'], r['photos'])
