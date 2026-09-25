from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
from matplotlib.lines import Line2D
ROOT=Path(__file__).resolve().parents[1];read=lambda p:json.loads(p.read_text())
r=read(ROOT/'docs/research/p3-road-layers/audit.json');es=read(ROOT/r['sourceFile'])['elements'];nodes={e['id']:e for e in es if e['type']=='node'}
project=lambda p:((p[0]-113.315)*102380.4217,-(p[1]-23.122)*110750)
colors={'tunnel':'#277aa6','bridge':'#7b56ac','vertical-transition':'#d48b2f','building-passage':'#7d6750'}
fig,ax=plt.subplots(figsize=(11,7),layout='constrained');ax.set_facecolor('#f4f5f2')
for w in es:
 if w['type']!='way' or not w.get('tags',{}).get('highway') or not all(n in nodes for n in w.get('nodes',[])):continue
 p=[project([nodes[n]['lon'],nodes[n]['lat']])for n in w['nodes']];ax.plot([q[0]for q in p],[q[1]for q in p],color='#d4d9d5',lw=.7,zorder=1)
missing={};all_points=[]
for w in r['specialWays']:
 p=[project(q)for q in w['points']];all_points+=p;ax.plot([q[0]for q in p],[q[1]for q in p],color=colors[w['kind']],lw=2,zorder=3)
 for end in w['endpoints']:
  if not end['attachedWays']:missing[end['nodeId']]=end
for p in missing.values():
 x,z=project(p['position']);ax.scatter(x,z,s=48,marker='o'if p['insideSourceBbox']else's',facecolors='none',edgecolors='#c84945'if p['insideSourceBbox']else'#d48b2f',linewidths=1.5,zorder=5)
for key,color,style in [('scopeBbox','#435851','-'),('sourceBbox','#879b8e','--')]:
 x0,y0,x1,y1=r[key];a=project([x0,y0]);b=project([x1,y1]);ax.add_patch(Rectangle((a[0],b[1]),b[0]-a[0],a[1]-b[1],fill=False,ec=color,ls=style,lw=1.4));all_points += [a,b]
ax.set_xlim(min(p[0]for p in all_points)-25,max(p[0]for p in all_points)+25);ax.set_ylim(max(p[1]for p in all_points)+25,min(p[1]for p in all_points)-25);ax.set_aspect('equal');ax.set_xlabel('Local east (m)');ax.set_ylabel('Local south (m)')
ax.set_title('Bridge / tunnel / stair audit | plan projection only, heights unknown',fontsize=14)
legend=[Line2D([0],[0],color=v,lw=2,label=k.replace('-',' ').title())for k,v in colors.items()]
legend += [Line2D([0],[0],marker='o',color='#c84945',mfc='none',ls='',label='Unattached source endpoint inside query'),Line2D([0],[0],marker='s',color='#d48b2f',mfc='none',ls='',label='Unattached endpoint outside query')]
ax.legend(handles=legend,loc='lower left',ncol=1,fontsize=8,frameon=True,facecolor='white',framealpha=.95)
fig.supxlabel('OSM contributors | solid box: stage area; dashed box: source query | endpoints need review, not confirmed broken routes',fontsize=9)
fig.savefig(ROOT/'docs/research/p3-road-layers/overview.png',dpi=170)
