"""Reproducible P0 comparisons. Results describe source agreement, not survey accuracy."""
from pathlib import Path
from collections import Counter, defaultdict
import csv,json,math,hashlib
import numpy as np
from pyproj import CRS,Transformer,Geod
from shapely.geometry import Polygon,LineString,box,shape,mapping
from shapely.ops import unary_union,polygonize,transform
from shapely import make_valid
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as Patch
from matplotlib.patches import Patch as LegendPatch

ROOT=Path(__file__).resolve().parents[3];OUT=Path(__file__).resolve().parent
RAW=ROOT/'.research/p0-2026-09-25/raw'
SNAP=OUT/'source-samples'
AREAS={'shamian':[113.234,23.1065,113.2455,23.1112],
       'huacheng':[113.311,23.1205,113.3195,23.124]}
PROJECT=Transformer.from_crs('EPSG:4326',CRS.from_proj4('+proj=aeqd +lat_0=23.1185 +lon_0=113.296 +datum=WGS84 +units=m'),always_xy=True)
metric=lambda g:transform(PROJECT.transform,g)
load=lambda p:json.loads(Path(p).read_text())
def write(name,data): (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2))
def csvout(name,rows):
    if not rows:return
    with (OUT/name).open('w',encoding='utf-8-sig',newline='')as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
def geojson(name,rows):write(name,{'type':'FeatureCollection','features':rows})
def feature(g,p):return {'type':'Feature','geometry':mapping(g),'properties':p}

def geometry(e):
    if e.get('g'):
        return make_valid(Polygon(e['g'])) if len(e['g'])>=4 else None
    if e.get('m'):
        outer=[];inner=[]
        for m in e['m']:
            if len(m.get('g',[]))>=2:
                (inner if m.get('r')=='inner' else outer).append(LineString(m['g']))
        p=unary_union(list(polygonize(unary_union(outer))))
        h=unary_union(list(polygonize(unary_union(inner)))) if inner else None
        return make_valid(p.difference(h) if h is not None else p)

raw={}
input_buildings=[SNAP/'osm-buildings.json'] if (SNAP/'osm-buildings.json').exists() else [ROOT/'data/raw'/fn for fn in ['bld-1.json','bld-2.json','bld-3.json','bld-4.json','relations.json']]
for fn in input_buildings:
    for e in load(fn)['els']:
        if e['t'].get('building')or e['t'].get('building:part'):raw[e['k']+str(e['id'])]=e
buildings=[]
for id,e in raw.items():
    g=geometry(e)
    if g is not None and not g.is_empty:buildings.append((id,e,g))

report={'scope':'bbox-intersecting original features, not clipped feature counts; area unions clipped to bbox',
        'metric_crs_wkt':PROJECT.target_crs.to_wkt(),'areas':{}}
