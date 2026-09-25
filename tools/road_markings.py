"""Source-aware, continuous-chainage crosswalk paint. Horizontal dimensions are estimates."""
import math,bisect
from shapely.geometry import Polygon,LineString

def marking_policy(tags):
    marking=tags.get('crossing:markings');legacy=tags.get('crossing')
    absent=marking=='no' or legacy=='unmarked'
    present=(marking is not None and marking!='no') or legacy in ['marked','zebra']
    if absent and present:return {'status':'conflict','render':False,'reason':'marking tags disagree'}
    if absent:return {'status':'absent','render':False}
    if marking in ['yes','zebra'] or (marking is None and legacy in ['marked','zebra']):
        exact=marking=='zebra' or legacy=='zebra'
        return {'status':'reported','render':True,'pattern':'zebra','patternStatus':'reported' if exact else 'estimated'}
    if marking:return {'status':'unsupported-pattern','render':False,'pattern':marking}
    return {'status':'unknown','render':False,'reason':'crossing location/signals do not establish road markings'}

def stripe_candidates(line,width=3.1,thickness=.48,pitch=1.0,phase=.4):
    if not all(math.isfinite(v) for v in [width,thickness,pitch,phase]) or min(width,thickness,pitch)<=0 or phase<0:raise ValueError('Invalid stripe dimensions')
    pts=[]
    for p in line.coords:
        if not pts or p[:2]!=pts[-1]:pts.append(p[:2])
    if len(pts)<2:return []
    lengths=[math.dist(a,b) for a,b in zip(pts,pts[1:])];cumulative=[0]
    for length in lengths:cumulative.append(cumulative[-1]+length)
    result=[];index=0
    while (s:=phase+index*pitch)<cumulative[-1]:
        k=min(len(lengths)-1,bisect.bisect_right(cumulative,s)-1)
        a,b=pts[k],pts[k+1];dx=(b[0]-a[0])/lengths[k];dz=(b[1]-a[1])/lengths[k]
        x=a[0]+dx*(s-cumulative[k]);z=a[1]+dz*(s-cumulative[k])
        poly=Polygon([(x-u*dz+v*dx,z+u*dx+v*dz) for u,v in [(-width/2,-thickness/2),(width/2,-thickness/2),(width/2,thickness/2),(-width/2,thickness/2)]])
        result.append({'stripeIndex':index,'chainageM':s,'geometry':poly});index+=1
    return result

def polygons(geometry):
    if geometry.is_empty:return []
    if geometry.geom_type=='Polygon':return [geometry]
    return [p for part in getattr(geometry,'geoms',[]) for p in polygons(part)]

def clip_stripes(source_id,line,road,area):
    mask=road.intersection(area).intersection(line.buffer(1.55,cap_style='flat'))
    result=[]
    for stripe in stripe_candidates(line):
        geometry=stripe['geometry'].intersection(mask)
        if geometry.area<=1e-8:continue
        result.append({**stripe,'id':f"{source_id}:stripe:{stripe['stripeIndex']}",'sourceId':source_id,'geometry':geometry})
    return result

def package_markings(records,road,area,center=(0,0)):
    cx,cz=center;paint=[];audit=[]
    for source_id,line,tags in records:
        if not line.buffer(1.55).intersects(area):continue
        policy=marking_policy(tags);audit.append({'sourceId':source_id,'tags':tags,**policy})
        if not policy['render']:continue
        for stripe in clip_stripes(source_id,line,road,area):
            parts=[]
            for p in polygons(stripe['geometry']):
                parts.append({'outer':[[x-cx,z-cz]for x,z in p.exterior.coords],'holes':[[[x-cx,z-cz]for x,z in h.coords]for h in p.interiors]})
            if parts:paint.append({k:v for k,v in stripe.items() if k!='geometry'}|{'polygons':parts,'dimensionStatus':'estimated','patternStatus':policy['patternStatus']})
    return {'markings':paint,'markingAudit':audit,'markingVersion':1}
