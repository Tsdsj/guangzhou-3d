"""Downscale acceptance screenshots for the repository and build labelled contact sheets.

Usage: python tools/acceptance/contact-sheet.py <dir> <sheet.jpg> [columns]
Originals are replaced by 960 px wide JPEG (quality 74); the sheet tiles every *.jpg in name order.
Screenshots are evidence of what this browser rendered, not photographs of the real city.
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

src = Path(sys.argv[1]); sheet_path = Path(sys.argv[2]); cols = int(sys.argv[3]) if len(sys.argv) > 3 else 3
files = sorted(p for p in src.glob('*.jpg'))
for p in files:
    im = Image.open(p)
    if im.width > 960:
        im = im.convert('RGB').resize((960, round(im.height * 960 / im.width)), Image.LANCZOS)
        im.save(p, 'JPEG', quality=74, optimize=True)
tw, th = 480, 300
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 22)), (24, 26, 30))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 13)
except OSError:
    font = ImageFont.load_default()
for i, p in enumerate(files):
    im = Image.open(p).convert('RGB').resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * (th + 22)
    sheet.paste(im, (x, y + 22))
    draw.text((x + 6, y + 4), p.stem, fill=(235, 235, 235), font=font)
sheet.save(sheet_path, 'JPEG', quality=78, optimize=True)
print(len(files), 'images ->', sheet_path, sheet.size)
