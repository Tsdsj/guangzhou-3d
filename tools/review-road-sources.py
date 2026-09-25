"""Build a reproducible review and additive network delta from captured OSM responses."""
from pathlib import Path
from collections import Counter
import json,hashlib
from road_source_review import classify_endpoint,merge_network
from road_markings import marking_policy
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/research/p3-source-review-2026-09-26'
read=lambda p:json.loads(p.read_text())
sources=read(OUT/'sources.json');fresh={};loaded={}
for rec in sources['requests']:
 if rec['status']!='ok':raise ValueError('Cannot seal incomplete fetch: '+rec['file'])
 body=(OUT/rec['file']).read_bytes()
 if hashlib.sha256(body).hexdigest()!=rec['sha256']:raise ValueError('Response checksum mismatch')
 loaded[rec['file']]=json.loads(body)['elements']
 for e in loaded[rec['file']]:
  key=(e['type'],e['id'])
  if key in fresh and any(fresh[key].get(k)!=e.get(k)for k in ['version','nodes','tags','lat','lon','visible']):raise ValueError('Mixed object versions in captured responses')
  fresh[key]=e
base_path=ROOT/'data/evidence/huacheng-osm.json';base_bytes=base_path.read_bytes();base=json.loads(base_bytes);original={(e['type'],e['id']):e for e in base['elements']}
changed=[key for key,e in fresh.items() if key in original and any(original[key].get(k)!=e.get(k)for k in ['version','nodes','lat','lon','tags'])]
if changed:raise ValueError('Base objects changed; a separately reviewed rebase is required: '+str(changed))
added=[e for k,e in fresh.items()if k not in original]
delta={'version':1,'baseSource':'osmHuacheng','baseSha256':hashlib.sha256(base_bytes).hexdigest(),'sourceManifest':'docs/research/p3-source-review-2026-09-26/sources.json','license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','mode':'add-only; render data not refreshed','elements':sorted(added,key=lambda e:(e['type'],e['id']))}
merged=merge_network(base_bytes,delta)
(ROOT/'data/evidence/huacheng-review-delta.json').write_text(json.dumps(delta,ensure_ascii=False,indent=2)+'\n')
audit=read(ROOT/'docs/research/p3-road-layers/audit.json');way_rows=[]
for old in audit['specialWays']:
 if old['endpointStatus']=='both-attached':continue
 id=int(old['sourceId'].split(':w')[1]);current=fresh.get(('way',id));endpoints=[]
 for p in old['endpoints']:
  if p['attachedWays']:continue
  nid=int(p['nodeId'].split(':n')[1]);file=f'node-{nid}-ways.json';node=fresh.get(('node',nid))
  result=classify_endpoint(node,current,loaded.get(file))
  endpoints.append({'nodeId':p['nodeId'],'position':p['position'],'responseFile':file,'originalInsideSourceBbox':p['insideSourceBbox'],**result})
 statuses={e['status']for e in endpoints}
 if statuses&{'incomplete-source','endpoint-changed','unresolved'}:status='needs-evidence'
 elif statuses=={'highway-connection'}:status='connection-recovered'
 elif statuses=={'building-interface'}:status='building-interface'
 elif statuses=={'tagged-terminal'}:status='tagged-terminal'
 else:status='explained-mixed'
 way_rows.append({'sourceId':old['sourceId'],'kind':old['kind'],'oldStatus':old['endpointStatus'],'status':status,'wayVersion':current.get('version') if current else None,'endpoints':endpoints,'physicalPassabilityVerified':False})
mark_rows=[]
for old in read(ROOT/'docs/research/p3-road-markings/after.json')['deferred']:
 id=int(old['sourceId'].split(':w')[1]);w=fresh[('way',id)]
 mark_rows.append({'sourceId':old['sourceId'],'previousStatus':old['status'],'currentStatus':marking_policy(w['tags'])['status'],'wayVersion':w['version'],'tags':w['tags'],'responseFile':'selected-ways.json','nodeEvidence':[{'nodeId':'osm:n'+str(n),'version':fresh[('node',n)]['version'],'tags':fresh[('node',n)].get('tags',{})}for n in w['nodes']if fresh[('node',n)].get('tags')],'geometryAndTagsChanged':False,'renderDecision':'deferred-no-new-independent-evidence'})
report={'date':'2026-09-26','sourceWindowUTC':{'start':min(x['retrievedAt']for x in sources['requests']),'end':max(x['retrievedAt']for x in sources['requests'])},'requestCount':len(sources['requests']),'sourceErrors':0,'endpointSummary':dict(Counter(w['status']for w in way_rows)),'endpoints':way_rows,'markingSummary':dict(Counter(w['currentStatus']for w in mark_rows)),'markings':mark_rows,'deltaSummary':dict(Counter(e['type']for e in added)),'deltaFile':'data/evidence/huacheng-review-delta.json','unchangedExistingObjects':sum(k in original for k in fresh),'baseSnapshotUnchanged':True,'renderGeometryUpdated':False,'limits':['current OSM records are not a current physical-site survey','building boundary references do not establish indoor connectivity or connector height','terminal tags do not establish current access/opening conditions','repeated conflicting tags on a node and way are not independent confirmation']}
(OUT/'review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items()if k not in ['endpoints','markings','limits']},ensure_ascii=False,indent=2))
