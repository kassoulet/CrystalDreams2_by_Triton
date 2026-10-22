"""Export decoded CD2 data for the website.  Usage: python3 tools/export_data.py EXTRACTED_DIR OUT_DIR
 - objects.json : selected .TVO models (vertices / polygons)
 - pages.json   : the six Scr_*.RAW text pages as text (private addresses and phone numbers omitted)
 - page_*.png   : the same pages rendered with the demo's own glyph blitting (same lines blanked)
 - strip.png    : MegaFrac.DAT deplaned to its 4096 x 128 picture
"""
import json, os, sys
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import read_tvo, render_pages as R

src, out = sys.argv[1:3]; os.makedirs(out, exist_ok=True)

# ---- objects
OBJ = ['SHD_Cube', 'NCL-King', 'NCD-King', 'NCL-Quen', 'NCD-Quen', 'NCL-Towr', 'NCD-Towr', 'NCL-Hrse', 'NCD-Hrse', 'NCL-Bond', 'NCD-Bond',
       'NC-MB3', 'NC-MB4', 'Earth3', 'NF-NShip', 'TxtTori8']
objs = {}
for n in OBJ:
    o = read_tvo.read_tvo(open(os.path.join(src, n + '.TVO'), 'rb').read())
    nv = len(o['verts'])
    faces = [[*[v for v in f['v'] if v < nv], f['color']] for f in o['faces'] if len([v for v in f['v'] if v < nv]) >= 3]
    objs[n] = {'v': [c for v in o['verts'] for c in v], 'f': faces}
json.dump(objs, open(os.path.join(out, 'objects.json'), 'w'), separators=(',', ':'))

# ---- pages (blank the address block of the Information page)
sheet, SW, SH = R.sheet_bits(open(os.path.join(src, 'EndFont2.LBM'), 'rb').read())
TITLES = {'Scr_Cred': 'Credits', 'Scr_Gret': 'Greetings', 'Scr_Info': 'Information', 'Scr_Comm': 'Comments', 'Scr_Mess': 'Messages', 'Scr_Rumr': 'Rumours about CD2'}
pages = {}
for f, title in TITLES.items():
    raw = open(os.path.join(src, f + '.RAW'), 'rb').read()
    lines = R.page_text(raw); recs = R.parse(raw)
    if f == 'Scr_Info':
        a = next(i for i, l in enumerate(lines) if l.strip() == 'Vogue')
        z = next(i for i, l in enumerate(lines) if l.startswith('Note:'))
        for i in range(a, z):
            lines[i] = ''; recs[i] = []
        lines[a] = '[four home addresses and phone numbers omitted here]'
    pages[f] = {'title': title, 'lines': lines}
    # render using the (possibly blanked) records
    img = Image.new('L', (640, max(1, len(recs)) * 40)); pix = img.load()
    tmp = R.render.__wrapped__ if hasattr(R.render, '__wrapped__') else None
    # reuse R.render by rebuilding a raw stream from the records
    import struct
    rawb = b'\xff\xff' + b''.join(b''.join(struct.pack('<HBB', w1, d, b3) for w1, d, b3 in ln) + b'\xff\xff' for ln in recs)
    im, _ = R.render(rawb, sheet, SW)
    im.save(os.path.join(out, 'page_' + f[4:].lower() + '.png'))
json.dump(pages, open(os.path.join(out, 'pages.json'), 'w'), ensure_ascii=False, indent=1)

# ---- fractal strip
m = np.frombuffer(open(os.path.join(src, 'MegaFrac.DAT'), 'rb').read(), dtype=np.uint8).reshape(-1, 128)
strip = np.zeros((128, 4096), np.uint8)               # 4 planes x 1024 columns; the last 16 KB of the file is a table
for p in range(4): strip[:, p::4] = m[p*1024:(p+1)*1024].T
Image.fromarray(strip).save(os.path.join(out, 'strip.png'))
print('objects', len(objs), 'pages', len(pages))
