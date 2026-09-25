from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import CRS,Transformer
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'docs/research/p3-building-screening';P=ROOT/'docs/research/p0-2026-09-25'
r=json.loads((D/'candidates.json').read_text());extra=json.loads((D/'outline-screening.geojson').read_text())['features']
fig,axes=plt.subplots(2,1,figsize=(13,10),layout='constrained')
for ax,area in zip(axes,['shamian','huacheng']):
 bbox=json.loads((P/'summary.json').read_text())['areas'][area]['bbox'];t=Transformer.from_crs('EPSG:4326',CRS.from_proj4(f'+proj=aeqd +lat_0={(bbox[1]+bbox[3])/2} +lon_0={(bbox[0]+bbox[2])/2} +datum=WGS84 +units=m'),always_xy=True)
 def draw(geometry,color,alpha=1):
  g=transform(t.transform,shape(geometry));polys=list(g.geoms) if g.geom_type=='MultiPolygon' else [g]
  for p in polys:x,y=p.exterior.xy;ax.fill(x,y,color=color,alpha=alpha,linewidth=.35,edgecolor='#68716d')
 for f in json.loads((P/f'{area}-osm-buildings.geojson').read_text())['features']:
  if f['properties'].get('building'):draw(f['geometry'],'#d7ded9')
 for f in extra:
  if f['properties']['area']==area:draw(f['geometry'],'#d89247')
 if area=='shamian':
  for c in r['buildingCandidates']:
   draw(c['geometry'],'#4d907c');x,y=t.transform(*c['centroid']);ax.annotate(c['id'],(x,y),xytext=(0,5),textcoords='offset points',fontsize=8,ha='center',bbox=dict(facecolor='white',alpha=.8,pad=1,edgecolor='none'))
 ax.set_aspect('equal');ax.set_title(area.capitalize()+' | source outlines only; no orthophoto validation');ax.set_xlabel('Local east (m)');ax.set_ylabel('Local north (m)');ax.grid(alpha=.12)
fig.suptitle('Building review queue | green: 12 named/addressed candidates | orange: 63 unverified additions',fontsize=12)
fig.savefig(D/'screening-map.png',dpi=130);print(D/'screening-map.png')
