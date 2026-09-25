"""Accept a file whose hash equals a round's baseline or follows data/detail/upgrades.json from it."""
import json, hashlib
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]


def current(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def accepted(path, baseline):
    h, seen = baseline, set()
    chain = json.loads((ROOT / 'data/detail/upgrades.json').read_text())['upgrades']
    while h not in seen:
        if h == current(path):
            return True
        seen.add(h)
        nxt = [u['files'][path]['to'] for u in chain if path in u['files'] and u['files'][path]['from'] == h]
        if not nxt:
            return False
        h = nxt[0]
    return False
