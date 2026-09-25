"""City-local frame helpers shared by the offline tools (x east, z south, metres; see data/guangzhou.json origin)."""
import json, gzip, struct
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]


def load_city():
    meta = json.loads((ROOT / 'data/guangzhou.json').read_text())
    raw = gzip.decompress((ROOT / 'data' / meta['files'][0]['name']).read_bytes())
    o = meta['origin']
    proj = lambda lon, lat: ((lon - o['lon']) * o['kx'], -(lat - o['lat']) * o['kz'])
    unproj = lambda x, z: (x / o['kx'] + o['lon'], -z / o['kz'] + o['lat'])
    def section(name, fmt='f'):
        s = meta['sections'][name]
        return struct.unpack_from('<' + fmt * s['length'], raw, s['offset'])
    i = meta['sections']['renderIdentity']
    ids = json.loads(raw[i['offset']:i['offset'] + i['length']])
    return meta, proj, unproj, section, ids
