"""Prepare source geometry for a later isolated facade study; no runtime registration."""
from pathlib import Path
import json,math,hashlib
from pyproj import CRS,Transformer
from shapely.geometry import shape
from shapely.ops import transform
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/research/p3-c02-identity'
path=ROOT/'docs/research/p0-2026-09-25/shamian-osm-buildings.geojson';features=json.loads(path.read_text())['features'];f=next(f for f in features if f['properties']['id']=='w352610288');g=shape(f['geometry']);o=g.centroid
tr=Transformer.from_crs('EPSG:4326',CRS.from_proj4(f'+proj=aeqd +lat_0={o.y} +lon_0={o.x} +datum=WGS84 +units=m'),always_xy=True);gm=transform(tr.transform,g);pts=list(gm.exterior.coords)[:-1]
front=min(range(len(pts)),key=lambda i:(pts[i][1]+pts[(i+1)%len(pts)][1])/2);a,b=pts[front],pts[(front+1)%len(pts)];width=math.dist(a,b);edgeLengths=[math.dist(pts[i],pts[(i+1)%4]) for i in range(4)]
mid=[(a[k]+b[k])/2 for k in [0,1]];bearing=math.degrees(math.atan2(mid[0],mid[1]))%360
r=dict(sourceId='osm:w352610288',sourcePath=str(path.relative_to(ROOT)),sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),origin=[o.x,o.y],localEastNorth=pts,southEdgeIndex=front,frontageM=width,depthM=max(edgeLengths),areaM2=gm.area,frontDirectionBearingDeg=bearing,frontDirectionStatus='inferred-south-edge-not-photo-calibrated',heightM=None,photoMatchStatus='provisional',productionEligible=False,scope={'supported':'2023可见南侧三大拱、通柱与入口的独立立面研究','estimated':'所有高度、窗格、柱距、廊深、檐口尺寸','deferred':'侧后面、屋顶全貌、门牌辨读、像素配准、主城接入'})
(OUT/'plan.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
fig,ax=plt.subplots(figsize=(8,7),layout='constrained')
for other in features:
 gg=transform(tr.transform,shape(other['geometry']))
 if gg.distance(gm)>70 or gg.geom_type!='Polygon':continue
 x,y=gg.exterior.xy;ax.fill(x,y,color='#dee4df',edgecolor='#9aa59e',linewidth=.6)
x,y=gm.exterior.xy;ax.fill(x,y,color='#62a18a',edgecolor='#285843',linewidth=1.5)
ax.plot([a[0],b[0]],[a[1],b[1]],color='#c17b36',linewidth=3,label='Provisional south facade')
for i,(x,y) in enumerate(pts):ax.annotate(f'P{i}',(x,y),xytext=(4,4),textcoords='offset points',fontsize=9)
ax.text(0,0,'C02 / No. 56\nosm:w352610288',ha='center',va='center',fontsize=10)
ax.set(xlim=(-42,42),ylim=(-52,52),xlabel='Local east (m)',ylabel='Local north (m)',title=f'C02 source plan | {width:.2f} x {max(edgeLengths):.2f} m\nSource dimensions only; height unknown; no image registration')
ax.set_aspect('equal');ax.grid(alpha=.15);ax.legend(loc='lower left');fig.savefig(OUT/'plan.png',dpi=140)
print(f'C02 source frontage {width:.3f}m depth {max(edgeLengths):.3f}m area {gm.area:.2f}m2; provisional south face')
