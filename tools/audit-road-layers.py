"""Audit special road structures and source-node attachments without inventing heights."""
from pathlib import Path
from collections import defaultdict,Counter
import json,hashlib
from shapely.geometry import LineString,Point,box
from road_layers import classify_way
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/research/p3-road-layers';OUT.mkdir(exist_ok=True)
read=lambda p:json.loads(p.read_text())
source=ROOT/'data/evidence/huacheng-osm.json';elements=read(source)['elements']
source_bbox=next(n['bbox']for n in read(ROOT/'data/evidence/manifest.json')['networks']if n['id']=='osmHuacheng');source_area=box(*source_bbox)
nodes={e['id']:e for e in elements if e['type']=='node'}
ways={e['id']:e for e in elements if e['type']=='way' and e.get('tags',{}).get('highway')}
incident=defaultdict(set)
for id,w in ways.items():
 for n in w.get('nodes',[]):incident[n].add(id)
roi=box(113.3112,23.1204,113.3177,23.1234);rows=[];in_scope={};missing=[]
for id,w in ways.items():
 if len(w.get('nodes',[]))<2 or not all(n in nodes for n in w['nodes']):missing.append('osm:w'+str(id));continue
 points=[(nodes[n]['lon'],nodes[n]['lat']) for n in w['nodes']]
 g=LineString(points)
 if not g.intersects(roi):continue
 verdict=classify_way(w['tags']);in_scope[id]=verdict
 if verdict['groundRenderable']:continue
 endpoints=[]
 for n in [w['nodes'][0],w['nodes'][-1]]:
  links=[{'sourceId':'osm:w'+str(other),'kind':classify_way(ways[other]['tags'])['kind']}for other in sorted(incident[n]-{id})]
  position=[nodes[n]['lon'],nodes[n]['lat']]
  endpoints.append({'nodeId':'osm:n'+str(n),'position':position,'nodeTags':nodes[n].get('tags',{}),'insideSourceBbox':source_area.covers(Point(position)),'attachedWays':links})
 unattached=[e for e in endpoints if not e['attachedWays']]
 status='both-attached' if not unattached else 'outside-snapshot' if all(not e['insideSourceBbox']for e in unattached) else 'needs-source-review'
 rows.append({'sourceId':'osm:w'+str(id),'tags':w['tags'],**verdict,'points':points,'endpoints':endpoints,'endpointStatus':status})
manifest=read(ROOT/'data/detail/manifest.json');checked=set();unresolved=set();violations=[]
for tile in manifest['tiles']:
 if tile['kind']!='roads':continue
 r=read(ROOT/tile['url'])['samples']['road']
 for rec in r['lines']+r['crossings']+[{'sourceId':id}for id in r['groundPathSourceIds']]:
  sid=rec['sourceId'];id=int(sid.split(':w')[1]);checked.add(sid)
  if id not in ways:unresolved.add(sid);continue
  if not classify_way(ways[id]['tags'])['groundRenderable']:violations.append({'tile':tile['id'],'sourceId':sid})
assert not violations,violations
report={'date':'2026-09-26','scopeBbox':list(roi.bounds),'sourceBbox':source_bbox,'sourceFile':'data/evidence/huacheng-osm.json','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'wayCountInScope':len(in_scope),'kindCounts':dict(Counter(v['kind']for v in in_scope.values())),'specialWays':rows,'endpointSummary':dict(Counter(r['endpointStatus']for r in rows)),'renderAudit':{'checkedUniqueSourceIds':len(checked),'unresolvedSourceIds':sorted(unresolved),'nonGroundInSurface':violations},'sourceGeometryIncomplete':missing,'limits':['layer and level are not metric heights','shared node membership is not a claim of legal access or physical passability','full source way endpoints used; ROI cuts are not invented graph nodes','special ways remain in the evidence network but have no new 3D geometry']}
(OUT/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items()if k not in ['specialWays','limits']},ensure_ascii=False,indent=2))
for r in rows:
 if r['kind']=='vertical-transition':print(r['sourceId'],r['endpointStatus'],[[p['kind']for p in e['attachedWays']] for e in r['endpoints']])
