"""Check research artifact integrity and reproducible summaries; not a ground-truth test."""
from pathlib import Path
import json,csv,hashlib,subprocess,re
from datetime import datetime,timezone
from PIL import Image
from shapely.geometry import shape,box

OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[2]
load=lambda p:json.loads(p.read_text())
summary=load(OUT/'summary.json');manifest=load(OUT/'source-manifest.json');checks=[]
def check(name,value):
    assert value,name
    checks.append({'check':name,'passed':True})
for f in manifest['source_files']:
    check('source hash '+f['path'],hashlib.sha256((OUT/f['path']).read_bytes()).hexdigest()==f['sha256'])
for f in manifest['production_inputs']:
    check('production file unchanged since manifest '+f['path'],hashlib.sha256((ROOT/f['path']).read_bytes()).hexdigest()==f['sha256'])
for area,s in summary['areas'].items():
    fs=load(OUT/f'{area}-overture-buildings.geojson')['features']
    check(area+' unique source IDs',len({f['properties']['id']for f in fs})==len(fs))
    check(area+' all geometries intersect ROI',all(shape(f['geometry']).intersects(box(*s['bbox']))for f in fs))
    check(area+' counts reconcile',s['overture_records']==s['matched_iou_ge_0_5']+s['additional_candidates_overlap_lt_0_1']+s['ambiguous_records']==len(fs))
    check(area+' candidate height not invented',s['new_candidates_height']==0)
roads=summary['roads']['live_map']
check('road additions reconcile',roads['additional_way_count']==sum(roads['additional_types'].values())==143)
check('all restriction references present',all(r['members_complete']for r in roads['restrictions']))
cards=list(csv.DictReader((OUT/'building-samples.csv').open(encoding='utf-8-sig')))
faces=list(csv.DictReader((OUT/'facade-evidence.csv').open(encoding='utf-8-sig')))
check('3 building samples',len(cards)==3)
check('15 face/roof records without unverified precision claims',len(faces)==15 and all(f['metric_accuracy']=='unverified'for f in faces))
inventory=list(csv.DictReader((OUT/'photo-inventory.csv').open(encoding='utf-8-sig')))
check('127 unique photo metadata records',len(inventory)==len({r['title']for r in inventory})==127)
photos=load(OUT/'selected-photos.json')
check('12 visually reviewed photos',len(photos)==12 and all(p['review_status']=='visually_reviewed'for p in photos))
for p in photos:
    check(p['sample_id']+' source and license recorded',bool(p['page_url']and p['license']and p['license_url']and p['artist']))
    check(p['sample_id']+' image hash',hashlib.sha256((OUT/p['local_path']).read_bytes()).hexdigest()==p['sha256'])
    with Image.open(OUT/p['local_path'])as im:im.verify()
for name in ['building-coverage.png','road-evidence.png']:
    with Image.open(OUT/name)as im:
        check(name+' readable and substantial resolution',im.width>=1600 and im.height>=1000);im.verify()
for md in ['README.md','photo-review.md']:
    text=(OUT/md).read_text()
    links=re.findall(r'\]\(([^)]+)\)',text)
    check(md+' local links resolve',all((OUT/link.split('#')[0]).exists()for link in links if not link.startswith(('https://','http://'))))
changed=subprocess.check_output(['git','diff','--name-only'],cwd=ROOT,text=True).splitlines()
check('no tracked product changes',all(p.startswith('docs/')for p in changed))
result={'checked_at_utc':datetime.now(timezone.utc).isoformat(),'status':'passed','checks':checks,
        'limits':['Checks prove artifact integrity, internal consistency and source traceability only.',
                  'No surveyed geometry accuracy, all-facade completion, or new renderer performance was validated.'],
        'artifacts':{p.name:hashlib.sha256(p.read_bytes()).hexdigest()for p in OUT.iterdir()if p.is_file()and p.name!='validation.json'}}
(OUT/'validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
print('passed',len(checks),'research integrity checks')
