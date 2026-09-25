// Opening equations match detail-geometry.js; all dimensions remain model estimates.
function halfWidth(o,y){
 const w=o.width,h=o.height,v=y-o.y;
 if(o.kind==='circle'){const r=w/2,dy=v-h/2;return Math.abs(dy)>=r?0:Math.sqrt(r*r-dy*dy);}
 if(v<0||v>h)return 0;
 if(o.kind==='pointed'&&v>h*.62){
  const t=(.4-Math.sqrt(.16-.08*(v/h-.62)))/.04;
  return w*(.5*(1-t)*(1-t)+.9*(1-t)*t);
 }
 if(o.kind==='arch'&&v>h-w/2){const r=w/2,dy=v-(h-r);return Math.sqrt(Math.max(0,r*r-dy*dy));}
 return w/2;
}
export function shutterLayout(o,{spacing=.13,height=.035,inset=.045}={}){
 if(![o.x??0,o.y,o.width,o.height,spacing,height,inset].every(Number.isFinite)||o.width<=0||o.height<=0||spacing<=height||height<=0||inset<0)throw new Error('Invalid shutter dimensions');
 const start=o.kind==='circle'?o.y+(o.height-o.width)/2:o.y,end=o.kind==='circle'?o.y+(o.height+o.width)/2:o.y+o.height;
 const result=[];
 for(let y=start+.07;y<end-.035;y+=spacing){
  const width=2*Math.min(halfWidth(o,y-height/2),halfWidth(o,y+height/2))-2*inset;
  if(width>.035)result.push({x:o.x??0,y,width,height,depth:.075});
 }
 return result;
}
