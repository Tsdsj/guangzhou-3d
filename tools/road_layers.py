"""Eligibility for the current flat surface model; layer/level are never metric heights."""
import math

def classify_way(tags):
    reasons=[];kind='ground-assumed'
    if tags.get('highway') in ['steps','elevator'] or tags.get('conveying') not in [None,'no']:
        kind='vertical-transition';reasons.append('vertical connection requires a dedicated geometry')
    elif tags.get('tunnel')=='building_passage':
        kind='building-passage';reasons.append('through-building geometry; not automatically underground')
    elif tags.get('bridge') not in [None,'no']:
        kind='bridge';reasons.append('bridge structure requires an elevation model')
    elif tags.get('tunnel') not in [None,'no']:
        kind='tunnel';reasons.append('tunnel section is retained outside the flat surface model')
    elif tags.get('location') in ['underground','overhead','roof','rooftop']:
        kind='non-surface-location';reasons.append('explicit non-surface location')
    elif tags.get('indoor') not in [None,'no']:
        kind='indoor';reasons.append('indoor route requires separate treatment')
    for key in ['layer','level']:
        if key not in tags:continue
        try:
            values=[float(v.strip()) for v in str(tags[key]).split(';')]
            valid=all(math.isfinite(v) for v in values)
        except ValueError:valid=False;values=[]
        if not valid or any(v!=0 for v in values):
            reasons.append(f'{key} requires review; not a metric height')
            if kind=='ground-assumed':kind='nonzero-or-ambiguous-level'
    incline=str(tags.get('incline','0')).strip().rstrip('%°')
    try:slope=float(incline)
    except ValueError:slope=None
    if slope is None or not math.isfinite(slope) or slope!=0:
        reasons.append('incline cannot be flattened without elevation evidence')
        if kind=='ground-assumed':kind='slope'
    return {'kind':kind,'groundRenderable':not reasons,'heightM':None,'heightStatus':'unknown','reasons':reasons}
