"""Render the bounded P3 plan audit; input outlines are not independent survey truth."""
from pathlib import Path
import json
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/research/p3-building-corrections';OUT.mkdir(exist_ok=True)
read=lambda p:json.loads(p.read_text())
samples=read(ROOT/'data/detail/shamian.json')['samples']['buildings']
report=read(ROOT/'data/detail/building-fit-report.json')
fig,axes=plt.subplots(1,3,figsize=(12,5.6),layout='constrained')
for ax,rec in zip(axes,report['buildings']):
 sid=rec['sampleId'];f=samples[sid]['planFit']
 for name,key,color,style in [('Previous nominal plan','source','#ce7e38','--'),('OSM target / fitted control boundary','target','#26777b','-')]:
  ring=f[key]+f[key][:1];ax.plot([p[0]for p in ring],[-p[1]for p in ring],style,color=color,lw=2,label=name)
 ax.scatter([p[0]for p in f['target']],[-p[1]for p in f['target']],s=14,color='#26777b',zorder=4)
 ax.set_title(f"{sid} | {rec['sourceId']}\nPrevious control offset: {rec['beforeControlMaxOffsetM']:.3f} m",fontsize=11,pad=12)
 ax.set_aspect('equal');ax.grid(alpha=.18);ax.set_xlabel('Local x (m)');ax.set_ylabel('Local -z (m)')
 ax.text(.5,-.19,'F0 faces down in this local model frame',ha='center',transform=ax.transAxes,fontsize=8,color='#555')
fig.suptitle('P3 structural plan correction | fixed OSM snapshot, not surveyed accuracy',fontsize=14)
handles,labels=axes[0].get_legend_handles_labels();fig.legend(handles,labels,loc='outside lower center',ncol=2,frameon=False,fontsize=10)
fig.savefig(OUT/'plan-fit.png',dpi=180);fig.savefig(OUT/'plan-fit.svg');plt.close(fig)
print(OUT/'plan-fit.png')
