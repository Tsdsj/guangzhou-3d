"""Independent C02 facade input with source-bound plan and explicitly estimated sections."""
from pathlib import Path
import json,math,hashlib
from pyproj import CRS,Transformer
ROOT=Path(__file__).resolve().parents[1];P=ROOT/'docs/research/p0-2026-09-25/shamian-osm-buildings.geojson'
review=json.loads((ROOT/'data/evidence/building-identity-reviews.json').read_text());identity=review['entities']['osm:w352610288']
assert hashlib.sha256(P.read_bytes()).hexdigest()==identity['sourceSha256']
f=next(f for f in json.loads(P.read_text())['features'] if f['properties']['id']=='w352610288');ring=f['geometry']['coordinates'][0][:-1]
o=[sum(p[k] for p in ring)/4 for k in [0,1]];t=Transformer.from_crs('EPSG:4326',CRS.from_proj4(f'+proj=aeqd +lat_0={o[1]} +lon_0={o[0]} +datum=WGS84 +units=m'),always_xy=True);pts=[t.transform(*p) for p in ring]
dx,dn=pts[1][0]-pts[2][0],pts[1][1]-pts[2][1];w=math.hypot(dx,dn);ux,un=dx/w,dn/w;target=[[e*ux+n*un,e*un-n*ux] for e,n in pts];d=(target[1][1]+target[2][1]-target[0][1]-target[3][1])/2
photo=next(p for p in json.loads((ROOT/'docs/research/p3-building-screening/photos.json').read_text()) if p['candidateId']=='C02')
s=dict(version=1,id='C02',sourceId='osm:w352610288',name=identity['canonicalName'],identityStatus=identity['identityStatus'],historicalAliases=identity['historicalAliases'],identityReviewPath='data/evidence/building-identity-reviews.json',sourcePath=str(P.relative_to(ROOT)),sourceSha256=identity['sourceSha256'],origin=o,axisEastNorth=[ux,un],coordinateSystem='WGS84 -> AEQD -> local x east along south edge, y up, z south; right-handed',width=w,depth=d,planFit=dict(source=[[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]],target=target),baselineHeight=None,heightStatus='estimated',measuredHeightM=None,productionEligible=False,parameters=dict(totalHeightM=16.4,groundCorniceM=5.8,upperBaseM=6.0,archTopM=15.2,porchDepthM=2.2,entranceThresholdM=.45,centralWidthRatio=.66),parameterStatus='proportional-study-estimates',photo=dict(path='../../'+photo['path'],url=photo['page_url'],artist=photo['artist'],date=photo['date'],license=photo['license'],licenseUrl=photo['license_url'],sha256=photo['sha256'],pixelRegistrationVerified=False),faceReview=dict(south='provisional-photo-match',leftWing='occluded-unknown',rightWing='partial-photo-support',sidesAndRear='uncovered',roof='uncovered-except-front-eave'))
s['photos']={'C02-a':s['photo']}
for p in json.loads((ROOT/'docs/research/p3-c02-corner/photos.json').read_text()):
 if p['id'] not in ['C02-b','C02-plaque'] or p.get('status')!='visually-reviewed':continue
 assert hashlib.sha256((ROOT/p['path']).read_bytes()).hexdigest()==p['sha256']
 s['photos'][p['id']]=dict(path='../../'+p['path'],url=p['page_url'],artist=p['artist'],date=p['date'],license=p['license'],licenseUrl=p['license_url'],sha256=p['sha256'],pixelRegistrationVerified=False)
s['porticoReview']=dict(photoId='C02-b',epoch='2021-12-28',roundColumnCount=4,squareColumnCount=4,roundPairHalfSpacingM=.40,squarePairHalfSpacingM=.34,spacingStatus='estimated',depthStatus='estimated',currentAppearanceVerified=False)
s['faceReview']['leftWing']='photo-supported-2021'
(ROOT/'prototypes/p2/c02.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n');print(f'C02 source plan {w:.3f} x {d:.3f}m; height 16.4m estimated')
