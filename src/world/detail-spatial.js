import { FILL } from './schema.js';
const bounds=p=>[Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1])),Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))];
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
export function emitRoutedParts(base,target,emit){
  target ||= base;
  if(target!==base)target.seedCounter=base.seedCounter;
  emit(target);
  if(target!==base)base.seedCounter=target.seedCounter;
}
function inside(p,poly){
  let yes=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[j],b=poly[i];
    if(Math.abs(cross(a,b,p))<1e-7&&p[0]>=Math.min(a[0],b[0])-1e-7&&p[0]<=Math.max(a[0],b[0])+1e-7&&p[1]>=Math.min(a[1],b[1])-1e-7&&p[1]<=Math.max(a[1],b[1])+1e-7)return false;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  }return yes;
}
export function polygonsOverlap(a,b){
  const A=bounds(a),B=bounds(b);if(A[2]<=B[0]+1e-6||B[2]<=A[0]+1e-6||A[3]<=B[1]+1e-6||B[3]<=A[1]+1e-6)return false;
  if(a.some(p=>inside(p,b))||b.some(p=>inside(p,a)))return true;
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    if(cross(p,q,r)*cross(p,q,s)<-1e-8&&cross(r,s,p)*cross(r,s,q)<-1e-8)return true;
  }
  const center=p=>p.reduce((s,q)=>[s[0]+q[0]/p.length,s[1]+q[1]/p.length],[0,0]);
  return inside(center(a),b)&&inside(center(a),a)||inside(center(b),a)&&inside(center(b),b);
}
export function classifyDetails(D,manifest){
  const sourceTiles=new Map(),regions=[];
  for(const tile of manifest?.tiles||[])for(const b of tile.buildings||[]){for(const id of b.replaceIds)sourceTiles.set(id,tile.id);regions.push({tileId:tile.id,poly:b.footprint,bounds:bounds(b.footprint)});}
  const fillTiles=new Map();const f=D.S.fill;
  for(let k=0;k<D.nFill;k++){
    const o=k*FILL.N,x=f[o+FILL.X],z=f[o+FILL.Z],w=f[o+FILL.W]/2,d=f[o+FILL.D]/2,ux=f[o+FILL.UX],uz=f[o+FILL.UZ];
    const ex=Math.abs(ux*w)+Math.abs(uz*d),ez=Math.abs(uz*w)+Math.abs(ux*d);
    for(const r of regions){if(x+ex<=r.bounds[0]||x-ex>=r.bounds[2]||z+ez<=r.bounds[1]||z-ez>=r.bounds[3])continue;
      const poly=[[-w,-d],[w,-d],[w,d],[-w,d]].map(([a,b])=>[x+ux*a-uz*b,z+uz*a+ux*b]);
      if(polygonsOverlap(poly,r.poly)){fillTiles.set(k,r.tileId);break;}
    }
  }
  return {sourceTiles,fillTiles};
}
