"""Read-only source screening; emits research artifacts, never production geometry."""
from pathlib import Path
import csv,json,hashlib
from collections import Counter
from shapely.geometry import shape,mapping,box
from shapely.ops import transform,unary_union
from pyproj import CRS,Transformer
ROOT=Path(__file__).resolve().parents[1];P0=ROOT/'docs/research/p0-2026-09-25';OUT=ROOT/'docs/research/p3-building-screening';OUT.mkdir(exist_ok=True)
load=lambda p:json.loads(p.read_text())
summary=load(P0/'summary.json');sources={};outlines=[];osm={};maps={}
for area in ['shamian','huacheng']:
 paths=[P0/f'{area}-{provider}-buildings.geojson' for provider in ['osm','overture']]
 for p in paths:sources[str(p.relative_to(ROOT))]=hashlib.sha256(p.read_bytes()).hexdigest()
 fs,ovs=[load(p)['features'] for p in paths]; osm[area]={f['properties']['id']:f for f in fs}
 bbox=summary['areas'][area]['bbox'];lon=(bbox[0]+bbox[2])/2;lat=(bbox[1]+bbox[3])/2
 t=Transformer.from_crs('EPSG:4326',CRS.from_proj4(f'+proj=aeqd +lat_0={lat} +lon_0={lon} +datum=WGS84 +units=m'),always_xy=True)
 projected=[(f['properties']['id'],transform(t.transform,shape(f['geometry']))) for f in fs if f['properties'].get('building')]
 union=unary_union([g for _,g in projected]);maps[area]=(t,projected)
 for f in ovs:
  p=f['properties']
  if p.get('_comparison')!='new_candidate':continue
  g=transform(t.transform,shape(f['geometry']));nearest=min(projected,key=lambda item:g.distance(item[1]))
  flags=['identity-unverified','photo-unmatched','height-unverified']
  if g.area<100:flags.append('small-footprint-needs-review')
  if not g.is_valid:flags.append('invalid-geometry')
  if not box(*bbox).covers(shape(f['geometry'])):flags.append('crosses-study-boundary')
  overlap=g.intersection(union).area/g.area if g.is_valid and g.area else None
  rec=dict(area=area,id=p['id'],areaM2=round(g.area,2),sourceDatasets=sorted({s['dataset'] for s in p['sources']}),name=p.get('names'),height=p.get('height'),numFloors=p.get('num_floors'),nearestOsmId='osm:'+nearest[0],nearestDistanceM=round(g.distance(nearest[1]),2),overlapRatio=overlap,flags=flags,decision='hold-for-identity-and-image-review',productionEligible=False)
  outlines.append(dict(type='Feature',geometry=f['geometry'],properties=rec))
assert len(outlines)==63
selection=[
 ('C01','w509641361','基督教沙面会堂','地址与Commons类别对应；原照片为北端墙，南侧见C01专项样件'),
 ('C02','w352610288','沙面大街56号（旧正金银行候选）','地址可对照；OSM旧用途描述与照片命名有分歧，须核铭牌'),
 ('C03','w1191446839','沙面大街69号（牧师住宅候选）','源地址与照片题名初配，需核门牌和轮廓'),
 ('C04','w352610325','广东外事博物馆','OSM名称明确，待补对应年代自由许可照片'),
 ('C05','w352610283','海关宿舍（沙面大街6号）','需先拆清红楼主副楼及2/4/6号的身份范围'),
 ('C06','w352610265','渣打银行旧址（沙面大街49号）','源地址明确；不得与北街61号同名旧址混配'),
 ('C07','w352610312','万宝楼（旧万国宝通银行）','名称与旧名仅来自OSM，需核照片'),
 ('C08','w352610315','沙面大街50/52号（现星巴克标签）','经营标签不代表历史建筑身份或当前营业状态'),
 ('C09','w352610278','洛士利洋行旧址','OSM名称地址明确，待补照片和尺寸'),
 ('C10','w352610320','英国医院/招商局候选','OSM复合名称，需拆清时代与使用范围'),
 ('C11','w352610272','旧摩罗叉公寓','OSM名称明确，待补门牌和照片'),
 ('C12','w352610308','旧泰国人俱乐部','OSM名称明确，待补门牌和照片')]
photos=load(OUT/'photos.json') if (OUT/'photos.json').exists() else [];candidates=[]
for cid,oid,name,note in selection:
 f=osm['shamian'][oid];p=f['properties'];g=shape(f['geometry']);gm=transform(maps['shamian'][0].transform,g);photo=next((r for r in photos if r['candidateId']==cid),None)
 candidates.append(dict(id=cid,sourceId='osm:'+oid,name=name,osmName=p.get('name'),address=' '.join(filter(None,[p.get('addr:street'),p.get('addr:housenumber')])),centroid=[g.centroid.x,g.centroid.y],areaM2=round(gm.area,2),sourceLevels=p.get('building:levels'),measuredHeightM=None,identityStatus='osm-labelled-or-addressed-pending-independent-review',photo=photo,priority=1 if cid=='C01' else 2 if photo else 3,notes=note,productionEligible=False,geometry=f['geometry']))
# Curated identity annotations never overwrite the raw OSM snapshot or grant render approval.
review_path=ROOT/'data/evidence/building-identity-reviews.json'
if review_path.exists():
 review=load(review_path);sources[str(review_path.relative_to(ROOT))]=hashlib.sha256(review_path.read_bytes()).hexdigest()
 for c in candidates:
  identity=review['entities'].get(c['sourceId'])
  if identity:
   assert hashlib.sha256((ROOT/identity['sourcePath']).read_bytes()).hexdigest()==identity['sourceSha256']
   c.update(name=identity['canonicalName'],identityStatus=identity['identityStatus'],historicalAliases=identity['historicalAliases'],identityEvidenceIds=identity['evidenceIds'],notes=identity['notes'],prototypeEligibility=identity['prototypeEligibility'])
assert len({c['sourceId'] for c in candidates})==12
report=dict(version=1,date='2026-09-26',sourceHashes=sources,existingModelsExcluded=['osm:w352610322','osm:w352610258','osm:w392765468'],outlineScreening=dict(total=63,byArea=dict(Counter(f['properties']['area'] for f in outlines)),smallUnder100m2=sum(f['properties']['areaM2']<100 for f in outlines),readyForProduction=0,method='source geometry and metadata screening only; nearest object is context, never identity'),buildingCandidates=candidates)
(OUT/'candidates.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');(OUT/'outline-screening.geojson').write_text(json.dumps(dict(type='FeatureCollection',features=outlines),ensure_ascii=False,indent=2)+'\n')
with (OUT/'candidates.csv').open('w',encoding='utf-8-sig',newline='') as f:
 writer=csv.writer(f);writer.writerow(['id','sourceId','name','address','areaM2','sourceLevels','photoStatus','priority','productionEligible','notes'])
 for c in candidates:writer.writerow([c['id'],c['sourceId'],c['name'],c['address'],c['areaM2'],c['sourceLevels'],c['photo']['reviewStatus'] if c['photo'] else 'missing',c['priority'],False,c['notes']])
print(json.dumps(report['outlineScreening'],ensure_ascii=False));print('12 source-bound candidates; no production replacement')
