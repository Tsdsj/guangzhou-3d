"""Staging manifest for the opt-in inspection entry (?detailTrial=inspect).

trial-manifest.json = the default manifest + staged candidate tiles (trialOnly). It never edits the
default manifest or existing city packages. C01/C02 were staged here (2026-09-26) and promoted to the
default 'shamian-west' block after the P3 trial acceptance; staging a sample that is already in the
default manifest is refused, because two tiles replacing the same source IDs would conflict.
"""
from pathlib import Path
import json,hashlib,copy
from shapely.geometry import Polygon
from detail_placement import SELF_FITTED,place_self_fitted
ROOT=Path(__file__).resolve().parents[1];load=lambda p:json.loads(p.read_text());OUT=ROOT/'data/detail'
STAGED=[]  # sample IDs awaiting promotion; each needs a prototype model and an entry in SELF_FITTED
manifest=copy.deepcopy(load(OUT/'manifest.json'));manifest['trialOnly']=True
origin=manifest['coordinateSystem']['origin'];project=lambda p:((p[0]-origin['lon'])*origin['kx'],-(p[1]-origin['lat'])*origin['kz'])
promoted={b['sampleId'] for t in manifest['tiles'] for b in t.get('buildings',[])}
replaced={i for t in manifest['tiles'] for b in t.get('buildings',[]) for i in b['replaceIds']}
raw=load(ROOT/'docs/research/p0-2026-09-25/shamian-osm-buildings.geojson')['features'];features={f['properties']['id']:f for f in raw};report=[]
for sid in STAGED:
 assert sid not in promoted,f'{sid} is already in the default manifest'
 s=load(ROOT/f'prototypes/p2/{sid.lower()}.json');oid=SELF_FITTED[sid]['osm']
 ring=[project(p) for p in features[oid]['geometry']['coordinates'][0][:-1]]
 placement=place_self_fitted(sid,s,ring,project);s['trialOnly']=True
 assert not replaced&set(placement['replaceIds']),f'{sid} replaces a record owned by a default tile'
 placement['label']={'name':s['name'],'sub':'暂存候选 · 尺寸估计','y':(s.get('parameters') or {}).get('towerTopM',16)+2}
 name='trial-'+sid.lower();payload=dict(version=1,trialOnly=True,samples={'buildings':{sid:s}});bytes=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode();(OUT/(name+'.json')).write_bytes(bytes)
 tile=dict(id=name,kind='buildings',trialOnly=True,url=f'./data/detail/{name}.json',bytes=len(bytes),sha256=hashlib.sha256(bytes).hexdigest(),bounds=list(Polygon(ring).bounds),buildings=[placement]);manifest['tiles'].append(tile)
 report.append(dict(id=sid,sourceId=placement['sourceId'],replaceIds=placement['replaceIds'],position=placement['position'],rotationY=placement['rotationY']))
# Facade studies (data/evidence/facade-studies.json -> tools/build-facade-studies.py) stay staged until promoted.
fs=load(ROOT/'prototypes/p2/facade-studies.json')
staged=[dict(p,label=dict(p['label'],sub='暂存候选 · 尺寸估计')) for p in fs['placements'] if p['sampleId'] not in promoted and not fs['studies'][p['sampleId']]['productionEligible']]
for p in staged:assert not replaced&set(p['replaceIds']),f"{p['sampleId']} replaces a record owned by a default tile"
if staged:
 name='trial-shamian-dajie';payload=dict(version=1,trialOnly=True,samples={'buildings':{p['sampleId']:dict(fs['studies'][p['sampleId']],trialOnly=True) for p in staged}})
 bytes=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode();(OUT/(name+'.json')).write_bytes(bytes)
 from shapely.ops import unary_union
 manifest['tiles'].append(dict(id=name,kind='buildings',trialOnly=True,url=f'./data/detail/{name}.json',bytes=len(bytes),sha256=hashlib.sha256(bytes).hexdigest(),bounds=list(unary_union([Polygon(p['footprint']) for p in staged]).bounds),buildings=staged))
 report+= [dict(id=p['sampleId'],sourceId=p['sourceId'],replaceIds=p['replaceIds']) for p in staged]
(OUT/'trial-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'defaultTiles':sum(1 for t in manifest['tiles'] if not t.get('trialOnly')),'stagedTiles':sum(1 for t in manifest['tiles'] if t.get('trialOnly')),'staged':report},ensure_ascii=False))
