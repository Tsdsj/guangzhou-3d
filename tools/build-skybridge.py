"""Independent S1 prototype only; preserve source nodes and separate dimensional hypotheses."""
from pathlib import Path
import json, math, hashlib
from pyproj import CRS, Transformer
from shapely.geometry import Polygon, box
ROOT=Path(__file__).resolve().parents[1]
path=ROOT/'data/evidence/huacheng-osm.json'
raw=json.loads(path.read_text())['elements']; entities={(e['type'],e['id']):e for e in raw}
way=entities['way',559470933]; ns=[entities['node',n] for n in way['nodes']]
assert len(ns)==2
origin=[sum(n['lon'] for n in ns)/2,sum(n['lat'] for n in ns)/2]
t=Transformer.from_crs('EPSG:4326',CRS.from_proj4(f'+proj=aeqd +lat_0={origin[1]} +lon_0={origin[0]} +datum=WGS84 +units=m'),always_xy=True)
a,b=[t.transform(n['lon'],n['lat']) for n in ns]; dx,dn=b[0]-a[0],b[1]-a[1]; length=math.hypot(dx,dn); ux,un=dx/length,dn/length
# Presentation x goes Spring -> Summer; positive z is the south-facing perpendicular (right-handed with y up).
def project(n):
 e,north=t.transform(n['lon'],n['lat']);return [e*ux+north*un,e*un-north*ux]
interfaces=[];contexts=[]
for n,bid,label in zip(ns,[299812757,299687659],['春广场','夏广场']):
 building=entities['way',bid]; assert n['id'] in building['nodes']
 interfaces.append(dict(nodeId=n['id'],buildingId=f'osm:w{bid}',label=label,lon=n['lon'],lat=n['lat'],point=project(n),doorVerified=False))
 poly=Polygon([project(entities['node',nid]) for nid in building['nodes']]).intersection(box(-length/2-10,-12,length/2+10,12))
 assert poly.geom_type=='Polygon'
 contexts.append(dict(sourceId=f'osm:w{bid}',label=label,outer=list(poly.exterior.coords),holes=[list(r.coords) for r in poly.interiors],status='source-footprint-clipped-for-study'))
photo=next(p for p in json.loads((ROOT/'docs/research/p3-source-review-2026-09-26/photos.json').read_text()) if p['reviewId']=='R6')
evidence=json.loads((ROOT/'docs/research/p3-skybridge-review/evidence.json').read_text())
params={k:dict(value=v,status='estimated',basis='可浏览比例假设；未经测量或像素配准') for k,v in dict(deckTopM=6.5,widthM=6,clearHeightM=3.2,slabThicknessM=.45,roofThicknessM=.2,framePitchM=1.5).items()}
result=dict(version=1,id='S1',sourceId='osm:w559470933',sourceVersion=way['version'],sourceTags=way['tags'],sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),sourcePath='data/evidence/huacheng-osm.json',license='ODbL-1.0',origin=origin,axisEastNorth=[ux,un],coordinateSystem='WGS84 -> midpoint AEQD -> x Spring to Summer, z south-facing perpendicular; y is hypothetical ground-relative height',lengthM=length,interfaces=interfaces,contextFootprints=contexts,measuredDeckElevationM=None,parameters=params,photoMatch='provisional',photo=dict(path='../../docs/research/p3-source-review-2026-09-26/R6.jpg',url=photo['page_url'],artist=photo['artist'],date=photo['date'],license=photo['license'],licenseUrl=photo['license_url'],sha256=photo['sha256']),productionEligible=False)
result['interfaceEvidence']=evidence['interfaceEvidence']
result['controlSources']=evidence['sources']
result['photoOrientation']={'status':'provisional-metadata-side','side':'north','cameraPoint':project({'lon':float(photo['camera_lon']),'lat':float(photo['camera_lat'])}),'pixelRegistrationVerified':False,'note':'相机元数据在北侧，仅为线索；GPS未独立校准，不作为测绘控制点'}
(ROOT/'prototypes/p2/skybridge.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(f'S1: source length {length:.3f}m; deck/width estimated; prototype only')
