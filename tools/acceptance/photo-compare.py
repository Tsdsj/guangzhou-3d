"""Side-by-side sheet: reference photo | model render (trees hidden, labelled) | model with trees.

Usage: python tools/acceptance/photo-compare.py <studies.json> <out.jpg> [id,id,...]
The photo is a free-licensed Commons thumbnail with its credit printed below; renders come from
tools/acceptance/run-studies.pw.js. Structure comparison only: viewpoints are not pixel-registered.
"""
import sys, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[2]
studies = json.loads(Path(sys.argv[1]).read_text())['studies']
out = Path(sys.argv[2])
if len(sys.argv) > 3:  # optional comma-separated subset of study ids
    keep = sys.argv[3].split(',')
    studies = {k: v for k, v in studies.items() if k in keep}
font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 18)
small = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 14)
W, Hh = 520, 390
rows = []
for sid, s in studies.items():
    photo_id = next(iter(s['photos']))
    p = s['photos'][photo_id]
    ph = Image.open(ROOT / p['path'][len('../../'):]).convert('RGB')
    ph.thumbnail((W, Hh))
    rend = [Image.open(ROOT / f'docs/research/p3-building-expansion/renders/{sid}-{k}.jpg').convert('RGB') for k in ('trees-hidden', 'with-trees')]
    rend = [r.crop((0, 0, 1440, 900)).resize((W, round(W * 900 / 1440))) for r in rend]
    row = Image.new('RGB', (W * 3 + 40, Hh + 70), (22, 24, 28))
    row.paste(ph, (10 + (W - ph.width) // 2, 40 + (Hh - ph.height) // 2))
    for k, r in enumerate(rend):
        row.paste(r, (20 + W * (k + 1), 40 + (Hh - r.height) // 2))
    d = ImageDraw.Draw(row)
    d.text((10, 8), f"{sid} · {s['name']} · {s['address']} · {s['sourceId']}", fill=(240, 240, 240), font=font)
    fname = p['file'] if len(p['file']) <= 28 else p['file'][:25] + '…'
    d.text((10, Hh + 44), f"照片：{p['artist']} · {p['date'][:10]} · {p['license']} · {fname}", fill=(200, 200, 200), font=small)
    d.text((20 + W, Hh + 44), '模型（树木暂隐，仅供检查）· 尺寸估计', fill=(200, 200, 200), font=small)
    d.text((30 + 2 * W, Hh + 44), '同机位保留树木', fill=(200, 200, 200), font=small)
    rows.append(row)
sheet = Image.new('RGB', (rows[0].width, sum(r.height for r in rows)), (22, 24, 28))
y = 0
for r in rows:
    sheet.paste(r, (0, y)); y += r.height
sheet.save(out, 'JPEG', quality=80, optimize=True)
print(out, sheet.size)
