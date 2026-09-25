from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon
from matplotlib.lines import Line2D
ROOT=Path(__file__).resolve().parents[1];read=lambda p:json.loads(p.read_text());m=read(ROOT/'data/detail/manifest.json')
fig,axes=plt.subplots(1,2,figsize=(12,6),layout='constrained');colors={'reported':'#4cab8b','unknown':'#dd9d31','conflict':'#d45a55'}
for ax,t in zip(axes,[t for t in m['tiles']if t['kind']=='roads']):
 r=read(ROOT/t['url'])['samples']['road'];ax.set_facecolor('#edf0ed')
 for key,color in [('surfaces','#47545d'),('walkways','#c8cdcb')]:
  for p in r[key]:
   ax.add_patch(Polygon(p['outer'],facecolor=color,edgecolor='none'))
   for h in p['holes']:ax.add_patch(Polygon(h,facecolor='#edf0ed',edgecolor='none'))
 for mark in r['markings']:
  for p in mark['polygons']:ax.add_patch(Polygon(p['outer'],facecolor='white',edgecolor='none',zorder=4))
 status={a['sourceId']:a['status']for a in r['markingAudit']}
 for c in r['crossings']:
  color=colors.get(status.get(c['sourceId']),'#888');ax.plot([p[0]for p in c['points']],[p[1]for p in c['points']],color=color,lw=1.4,ls='--',zorder=5)
 x0,z0,x1,z1=t['bounds'];cx,_,cz=t['position'];ax.set_xlim(x0-cx,x1-cx);ax.set_ylim(z1-cz,z0-cz);ax.set_aspect('equal');ax.set_title(t['id'].title()+' | '+str(len(r['markings']))+' clipped paint records');ax.set_xlabel('Local x (m)');ax.set_ylabel('Local z (m), north at top')
fig.suptitle('Crossing evidence and clipped paint | estimated road edges and marking style',fontsize=13)
handles=[Line2D([0],[0],color=c,lw=2,ls='--',label=l)for l,c in [('Marking existence reported','#4cab8b'),('Marking evidence missing','#dd9d31'),('Conflicting tags','#d45a55')]]
fig.legend(handles=handles,loc='outside lower center',ncol=3,frameon=False)
fig.savefig(ROOT/'docs/research/p3-road-markings/coverage.png',dpi=170);plt.close(fig)
