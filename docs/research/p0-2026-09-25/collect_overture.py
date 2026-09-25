"""Bounded P0 download. Work around null collection fields in the observed STAC index."""
from pathlib import Path
import json
import requests
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq
from shapely import from_wkb
from shapely.geometry import mapping, box

ROOT=Path(__file__).resolve().parents[3]
RAW=ROOT/'.research/p0-2026-09-25/raw'
OUT=Path(__file__).resolve().parent
AREAS={
    'shamian':[113.234,23.1065,113.2455,23.1112],
    'huacheng':[113.311,23.1205,113.3195,23.124],
}
index_path=RAW/'overture-collections.parquet'
if not index_path.exists():
    response=requests.get('https://stac.overturemaps.org/2026-09-23.0/collections.parquet',timeout=45)
    response.raise_for_status();index_path.write_bytes(response.content)
index=pq.read_table(index_path)
s3=pafs.S3FileSystem(anonymous=True,region='us-west-2',connect_timeout=15,request_timeout=60)
provenance={'release':'2026-09-23.0','index_rows':index.num_rows,
    'null_collection_rows':index['collection'].null_count,'areas':{}}
for name,b in AREAS.items():
    region=box(*b)
    paths=[]
    for row in index.select(['bbox','assets']).to_pylist():
        bounds=row['bbox']
        url=row['assets']['aws']['alternate']['s3']['href']
        if '/theme=buildings/type=building/' not in url:
            continue
        if box(bounds['xmin'],bounds['ymin'],bounds['xmax'],bounds['ymax']).intersects(region):
            paths.append(url[5:])
    assert paths, f'No building assets intersect {name}'
    print(name,'candidate files',len(paths),flush=True)
    dataset=ds.dataset(paths,filesystem=s3,format='parquet')
    filt=((pc.field('bbox','xmin')<=b[2])&(pc.field('bbox','xmax')>=b[0])&
          (pc.field('bbox','ymin')<=b[3])&(pc.field('bbox','ymax')>=b[1]))
    table=dataset.to_table(filter=filt)
    features=[]
    for row in table.to_pylist():
        geometry=from_wkb(row.pop('geometry'))
        if not geometry.intersects(region):
            continue
        features.append({'type':'Feature','id':row['id'],'geometry':mapping(geometry),'properties':row})
    output={'type':'FeatureCollection','features':features}
    (RAW/f'overture-{name}.geojson').write_text(json.dumps(output,ensure_ascii=False,default=str))
    provenance['areas'][name]={'bbox':b,'source_paths':['s3://'+p for p in paths],
                             'features':len(features)}
    print(name,'downloaded',len(features),flush=True)
(OUT/'overture-provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2))
