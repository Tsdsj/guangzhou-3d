"""Opt-in trial tiles; never edits the default manifest or existing city packages."""
from pathlib import Path
import json,math,hashlib,copy
from shapely.geometry import Polygon
ROOT=Path(__file__).resolve().parents[1];load=lambda p:json.loads(p.read_text());OUT=ROOT/'data/detail'
manifest=copy.deepcopy(load(OUT/'manifest.json'));manifest['trialOnly']=True
origin=manifest['coordinateSystem']['origin'];project=lambda p:((p[0]-origin['lon'])*origin['kx'],-(p[1]-origin['lat'])*origin['kz'])
raw=load(ROOT/'docs/research/p0-2026-09-25/shamian-osm-buildings.geojson')['features'];features={f['properties']['id']:f for f in raw};report=[]
for sid,oid,replace in [('C01','w509641361',['osm:w509641361','osm:w509641363']),('C02','w352610288',['osm:w352610288'])]:
 s=load(ROOT/f'prototypes/p2/{sid.lower()}.json');ring=[project(p) for p in features[oid]['geometry']['coordinates'][0][:-1]];px,pz=project(s['origin'])
 a,b=(ring[0],ring[7]) if sid=='C01' else (ring[2],ring[1]);theta=-math.atan2(b[1]-a[1],b[0]-a[0]);co,si=math.cos(theta),math.sin(theta)
 # Bake the source control points into the trial's city-local frame. Renderer applies
 # only the explicit rotation/translation, so there is no hidden reflection or double fit.
 s['planFit']['target']=[[(x-px)*co-(z-pz)*si,(x-px)*si+(z-pz)*co] for x,z in ring];s['trialOnly']=True
 placement=dict(sampleId=sid,sourceId='osm:'+oid,replaceIds=replace,position=[px,0,pz],rotationY=theta,scale=[1,1,1],footprint=ring,precision='estimated',headingBasis='source south edge; photo orientation remains provisional')
 name='trial-'+sid.lower();payload=dict(version=1,trialOnly=True,samples={'buildings':{sid:s}});bytes=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode();(OUT/(name+'.json')).write_bytes(bytes)
 tile=dict(id=name,kind='buildings',trialOnly=True,url=f'./data/detail/{name}.json',bytes=len(bytes),sha256=hashlib.sha256(bytes).hexdigest(),bounds=list(Polygon(ring).bounds),buildings=[placement]);manifest['tiles'].append(tile)
 report.append(dict(id=sid,sourceId='osm:'+oid,replaceIds=replace,position=placement['position'],rotationY=theta))
(OUT/'trial-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