mapdata={}
for name,b in AREAS.items():
    roi=box(*b);roi_m=metric(roi)
    outlines=[(i,e,g)for i,e,g in buildings if g.intersects(roi) and e['t'].get('building') and not e['t'].get('building:part')]
    parts=[(i,e,g)for i,e,g in buildings if g.intersects(roi) and e['t'].get('building:part')]
    metrics=[metric(g)for _,_,g in outlines]
    u=unary_union(metrics) if metrics else Polygon()
    ov=load((SNAP if (SNAP/f'overture-{name}.geojson').exists() else RAW)/f'overture-{name}.geojson')['features']
    rows=[];matched=0;candidates=0;ambiguous=0
    for f in ov:
        g=shape(f['geometry']);gm=metric(g);best_iou=0;best_id='';best_inter=0
        for (id,e,og),om in zip(outlines,metrics):
            if not gm.intersects(om):continue
            inter=gm.intersection(om).area;union=gm.union(om).area
            iou=inter/union if union else 0
            if iou>best_iou:best_iou=iou;best_id=id;best_inter=inter
        overlap=gm.intersection(u).area/gm.area if gm.area else 0
        status='matched'if best_iou>=0.5 else ('new_candidate' if overlap<0.1 else 'ambiguous')
        matched+=status=='matched';candidates+=status=='new_candidate';ambiguous+=status=='ambiguous'
        p=f['properties'];p['_comparison']=status
        rows.append(dict(id=p['id'],status=status,best_osm_id=best_id,best_iou=round(best_iou,4),
            overlap_with_osm_union=round(overlap,4),area_m2=round(gm.area,2),
            area_inside_roi_m2=round(gm.intersection(roi_m).area,2),
            sources=' | '.join(s['dataset'] for s in p.get('sources',[])),
            height=p.get('height'),num_floors=p.get('num_floors')))
    ovu=unary_union([metric(shape(f['geometry']))for f in ov]).intersection(roi_m)
    osmu=u.intersection(roi_m)
    a={'bbox':b,'area_km2':round(roi_m.area/1e6,4),'osm_outline_records':len(outlines),'osm_part_records':len(parts),
       'overture_records':len(ov),'matched_iou_ge_0_5':matched,'additional_candidates_overlap_lt_0_1':candidates,
       'ambiguous_records':ambiguous,'osm_union_area_m2':round(osmu.area,2),'overture_union_area_m2':round(ovu.area,2),
       'overture_outside_osm_area_m2':round(ovu.difference(osmu).area,2),
       'osm_outside_overture_area_m2':round(osmu.difference(ovu).area,2),
       'overture_source_counts':dict(Counter(s['dataset']for f in ov for s in f['properties'].get('sources',[]))),
       'osm_height':sum(bool(e['t'].get('height')) for _,e,_ in outlines),
       'osm_levels':sum(bool(e['t'].get('building:levels'))for _,e,_ in outlines),
       'overture_height':sum(f['properties'].get('height')is not None for f in ov),
       'overture_floors':sum(f['properties'].get('num_floors')is not None for f in ov),
       'new_candidates_height':sum(r['status']=='new_candidate' and r['height']is not None for r in rows),
       'candidate_area_median_m2':round(float(np.median([r['area_m2'] for r in rows if r['status']=='new_candidate'])),2),
       'candidate_under_100m2':sum(r['status']=='new_candidate' and r['area_m2']<100 for r in rows)}
    report['areas'][name]=a
    csvout(f'{name}-building-comparison.csv',rows)
    geojson(f'{name}-osm-buildings.geojson',[feature(g,{'id':id,**e['t']})for id,e,g in outlines+parts])
    geojson(f'{name}-overture-buildings.geojson',ov)
    mapdata[name]=(roi_m,outlines,ov)

roads=load(SNAP/'osm-roads.json' if (SNAP/'osm-roads.json').exists() else ROOT/'data/raw/roads.json')
roi=box(*AREAS['huacheng']);roadrows=[];rf=[];selected=[]
for e in roads['els']:
    if len(e.get('g',[]))<2:continue
    g=LineString(e['g'])
    if not g.intersects(roi):continue
    t=e['t'];p={'id':'w'+str(e['id']),**t};rf.append(feature(g,p));selected.append(e)
    roadrows.append(dict(id=p['id'],name=t.get('name',''),highway=t.get('highway',''),
        length_in_roi_m=round(metric(g.intersection(roi)).length,2),
        **{k:t.get(k,'')for k in ['lanes','width','lanes:forward','lanes:backward','turn:lanes','oneway','bridge','tunnel','layer','sidewalk','cycleway','surface']},
        current_build_filter='tunnel_excluded' if t.get('tunnel')not in [None,'no','building_passage'] else 'needs_full_build_rules'))
csvout('huacheng-road-inventory.csv',roadrows);geojson('huacheng-local-roads.geojson',rf)
report['roads']={'local_snapshot':roads['ts'],'local_way_count':len(selected),
    'tag_presence':{k:sum(k in e['t']for e in selected)for k in ['lanes','width','sidewalk','cycleway','turn:lanes','bridge','tunnel','layer']}}
