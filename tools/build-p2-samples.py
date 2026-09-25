"""Bake bounded P2 prototype inputs; never changes production city data."""
from pathlib import Path
import json, math, gzip, struct
from pyproj import CRS, Transformer
from shapely.geometry import shape, LineString, Point, box
from shapely.ops import transform, unary_union
from road_markings import package_markings
from road_layers import classify_way

ROOT=Path(__file__).resolve().parents[1]
P0=ROOT/'docs/research/p0-2026-09-25'
OUT=ROOT/'prototypes/p2/samples.json'
load=lambda p:json.loads(p.read_text())
buildings=load(P0/'shamian-osm-buildings.geojson')['features']
facades=load(ROOT/'data/evidence/facades.json')
selected=load(P0/'selected-photos.json')
controls=load(ROOT/'data/evidence/building-controls.json')
ids={'B1':'w352610322','B2':'w352610258','B3':'w392765468'}
result={'version':1,'buildings':{},'photos':{},'coordinateSystem':'WGS84 -> local AEQD; each building is in an unplaced presentation frame'}
city=load(ROOT/'data/guangzhou.json');binary=gzip.decompress((ROOT/'data'/city['files'][0]['name']).read_bytes())
identity=city['sections']['renderIdentity'];render_ids=json.loads(binary[identity['offset']:identity['offset']+identity['length']])['buildings']
meta=city['sections']['bldMeta'];metadata=struct.unpack_from('<'+'f'*meta['length'],binary,meta['offset'])
for sid,id in ids.items():
    f=next(f for f in buildings if f['properties']['id']==id);g=shape(f['geometry']);c=g.centroid
    t=Transformer.from_crs('EPSG:4326',CRS.from_proj4(f'+proj=aeqd +lat_0={c.y} +lon_0={c.x} +datum=WGS84 +units=m'),always_xy=True)
    gm=transform(t.transform,g);rect=list(gm.minimum_rotated_rectangle.exterior.coords)
    lengths=sorted({round(math.dist(rect[i],rect[i+1]),3) for i in range(4)})
    result['buildings'][sid]={'sourceId':'osm:'+id,'name':f['properties'].get('name'),
        'footprint':list(gm.exterior.coords),'width':min(lengths),'depth':max(lengths),'footprintAreaM2':round(gm.area,2),
        'levels':f['properties'].get('building:levels'),'heightStatus':'estimated','orientationStatus':'unverified',
        'baselineHeight':(metadata[render_ids.index('osm:'+id)*24+3]-metadata[render_ids.index('osm:'+id)*24+2]) if 'osm:'+id in render_ids else None,
        'faces':facades['entities']['osm:'+id]}
    extra=controls['entities'].get('osm:'+id,{})
    if extra:
        result['buildings'][sid].update(extra)
        result['buildings'][sid]['controlSources']={k:v for k,v in controls['sources'].items() if k in [extra['verticalControl']['sourceId'],extra.get('eastLoggia',{}).get('sourceId')]}
        for face in result['buildings'][sid]['faces']:
            if face['id'] in ['front','side-a']:
                face['priorLabel']=face['label']
                face['label']='照片面F0（北侧短边暂定，非已核实主入口）' if face['id']=='front' else '照片转角片段（朝向待核）'
                face['orientationStatus']='provisional'
            if face['id']=='side-b' and extra.get('eastLoggia'):
                face.update(priorCoverage=face['coverage'],label='东侧长边柱廊（位置推定，2012结构参考）',coverage='partial',evidenceIds=['photo:B2-c'],known='二三层开放柱廊、四层拱廊及转角相邻关系',unknown='现状改动、廊深、内墙与门窗布局',sourceId='B2CornerPhoto2012')
for p in selected:
    result['photos'][p['sample_id']]={'path':'../../docs/research/p0-2026-09-25/'+p['local_path'],
        'url':p['page_url'],'artist':p['artist'],'date':p['date'],'license':p['license'],'licenseUrl':p['license_url']}
for p in load(ROOT/'docs/research/p3-facade-review/photos.json'):
    result['photos'][p['sample_id']]={'path':'../../'+p['local_path'],'url':p['page_url'],'artist':p['artist'],'date':p['date'],'license':p['license'],'licenseUrl':p['license_url'],'locationStatus':p['locationStatus']}

# J1: preserve actual node geometry; buffers are explicitly estimated road widths.
center=[113.31303,23.12222]
t=Transformer.from_crs('EPSG:4326',CRS.from_proj4(f'+proj=aeqd +lat_0={center[1]} +lon_0={center[0]} +datum=WGS84 +units=m'),always_xy=True)
project=lambda x,y:(t.transform(x,y)[0],-t.transform(x,y)[1])
raw=load(ROOT/'data/evidence/huacheng-osm.json')['elements']
nodes={e['id']:e for e in raw if e['type']=='node'}
roi=box(-85,-72,85,72);road_lines=[];ped_lines=[];surfaces=[];crossings=[];lines=[];marking_sources=[]
def parts(g):
    if g.is_empty:return []
    return list(g.geoms) if hasattr(g,'geoms') else [g]
for e in raw:
    if e['type']!='way' or not e.get('tags',{}).get('highway'):continue
    if not all(n in nodes for n in e['nodes']):continue
    tag=e['tags'];full_line=LineString([project(nodes[n]['lon'],nodes[n]['lat'])for n in e['nodes']]);g=full_line.intersection(roi)
    if not classify_way(tag)['groundRenderable']:continue
    if tag.get('footway')=='crossing' and full_line.buffer(1.55).intersects(roi):marking_sources.append(('osm:w'+str(e['id']),full_line,tag))
    if g.is_empty:continue
    is_ped=tag['highway']in ['footway','pedestrian','steps','path']
    for line in parts(g):
        if line.geom_type!='LineString':continue
        rec={'sourceId':'osm:w'+str(e['id']),'points':list(line.coords),'tags':tag}
        if is_ped:
            ped_lines.append(line);rec['kind']='pedestrian'
            if tag.get('footway')=='crossing':crossings.append(rec)
        else:
            lanes=int(tag['lanes'])if tag.get('lanes','').isdigit()else (3 if tag['highway']=='primary'else 2)
            width=lanes*3.25+0.8
            rec.update(kind='road',width=width,widthStatus='estimated')
            road_lines.append(line);surfaces.append(line.buffer(width/2,cap_style='flat',join_style='round',quad_segs=8))
        lines.append(rec)
road=unary_union(surfaces).intersection(roi)
walk=road.buffer(2.5,join_style='round').difference(road).intersection(roi)
def polygons(g):return [{'outer':list(p.exterior.coords),'holes':[list(h.coords)for h in p.interiors]}for p in parts(g)if p.geom_type=='Polygon' and p.area>0.05]
relations=[e for e in raw if e['type']=='relation'and e['id']in [15655071,15655072,15655073,15655074]]
result['road']={'sourceId':'osmHuacheng','center':center,'bboxLocal':list(roi.bounds),'widthStatus':'estimated',
    'surfaces':polygons(road),'walkways':polygons(walk),'lines':lines,'crossings':crossings,
    'restrictions':relations,'notes':'OSM centerlines and references retained; width, curbs and paint dimensions are illustrative estimates.'}
result['road'].update(package_markings(marking_sources,road,roi))
OUT.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
print('P2 inputs:',len(result['buildings']),'buildings;',len(lines),'local ways;',len(crossings),'crossing ways;',len(relations),'restrictions')
