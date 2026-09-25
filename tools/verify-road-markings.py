"""Verify published road paint against road polygons and report evidence coverage."""
from pathlib import Path
from collections import Counter
import json
from shapely.geometry import Polygon,LineString,box
from shapely.ops import unary_union
from road_markings import stripe_candidates
ROOT=Path(__file__).resolve().parents[1]
read=lambda p:json.loads(p.read_text())
m=read(ROOT/'data/detail/manifest.json');rows=[];sources={};paint_sources=[];before={}
for tile in m['tiles']:
 if tile['kind']!='roads':continue
 r=read(ROOT/tile['url'])['samples']['road'];surface=unary_union([Polygon(p['outer'],p['holes'])for p in r['surfaces']])
 old_count=old_leak=0;old_area=0
 for c in r['crossings']:
  for a,b in zip(c['points'],c['points'][1:]):
   for stripe in stripe_candidates(LineString([a,b])):
    g=stripe['geometry']
    if not surface.contains(g.centroid):continue
    old_count+=1;leak=g.difference(surface).area
    if leak>1e-7:old_leak+=1;old_area+=leak
 before[tile['id']]={'stripes':old_count,'leakingStripes':old_leak,'outsideAreaM2':old_area}
 paint_sources.append({p['sourceId']for p in r['markings']})
 cx,_,cz=tile['position'];x0,z0,x1,z1=tile['bounds'];area=box(x0-cx,z0-cz,x1-cx,z1-cz)
 outside=0;tile_leak=0;parts=0
 for mark in r['markings']:
  for p in mark['polygons']:
   g=Polygon(p['outer'],p['holes']);assert g.is_valid
   outside+=g.difference(surface).area;tile_leak+=g.difference(area).area;parts+=1
 assert outside<1e-7 and tile_leak<1e-7,(tile['id'],outside,tile_leak)
 for entry in r['markingAudit']:sources[entry['sourceId']]=entry
 rows.append({'tile':tile['id'],'markingRecords':len(r['markings']),'polygonParts':parts,'outsideRoadAreaM2':outside,'outsideTileAreaM2':tile_leak,'statusCounts':dict(Counter(a['status']for a in r['markingAudit']))})
report={'date':'2026-09-25','basis':'input road geometry and tag consistency, not measured street accuracy','tiles':rows,'uniqueCrossingWays':len(sources),'uniqueStatusCounts':dict(Counter(x['status']for x in sources.values())),'deferred':[x for x in sources.values()if not x['render']],'patternNote':'yes means markings present; zebra pattern and dimensions remain inferred','seamEvidence':'bent-way and island-hole regression fixture','paintedSourceIdsSharedAcrossTiles':sorted(set.intersection(*paint_sources))}
out=ROOT/'docs/research/p3-road-markings/after.json';out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='deferred'},ensure_ascii=False,indent=2))
(out.parent/'before.json').write_text(json.dumps({'basis':'reproduced previous per-segment phase and center-only acceptance on unchanged crossing paths and road surfaces','tiles':before},ensure_ascii=False,indent=2)+'\n')