fullpath=(SNAP if (SNAP/'osm-huacheng-map.json').exists() else RAW)/'osm-huacheng-map.json'
if fullpath.exists():
    full=load(fullpath);els=full['elements'];nodes={e['id']:e for e in els if e['type']=='node'}
    hw=[e for e in els if e['type']=='way' and 'highway'in e.get('tags',{})]
    complete=[e for e in hw if all(n in nodes for n in e['nodes'])]
    ft=[]
    for e in complete:
        g=LineString([(nodes[n]['lon'],nodes[n]['lat'])for n in e['nodes']])
        if not g.intersects(roi):continue
        ft.append(feature(g,{'id':'w'+str(e['id']),'nodes':e['nodes'],**e['tags']}))
    geojson('huacheng-full-highways.geojson',ft)
    inside_nodes=[e for e in nodes.values() if roi.covers(shape({'type':'Point','coordinates':[e['lon'],e['lat']]}))]
    element_keys={(e['type'],e['id'])for e in els}
    restrictions=[e for e in els if e['type']=='relation' and e.get('tags',{}).get('type') in ['restriction','connectivity']]
    write('huacheng-restrictions.json',restrictions)
    additional=[f for f in ft if f['properties']['id']not in {f['properties']['id']for f in rf}]
    report['roads']['live_map']={'elements':len(els),'nodes':len(nodes),'highway_ways_in_roi':len(ft),
        'additional_way_count':len(additional),'additional_types':dict(Counter(f['properties']['highway']for f in additional)),
        'full_way_tag_presence':{k:sum(k in f['properties']for f in ft)for k in ['lanes','width','sidewalk','cycleway','turn:lanes','incline','ele']},
        'highway_types':dict(Counter(f['properties']['highway']for f in ft)),
        'restrictions':[{'id':e['id'],'tags':e.get('tags',{}),'members_complete':all((m['type'],m['ref'])in element_keys for m in e['members'])} for e in restrictions],
        'tagged_highway_nodes_inside_roi':dict(Counter(e.get('tags',{}).get('highway')for e in inside_nodes if 'highway'in e.get('tags',{})))}
    junctions=defaultdict(set);waynames={e['id']:e['tags'].get('name','')for e in complete}
    for e in complete:
        for n in e['nodes']:junctions[n].add(e['id'])
    cross=[]
    for n,ids in junctions.items():
        names={waynames[i]for i in ids}
        if '花城大道'in names and names.intersection({'华夏路','华穗路','珠江西路'}):
            cross.append({'node_id':n,'lon':nodes[n]['lon'],'lat':nodes[n]['lat'],
                          'road_names':' | '.join(sorted(names)), 'way_ids':' | '.join(map(str,sorted(ids)))})
    csvout('huacheng-junction-nodes.csv',cross);report['roads']['junction_nodes']=cross

# Compare legacy projection against local AEQD; this is mathematical disagreement, not ground accuracy.
def old(lon,lat):return ((lon-113.296)*111320*math.cos(math.radians(23.1185)),(lat-23.1185)*110750)
pr=[]
for name,b in {**AREAS,'project':[113.212,23.085,113.38,23.152]}.items():
    delta=[]
    for lon in np.linspace(b[0],b[2],11):
        for lat in np.linspace(b[1],b[3],11):
            x,y=PROJECT.transform(lon,lat);a,c=old(lon,lat);delta.append(math.hypot(x-a,y-c))
    pr.append({'area':name,'sample_grid':'11x11','rms_difference_m':round(float(np.sqrt(np.mean(np.square(delta)))),3),'max_difference_m':round(max(delta),3)})
report['projection_comparison']=pr
write('summary.json',report)

fig,axes=plt.subplots(2,1,figsize=(13,11),layout='constrained')
def draw_poly(ax,g,**kw):
    for p in (list(g.geoms)if g.geom_type=='MultiPolygon'else[g]):
        if p.geom_type!='Polygon':continue
        ax.add_patch(Patch(np.asarray(p.exterior.coords),**kw))
