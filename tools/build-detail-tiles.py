"""P3 packaging: city-coordinate placement and two adjoining ground-road tiles."""
from pathlib import Path
import json,gzip,struct,math,hashlib
from shapely.geometry import shape,LineString,Polygon,box
from shapely.ops import unary_union,substring
from road_markings import package_markings
from road_layers import classify_way
from detail_placement import place_self_fitted
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'data/detail';OUT.mkdir(exist_ok=True)
load=lambda p:json.loads(p.read_text())
m=load(ROOT/'data/guangzhou.json');origin=m['origin'];raw=gzip.decompress((ROOT/'data'/m['files'][0]['name']).read_bytes())
def section(name):
 s=m['sections'][name];return struct.unpack_from('<'+'f'*s['length'],raw,s['offset'])
i=m['sections']['renderIdentity'];ids=json.loads(raw[i['offset']:i['offset']+i['length']])
rp=section('roadPts');rm=section('roadMeta');widths={id:rm[k*8+2] for k,id in enumerate(ids['roads'])}
proj=lambda lon,lat:((lon-origin['lon'])*origin['kx'],-(lat-origin['lat'])*origin['kz'])
features=load(ROOT/'docs/research/p0-2026-09-25/shamian-osm-buildings.geojson')['features']
byid={f['properties']['id']:f for f in features}
samples=load(ROOT/'prototypes/p2/samples.json')
controls=load(ROOT/'data/evidence/building-controls.json')
for sample in samples['buildings'].values():
 extra=controls['entities'].get(sample['sourceId'],{})
 if extra:
  sample.update(extra)
  sample['controlSources']={k:v for k,v in controls['sources'].items() if k in [extra['verticalControl']['sourceId'],extra.get('eastLoggia',{}).get('sourceId')]}
placements=[]
for sid,id in [('B1','w352610322'),('B2','w352610258'),('B3','w392765468')]:
 ring=[proj(*p)for p in byid[id]['geometry']['coordinates'][0][:-1]];poly=Polygon(ring);rect=list(poly.minimum_rotated_rectangle.exterior.coords)[:-1];c=poly.minimum_rotated_rectangle.centroid
 edges=[(rect[k],rect[(k+1)%4])for k in range(4)];short=min(math.dist(a,b)for a,b in edges)
 options=[(a,b)for a,b in edges if math.dist(a,b)<short*1.01]
 a,b=(min if sid=='B2'else max)(options,key=lambda e:(e[0][1]+e[1][1])/2)
 mid=((a[0]+b[0])/2,(a[1]+b[1])/2);normal=(mid[0]-c.x,mid[1]-c.y);length=math.hypot(*normal);normal=(normal[0]/length,normal[1]/length)
 shift=1.6 if sid=='B3'else 0
 placements.append({'sampleId':sid,'sourceId':'osm:'+id,'replaceIds':['osm:'+id]+(['osm:w1521332870']if sid=='B3'else []),
  'position':[c.x-normal[0]*shift,0,c.y-normal[1]*shift],'rotationY':math.atan2(normal[0],normal[1]),'footprint':ring,
  'precision':'estimated','headingBasis':'short north edge / photo interpretation; geographic heading provisional'if sid=='B2'else 'short south edge facing Shamian street',
  'scale':[short/samples['buildings'][sid]['width'],1,max(math.dist(a,b)for a,b in edges)/samples['buildings'][sid]['depth']],
  'integration':{'status':'default','since':'2026-09-25','record':'docs/P3-首批城市集成-2026-09-25.md'}})
 if samples['buildings'][sid].get('verticalControl'):
  placements[-1]['heightReference']=samples['buildings'][sid]['verticalControl']
  placements[-1]['headingBasis']='photo face F0 provisionally on north short edge; reported main entrance street is to east, not identified with F0'
