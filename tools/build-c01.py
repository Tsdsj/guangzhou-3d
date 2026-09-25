"""Bake an isolated C01 study; north end and south tower are distinct photo faces."""
from pathlib import Path
import json,math,hashlib
from pyproj import CRS,Transformer
ROOT=Path(__file__).resolve().parents[1];P=ROOT/'docs/research/p0-2026-09-25/shamian-osm-buildings.geojson';R=ROOT/'docs/research/p3-c01'
f=next(f for f in json.loads(P.read_text())['features'] if f['properties']['id']=='w509641361');ring=f['geometry']['coordinates'][0][:-1]
origin=[sum(ring[i][k] for i in [0,1,6,7])/4 for k in range(2)]
t=Transformer.from_crs('EPSG:4326',CRS.from_proj4(f'+proj=aeqd +lat_0={origin[1]} +lon_0={origin[0]} +datum=WGS84 +units=m'),always_xy=True)
ps=[t.transform(*p) for p in ring];dx,dn=ps[7][0]-ps[0][0],ps[7][1]-ps[0][1];w=math.hypot(dx,dn);ux,un=dx/w,dn/w
xy=[[e*ux+n*un,e*un-n*ux] for e,n in ps];d=(xy[1][1]+xy[6][1]-xy[0][1]-xy[7][1])/2
left=(xy[2][0]+xy[3][0])/2;right=(xy[4][0]+xy[5][0])/2;tw=right-left;tx=(left+right)/2;pd=(xy[3][1]+xy[4][1]-xy[2][1]-xy[5][1])/2
nominal=[[-w/2,-d/2],[-w/2,d/2],[left,d/2],[left,d/2+pd],[right,d/2+pd],[right,d/2],[w/2,d/2],[w/2,-d/2]]
photos={}
a=json.loads((ROOT/'docs/research/p3-building-screening/photos.json').read_text())[0]
refs=[dict(a,id='C01-a'),*json.loads((R/'photos.json').read_text()),*json.loads((ROOT/'docs/research/p3-c01-side/photos.json').read_text())]
for p in refs:
 if not p.get('path'):continue
 photos[p['id']]=dict(path='../../'+p['path'],url=p['page_url'],artist=p['artist'],date=p['date'],license=p['license'],licenseUrl=p['license_url'],sha256=p['sha256'],face='north-end' if p['id']=='C01-a' else p.get('face','south-tower'),epochStatus='separate-photo-epoch')
s=dict(version=1,id='C01',sourceId='osm:w509641361',name='基督教沙面会堂',width=w,depth=d+pd,naveDepth=d,porchWidth=tw,porchDepth=pd,porchCenterX=tx,origin=origin,axisEastNorth=[ux,un],coordinateSystem='WGS84 -> AEQD -> local x east along nave edge, y up, z south; right-handed',planFit=dict(source=nominal,target=xy),sourceGeoJSON=str(P.relative_to(ROOT)),sourceSha256=hashlib.sha256(P.read_bytes()).hexdigest(),heightStatus='estimated',measuredHeightM=None,baselineHeight=None,productionEligible=True,productionGate=dict(status='integrated-default-estimated',date='2026-09-26',acceptanceRecord='docs/research/p3-acceptance/trial-validation.json',basis=['source identity and outline review','source control points mapped with residual < 1e-6 m (internal consistency only)','isolated trial: day/night/rain, fast switching, 404 fallback and release checks in a real browser'],dimensions='estimated',metricAccuracy='unverified',doesNotMean='measured dimensions, 1:1 reconstruction or verified uncovered faces'),parameters=dict(naveEaveM=8.4,naveRidgeM=10.7,towerTopM=19.4),parameterStatus='proportional-estimates-no-metric-photo-registration',faces=dict(north=dict(photoId='C01-a',status='inferred-from-camera-position-and-source-plan'),south=dict(photoId='C01-c',status='inferred-from-porch-outline-and-tower-photos'),longSides=dict(status='uncovered-simplified')),photos=photos,sourceReferences=[dict(url='https://www.ccctspm.org/churchinfo/166',publisher='中国基督教网',published='2017-12-07',use='identity and domed tower form; not metric height'),dict(url='https://wglj.gz.gov.cn/xxgk/bmwj/ywxx/wwl/content/post_10581109.html',published='2025-12-05',use='60 Shamian Nanjie identity, distinct from 69 Shamian Dajie pastor residence')])
s['sideWindowReview']=dict(photoId='C01-d',epoch='2009-04-17',visiblePerSide=2,stationsFromNorthM=[2.6,6.6],segmentLengthM=9.6,windowWidthM=1.55,windowHeightM=4.4,sillM=1.2,dimensionStatus='estimated',exteriorTrimVerified=False,totalWindowsPerSide=None,currentAppearanceVerified=False)
s['faces']['longSides']={'status':'north-segment-partial-interior-reference-south-uncovered','photoId':'C01-d'}
(ROOT/'prototypes/p2/c01.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n');print(f'C01 nave {w:.3f} x {d:.3f}m; porch {tw:.3f} x {pd:.3f}m; height estimated')