for ax,(name,(roi_m,osms,ov))in zip(axes,mapdata.items()):
    for f in ov:
        g=metric(shape(f['geometry'])).intersection(roi_m)
        col={'matched':'#bed5df','new_candidate':'#f49b45','ambiguous':'#bf8ccf'}[f['properties']['_comparison']]
        draw_poly(ax,g,facecolor=col,edgecolor='none',alpha=.8)
    for id,e,g in osms:draw_poly(ax,metric(g).intersection(roi_m),facecolor='none',edgecolor='#263f4e',linewidth=.8)
    for e in roads['els']:
        if len(e.get('g',[]))<2:continue
        g=metric(LineString(e['g']))
        if not g.intersects(roi_m):continue
        x,y=g.xy;ax.plot(x,y,color='#8a949b',linewidth=.6,alpha=.5)
    b=roi_m.bounds;ax.set_xlim(b[0],b[2]);ax.set_ylim(b[1],b[3]);ax.set_aspect('equal')
    a=report['areas'][name]
    ax.set_title(f"{name.title()}: OSM {a['osm_outline_records']} outlines / Overture {a['overture_records']} records / {a['additional_candidates_overlap_lt_0_1']} added candidates")
    ax.set_xlabel('Local east (m)');ax.set_ylabel('Local north (m)')
    ax.grid(alpha=.13)
    if name=='shamian':
        for label,id in [('B1','w352610322'),('B2','w352610258'),('B3','w392765468')]:
            item=next((r for r in osms if r[0]==id),None)
            if item:
                p=metric(item[2]).centroid;ax.plot(p.x,p.y,'o',color='#b72131',markersize=5);ax.annotate(label,(p.x,p.y),xytext=(5,7),textcoords='offset points',color='#8c1220',weight='bold')
fig.legend(handles=[LegendPatch(facecolor='#bed5df',label='IoU >= 0.5'),LegendPatch(facecolor='#f49b45',label='New candidates (unverified)'),LegendPatch(facecolor='#bf8ccf',label='Ambiguous overlap'),LegendPatch(facecolor='none',edgecolor='#263f4e',label='Local OSM outlines')],loc='outside lower center',ncol=4)
fig.suptitle('P0 building-source comparison | 2026-09-25\nSource agreement only; no survey ground truth\n© OpenStreetMap contributors, Overture Maps Foundation (ODbL)',fontsize=12)
fig.savefig(OUT/'building-coverage.png',dpi=160)

if fullpath.exists():
    fig,ax=plt.subplots(figsize=(13,7),layout='constrained')
    roi_m=metric(roi)
    for f in load(OUT/'huacheng-osm-buildings.geojson')['features']:
        draw_poly(ax,metric(shape(f['geometry'])).intersection(roi_m),facecolor='#eceeef',edgecolor='#b5babe',linewidth=.5)
    for f in ft:
        p=f['properties'];g=metric(shape(f['geometry']));ped=p['highway']in ['footway','steps'];tunnel=p.get('tunnel')not in [None,'no']
        col='#168476' if ped else '#8754a1'if tunnel else '#445c74'
        ax.plot(*g.xy,color=col,linewidth=1 if ped else 1.8,linestyle='--'if tunnel else '-',alpha=.85)
    for e in inside_nodes:
        k=e.get('tags',{}).get('highway')
        if k in ['crossing','traffic_signals']:
            x,y=PROJECT.transform(e['lon'],e['lat']);ax.plot(x,y,'o'if k=='crossing'else 's',color='#e0932e'if k=='crossing'else '#c63c48',markersize=3)
    for label,lon,lat in [('J1 Huasui Rd',113.31303,23.12222),('J2 Huaxia Rd',113.31581,23.12202)]:
        x,y=PROJECT.transform(lon,lat);ax.annotate(label,(x,y),xytext=(-40,50),textcoords='offset points',arrowprops={'arrowstyle':'->','color':'#1b2934'},fontsize=11,weight='bold',bbox={'facecolor':'white','alpha':.9,'edgecolor':'none'})
    b=roi_m.bounds;ax.set_xlim(b[0],b[2]);ax.set_ylim(b[1],b[3]);ax.set_aspect('equal');ax.set_xlabel('Local east (m)');ax.set_ylabel('Local north (m)')
    ax.set_title('Huacheng P0: 247 highway ways vs 104 in current input\n131 footways + 12 steps; 53 crossings + 9 signal nodes inside ROI\n© OpenStreetMap contributors (ODbL); topology source, not surveyed road boundaries',fontsize=12)
    fig.legend(handles=[LegendPatch(facecolor='#445c74',label='Other highways'),LegendPatch(facecolor='#168476',label='Footways / steps'),LegendPatch(facecolor='#8754a1',label='Tunnels (dashed)'),LegendPatch(facecolor='#e0932e',label='Crossing nodes'),LegendPatch(facecolor='#c63c48',label='Signal nodes')],loc='outside lower center',ncol=5)
    fig.savefig(OUT/'road-evidence.png',dpi=160)
print(json.dumps(report,ensure_ascii=False,indent=2))