LABELS={'B1':('台湾银行旧址',None,14),'B2':('沙面一街3号',None,None),'B3':('露德圣母堂',None,23)}
for placement in placements:
 name,sub,y=LABELS[placement['sampleId']];ref=placement.get('heightReference')
 placement['label']={'name':name,'sub':f"文献檐高 {ref['value']}m · 其余尺寸估计" if ref else '精细外观参考 · 尺寸估计','y':ref['value']+2 if ref else y}
def bounds_all(polys):return list(unary_union([Polygon(p)for p in polys]).bounds)
# Correspondence uses the actual source vertices, including the church tower setback.
# This corrects the nominal horizontal plan only: heights and ornaments remain estimates.
fit_report=[]
for placement in placements:
 sid=placement['sampleId'];sample=samples['buildings'][sid];w=sample['width'];d=sample['depth']
 if sid=='B3':
  d-=3.2;z=d/2;tw=3.55
  nominal=[[-w/2,-z],[w/2,-z],[w/2,z],[tw/2,z],[tw/2,z+3.2],[-tw/2,z+3.2],[-tw/2,z],[-w/2,z]]
 else:nominal=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]
 angle=placement['rotationY'];co=math.cos(angle);si=math.sin(angle);px,_,pz=placement['position'];sx,_,sz=placement['scale']
 local=[]
 for x,z in placement['footprint']:
  dx=x-px;dz=z-pz;local.append([(co*dx-si*dz)/sx,(si*dx+co*dz)/sz])
 assert len(local)==len(nominal),sid
 variants=[]
 for ring in [local,list(reversed(local))]:
  if Polygon(ring).exterior.is_ccw!=Polygon(nominal).exterior.is_ccw:continue
  for k in range(len(ring)):
   q=ring[k:]+ring[:k];variants.append((sum(math.dist(a,b)**2 for a,b in zip(nominal,q)),q))
 target=min(variants,key=lambda q:q[0])[1]
 sample['planFit']={'source':nominal,'target':target,'basis':'OSM snapshot outline; horizontal fit only','metricAccuracy':'unverified'}
 old=Polygon([(px+co*x*sx+si*z*sz,pz-si*x*sx+co*z*sz)for x,z in nominal]);source=Polygon(placement['footprint'])
 fit_report.append({'sampleId':sid,'sourceId':placement['sourceId'],'beforePlanIoU':round(old.intersection(source).area/old.union(source).area,6),'beforeControlMaxOffsetM':round(max(math.hypot((a[0]-b[0])*sx,(a[1]-b[1])*sz)for a,b in zip(nominal,target)),4),'sourceAreaM2':round(source.area,3),'metricAccuracy':'unverified'})
(OUT/'building-fit-report.json').write_text(json.dumps({'basis':'nominal structural plan vs fixed OSM outline; excludes ornaments and is not independent geographic accuracy','buildings':fit_report},ensure_ascii=False,indent=2)+'\n')
manifest={'version':1,'acceptedPrototype':'P2 / user continued to P3','baseOsmTimestamp':m['osmTimestamp'],'precision':'estimated','coordinateSystem':{'kind':'existing-city-local','origin':origin},'tiles':[]}
def save_tile(name,payload,entry):
 data=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode();(OUT/(name+'.json')).write_bytes(data)
 entry.update(id=name,url=f'./data/detail/{name}.json',bytes=len(data),sha256=hashlib.sha256(data).hexdigest());manifest['tiles'].append(entry)
save_tile('shamian',{'version':1,'samples':{'buildings':samples['buildings']}},{'kind':'buildings','bounds':bounds_all([p['footprint']for p in placements]),'buildings':placements})

