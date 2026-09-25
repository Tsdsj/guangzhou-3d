"""P0 research only: download metadata and a bounded OSM sample, never production data."""
from pathlib import Path
import concurrent.futures
import csv
import hashlib
import html
import json
import re
import sys
import time
from datetime import datetime, timezone
import requests

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / '.research/p0-2026-09-25/raw'
OUT = Path(__file__).resolve().parent
RAW.mkdir(parents=True, exist_ok=True)
UA = 'Guangzhou3D-P0Research/1.0 (public-source feasibility study)'
CATEGORIES = [
    'Buildings in Shamian', 'Bank of Taiwan Building, Guangzhou',
    "Banque de l'Indochine Building, Guangzhou", 'Former HSBC Building (Shamian)',
    'Our Lady of Lourdes Chapel, Shamian', 'Christ Church Shamian',
    'Victoria Hotel, Shamian', 'Huacheng Avenue, Guangzhou',
]

def request_json(url, params=None, method='GET'):
    time.sleep(3)
    r = requests.request(method, url, params=params if method == 'GET' else None,
                         data=params if method == 'POST' else None,
                         headers={'User-Agent': UA}, timeout=90)
    r.raise_for_status()
    data = r.json()
    if 'error' in data:
        raise RuntimeError(str(data['error']))
    return data

def cached(name, url, params):
    path = RAW / name
    if path.exists():
        return json.loads(path.read_text())
    data = request_json(url, params)
    save(name, data)
    return data

def save(name, data):
    p = RAW / name
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    return p

def strip(value):
    return html.unescape(re.sub('<[^>]+>', '', value or '')).strip()

def collect_commons():
    api = 'https://commons.wikimedia.org/w/api.php'
    files = {}
    for i, category in enumerate(CATEGORIES):
        data = cached(f'commons-category-{i}.json', api, dict(action='query', list='categorymembers',
            cmtitle='Category:' + category, cmlimit=500, format='json'))
        save(f'commons-category-{i}.json', data)
        if 'continue' in data:
            raise RuntimeError('Category requires pagination: ' + category)
        for item in data.get('query', {}).get('categorymembers', []):
            if item['ns'] == 6:
                files.setdefault(item['title'], []).append(category)
        print('category', category, len(data.get('query', {}).get('categorymembers', [])), flush=True)
    rows = []
    titles = sorted(files)
    for start in range(0, len(titles), 25):
        data = cached(f'commons-images-{start:03}.json', api, dict(action='query', titles='|'.join(titles[start:start+25]),
            prop='imageinfo|coordinates', iiprop='url|size|extmetadata', iiurlwidth=1200,
            colimit='max', format='json'))
        save(f'commons-images-{start:03}.json', data)
        for page in data.get('query', {}).get('pages', {}).values():
            info = (page.get('imageinfo') or [{}])[0]
            meta = info.get('extmetadata', {})
            get = lambda k: strip(meta.get(k, {}).get('value', ''))
            coord = (page.get('coordinates') or [{}])[0]
            rows.append(dict(title=page['title'], categories=' | '.join(files.get(page['title'], [])),
                page_url=info.get('descriptionurl',''), image_url=info.get('url',''),
                thumbnail_url=info.get('thumburl',''), width=info.get('width'), height=info.get('height'),
                license=get('LicenseShortName'), license_url=get('LicenseUrl'), artist=get('Artist'),
                credit=get('Credit'), date=get('DateTimeOriginal'), description=get('ImageDescription'),
                camera_lat=coord.get('lat'), camera_lon=coord.get('lon'),
                attribution_required=get('AttributionRequired'), restrictions=get('Restrictions')))
        print('image metadata', min(start+25,len(titles)), '/',len(titles), flush=True)
    rows.sort(key=lambda r:r['title'])
    save('commons-inventory.json', rows)
    with (OUT/'photo-inventory.csv').open('w',newline='',encoding='utf-8-sig') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    print('saved photo inventory',len(rows),flush=True)

def collect_osm():
    bbox='23.1205,113.311,23.124,113.3195'
    query=f'''[out:json][timeout:60];
    (way["highway"]({bbox});node["highway"]({bbox});
     relation["type"="restriction"]({bbox});relation["type"="connectivity"]({bbox}););
    out body geom;'''
    (OUT/'huacheng-overpass.ql').write_text(query)
    # Both tested Overpass endpoints timed out; the official bounded map API succeeded.
    data=request_json('https://api.openstreetmap.org/api/0.6/map.json',
                      dict(bbox='113.311,23.1205,113.3195,23.124'))
    if data.get('remark'):
        raise RuntimeError(data['remark'])
    save('osm-huacheng-map.json',data)
    print('OSM sample', len(data['elements']), data.get('osm3s'), flush=True)

if __name__ == '__main__':
    mode=sys.argv[1] if len(sys.argv)>1 else 'commons'
    {'commons':collect_commons,'osm':collect_osm}[mode]()
