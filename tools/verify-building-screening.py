from pathlib import Path
import json,hashlib,math
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'docs/research/p3-building-screening';load=lambda p:json.loads(p.read_text())
r=load(D/'candidates.json');extra=load(D/'outline-screening.geojson')['features'];cs=r['buildingCandidates']
assert len(extra)==63 and len({f['properties']['id'] for f in extra})==63
assert len(cs)==12 and len({c['sourceId'] for c in cs})==12
assert not(set(c['sourceId'] for c in cs)&set(r['existingModelsExcluded']))
for p,h in r['sourceHashes'].items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h
for c in cs:
 assert not c['productionEligible'] and c['measuredHeightM'] is None
 assert c['areaM2']>0 and all(map(math.isfinite,c['centroid']))
 if c['photo'] and c['photo']['path']:
  p=c['photo'];assert hashlib.sha256((ROOT/p['path']).read_bytes()).hexdigest()==p['sha256'];assert p['license']=='CC BY-SA 4.0' and p['artist'] and p['page_url']
for f in extra:
 p=f['properties'];assert not p['productionEligible'];assert p['areaM2']>0 and math.isfinite(p['areaM2']);assert p['height'] is None
for p,h in load(ROOT/'.research/p2/main-data-baseline.json').items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h
for p,h in load(ROOT/'docs/research/p3-skybridge/validation.json')['detailHashes'].items():assert hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h
v=dict(date='2026-09-26',sourceHashesVerified=True,sourceBoundCandidateCount=12,screenedOutlineCount=63,visuallyReviewedPhotos=sum(bool(c['photo'] and c['photo']['reviewStatus']=='visually-reviewed-partial-facade') for c in cs),metadataOnlyPhotos=1,productionReadyCount=0,baseAndDetailHashesUnchanged=True,newGeometryRendered=False,notes='仅验证研究数据；不代替项目测试或新增视觉模型验收')
(D/'validation.json').write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n');print(json.dumps(v,ensure_ascii=False))