# Shamian west block: C01/C02 promoted from the isolated trial after P3 acceptance (2026-09-26).
# Parameters come unchanged from the P2 inputs; only the source control points are baked into
# the city frame. Heights, porch depth and uncovered faces stay estimated/unknown.
west_samples={};west_block=[]
WEST_LABELS={'C01':('基督教沙面会堂',21.4),'C02':('正金银行旧址',18.4)}
for sid in ['C01','C02']:
 sample=load(ROOT/f'prototypes/p2/{sid.lower()}.json')
 assert sample.get('productionEligible') is True and sample['measuredHeightM'] is None and sample['heightStatus']=='estimated',sid
 oid=sample['sourceId'].split(':')[1];ring=[proj(*p)for p in byid[oid]['geometry']['coordinates'][0][:-1]]
 placement=place_self_fitted(sid,sample,ring,lambda p:proj(*p))
 name,y=WEST_LABELS[sid]
 placement['label']={'name':name,'sub':'精细外观参考 · 高度与细部尺寸估计','y':y}
 placement['integration']={'status':'default','since':'2026-09-26','record':sample['productionGate']['acceptanceRecord']}
 west_samples[sid]=sample;west_block.append(placement)
save_tile('shamian-west',{'version':1,'samples':{'buildings':west_samples}},{'kind':'buildings','bounds':bounds_all([p['footprint']for p in west_block]),'buildings':west_block})

# 沙面大街 row: facade studies promoted after staging (data/evidence/facade-studies.json gate).
fs=load(ROOT/'prototypes/p2/facade-studies.json')
central=[dict(p,integration={'status':'default','since':fs['studies'][p['sampleId']]['productionGate']['since'],'record':fs['studies'][p['sampleId']]['productionGate']['acceptanceRecord']}) for p in fs['placements'] if fs['studies'][p['sampleId']]['productionEligible']]
if central:
 save_tile('shamian-dajie',{'version':1,'samples':{'buildings':{p['sampleId']:fs['studies'][p['sampleId']] for p in central}}},{'kind':'buildings','bounds':bounds_all([p['footprint']for p in central]),'buildings':central})

# Keep production road widths and city projection; retain base traffic/road alignment.
world_roi=box(*[0,0,1,1]);west,north=proj(113.3112,23.1234);east,south=proj(113.3177,23.1204)
roi=box(west,north,east,south);mid=proj(113.3144,23.12)[0]
rawosm=load(ROOT/'data/evidence/huacheng-osm.json')['elements'];nodes={e['id']:e for e in rawosm if e['type']=='node'}
source_ways={'osm:w'+str(e['id']):e for e in rawosm if e['type']=='way' and e.get('tags',{}).get('highway')}
roads=[]
for k,id in enumerate(ids['roads']):
 p0,n,w,cls,lanes,flags=rm[k*8:k*8+6];p0=int(p0);n=int(n)
 if int(flags)&1 or int(cls)==3:continue
 if id in source_ways and not classify_way(source_ways[id]['tags'])['groundRenderable']:continue
 pts=[[rp[(p0+j)*4],rp[(p0+j)*4+1]]for j in range(n)]
 g=LineString(pts).intersection(roi)
 if not g.is_empty:roads.append((id,g,w))
surface=unary_union([g.buffer(w/2,cap_style='flat',join_style='round',quad_segs=8)for _,g,w in roads]).intersection(roi)
crossings=[];ped=[];marking_sources=[]
for e in rawosm:
 t=e.get('tags',{})
 if e['type']!='way' or t.get('highway') not in ['footway','pedestrian'] or not classify_way(t)['groundRenderable']:continue
 if not all(n in nodes for n in e['nodes']):continue
 full_line=LineString([proj(nodes[n]['lon'],nodes[n]['lat'])for n in e['nodes']]);g=full_line.intersection(roi)
 if t.get('footway')=='crossing' and full_line.buffer(1.55).intersects(roi):marking_sources.append(('osm:w'+str(e['id']),full_line,t))
 if not g.is_empty:ped.append(g)
 if t.get('footway')=='crossing'and not g.is_empty:crossings.append(('osm:w'+str(e['id']),g,t))
