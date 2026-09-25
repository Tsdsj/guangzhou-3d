"""Bounded, read-only OSM refresh for the P3 review list. Never edits base snapshots."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
import json,urllib.request,hashlib
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/research/p3-source-review-2026-09-26';OUT.mkdir(exist_ok=True)
read=lambda p:json.loads(p.read_text())
audit=read(ROOT/'docs/research/p3-road-layers/audit.json');marks=read(ROOT/'docs/research/p3-road-markings/after.json')
targets=[w for w in audit['specialWays']if w['endpointStatus']!='both-attached']
node_ids=sorted({int(p['nodeId'].split(':n')[1])for w in targets for p in w['endpoints']if not p['attachedWays']})
way_ids=sorted({int(w['sourceId'].split(':w')[1])for w in targets+marks['deferred']})
manifest=read(OUT/'sources.json') if (OUT/'sources.json').exists() else {'date':'2026-09-26','license':'ODbL-1.0','attribution':'© OpenStreetMap contributors','requests':[]}
known={x['file']:x for x in manifest['requests']}
def fetch(spec):
 name,url=spec;path=OUT/name
 if path.exists() and known.get(name,{}).get('status')=='ok':
  if known[name]['url']!=url:raise ValueError('Review targets changed; use a new snapshot directory')
  if hashlib.sha256(path.read_bytes()).hexdigest()!=known[name]['sha256']:raise ValueError('Cached response checksum mismatch: '+name)
  return known[name]
 entry={'file':name,'url':url,'retrievedAt':datetime.now(timezone.utc).isoformat()}
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'3D-guangzhou-source-review/1.0 (https://github.com/Tsdsj/guangzhou-3d)','Accept':'application/json'})
  with urllib.request.urlopen(req,timeout=25) as response:body=response.read();entry['serverDate']=response.headers.get('Date')
  obj=json.loads(body)
  if not isinstance(obj.get('elements'),list):raise ValueError('OSM elements missing')
  path.write_bytes(body);entry.update(sha256=hashlib.sha256(body).hexdigest(),bytes=len(body),status='ok');print('OK',name,len(obj['elements']),flush=True)
 except Exception as e:entry.update(status='error',error=str(e));print('ERROR',name,str(e),flush=True)
 return entry
def run(specs):
 with ThreadPoolExecutor(max_workers=2) as pool:
  for entry in pool.map(fetch,specs):known[entry['file']]=entry
 manifest['requests']=list(known.values());(OUT/'sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
run([('selected-ways.json','https://api.openstreetmap.org/api/0.6/ways.json?ways='+','.join(map(str,way_ids)))]+[(f'node-{n}-ways.json',f'https://api.openstreetmap.org/api/0.6/node/{n}/ways.json')for n in node_ids])
all_nodes=set(node_ids)
for entry in known.values():
 if entry['status']=='ok' and ('ways' in entry['file']):
  for w in read(OUT/entry['file'])['elements']:
   if w['type']=='way':all_nodes.update(w.get('nodes',[]))
all_nodes=sorted(all_nodes)
run([(f'nodes-{i//100:02}.json','https://api.openstreetmap.org/api/0.6/nodes.json?nodes='+','.join(map(str,all_nodes[i:i+100])))for i in range(0,len(all_nodes),100)])
print('REQUESTS',len(manifest['requests']),'ERRORS',sum(e['status']!='ok'for e in manifest['requests']),flush=True)
