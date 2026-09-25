"""Read-only source interpretation. Never infer physical access from graph membership."""
import json,hashlib

def classify_endpoint(node,source_way,related_ways):
    result={'physicalPassabilityVerified':False,'heightM':None}
    if node is None or source_way is None or related_ways is None:
        return result|{'status':'incomplete-source','linkedWays':[]}
    if not source_way.get('nodes') or node['id'] not in [source_way['nodes'][0],source_way['nodes'][-1]]:
        return result|{'status':'endpoint-changed','linkedWays':[]}
    related=[w for w in related_ways if w['id']!=source_way['id'] and node['id'] in w.get('nodes',[])]
    highways=[w for w in related if w.get('tags',{}).get('highway')]
    buildings=[w for w in related if any(w.get('tags',{}).get(k) not in [None,'no'] for k in ['building','building:part'])]
    selected=highways or buildings
    refs=[{'sourceId':'osm:w'+str(w['id']),'version':w.get('version'),'name':w.get('tags',{}).get('name'),'tags':w.get('tags',{})}for w in selected]
    if highways:status='highway-connection'
    elif buildings:status='building-interface'
    else:
        tags=node.get('tags',{})
        status='tagged-terminal' if tags.get('entrance') not in [None,'no'] or tags.get('amenity')=='parking' or tags.get('railway')=='subway_entrance' else 'unresolved'
    return result|{'status':status,'linkedWays':refs,'nodeTags':node.get('tags',{})}

def merge_network(base_bytes,delta):
    if hashlib.sha256(base_bytes).hexdigest()!=delta.get('baseSha256'):raise ValueError('Review delta base snapshot mismatch')
    base=json.loads(base_bytes);elements=list(base['elements']);keys={(e['type'],e['id'])for e in elements}
    for e in delta['elements']:
        key=(e['type'],e['id'])
        if key in keys:raise ValueError('Review delta cannot overwrite existing object')
        keys.add(key);elements.append(e)
    for e in elements:
        if e['type']=='way' and any(('node',n)not in keys for n in e.get('nodes',[])):raise ValueError('Review delta contains unresolved node references')
    return base|{'elements':elements}