# Mapped sidewalk centrelines are source positions; lane-count widths are defaults. Where the estimated
# carriageway reaches a mapped sidewalk (±0.85 m strip, 2 m trimmed at each end so crossings stay open),
# the carriageway yields. The sidewalk width itself is still unknown.
sidewalk_strips=[]
for e in rawosm:
 t=e.get('tags',{})
 if e['type']!='way' or t.get('footway')!='sidewalk' or not classify_way(t)['groundRenderable'] or not all(n in nodes for n in e['nodes']):continue
 line=LineString([proj(nodes[n]['lon'],nodes[n]['lat'])for n in e['nodes']])
 if line.length>5:sidewalk_strips.append(substring(line,2,line.length-2).buffer(.85,cap_style='flat'))
before_area=surface.area;surface=surface.difference(unary_union(sidewalk_strips));sidewalk_yield=round(before_area-surface.area,1)
walk=surface.buffer(2.3).union(unary_union(ped).buffer(.85)).difference(surface).intersection(roi)
# Avoid paving over mapped buildings; road imagery and raw source footprints remain separate facts.
building_polys=[]
for f in load(ROOT/'docs/research/p0-2026-09-25/huacheng-osm-buildings.geojson')['features']:
 if f['geometry']['type']=='Polygon':building_polys.append(Polygon([proj(*p)for p in f['geometry']['coordinates'][0]]))
walk=walk.difference(unary_union(building_polys))
def parts(g):return list(g.geoms)if hasattr(g,'geoms')else[g]
for name,area,slot in [('huasui',box(west,north,mid,south),0),('huaxia',box(mid,north,east,south),1)]:
 cx,cz=area.centroid.x,area.centroid.y
 def local(coords):return [[x-cx,z-cz]for x,z in coords]
 def polys(g):return [{'outer':local(p.exterior.coords),'holes':[local(h.coords)for h in p.interiors]}for p in parts(g)if p.geom_type=='Polygon'and p.area>.01]
 lines=[];cross=[]
 for id,g,w in roads:
  for p in parts(g.intersection(area)):
   if p.geom_type=='LineString'and p.length>.1:lines.append({'sourceId':id,'kind':'road','points':local(p.coords),'width':w,'widthStatus':'estimated'})
 for id,g,t in crossings:
  for p in parts(g.intersection(area)):
   if p.geom_type=='LineString'and p.length>.1:cross.append({'sourceId':id,'points':local(p.coords),'tags':t})
 deferred=[];ground_paths=[]
 for source_id,e in source_ways.items():
  if not all(n in nodes for n in e.get('nodes',[])) or len(e.get('nodes',[]))<2:continue
  path=LineString([proj(nodes[n]['lon'],nodes[n]['lat'])for n in e['nodes']])
  if not path.intersects(area):continue
  classification=classify_way(e['tags'])
  if not classification['groundRenderable']:deferred.append({'sourceId':source_id,'kind':classification['kind'],'heightStatus':'unknown'})
  elif e['tags']['highway'] in ['footway','pedestrian']:ground_paths.append(source_id)
 road={'production':True,'sourceId':'osmHuacheng','widthStatus':'estimated','surfaceRule':'lane-count width estimate; yields to mapped sidewalk centreline strips (±0.85 m, ends trimmed 2 m)','sidewalkYieldRoiM2':sidewalk_yield,'surfaces':polys(surface.intersection(area)),'walkways':polys(walk.intersection(area)), 'lines':lines,'crossings':cross,'restrictions':[],'groundPathSourceIds':ground_paths,'deferredStructures':deferred}
 road.update(package_markings(marking_sources,surface,area,(cx,cz)))
 save_tile(name,{'version':1,'samples':{'road':road}},{'kind':'roads','slot':slot,'bounds':list(area.bounds),'position':[cx,0,cz],'precision':'estimated'})
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print('Packaged',len(placements)+len(west_block)+len(central),'buildings in three blocks, two road tiles;',round(east-west),'m east-west bounding span (not road length)')
