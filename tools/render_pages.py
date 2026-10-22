"""Render the Scr_*.RAW text pages the way the demo does (see image offset 0xFB4):
a page is lines of 4-byte records terminated by 0xFFFF; record = (word1 = glyph offset in the
640-px 1-bpp font sheet = EndFont2.LBM, byte2 = destination byte, byte3 = shift | width<<4).
Each line is 40 rows tall.  Usage: render_pages.py EXTRACTED OUTDIR"""
import os, struct, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import convert_assets

def sheet_bits(lbm):
    im = convert_assets.iff(lbm).convert('L') if False else convert_assets.iff(lbm)
    px = im.tobytes(); w, h = im.size
    return [[1 if px[y*w + x] else 0 for x in range(w)] for y in range(h)], w, h

def parse(raw):
    lines, cur, i = [], [], 0
    assert raw[:2] == b'\xff\xff'
    i = 2
    while i + 2 <= len(raw):
        w1 = struct.unpack('<H', raw[i:i+2])[0]
        if w1 & 0x8000:                     # terminator word
            lines.append(cur); cur = []; i += 2; continue
        if i + 4 > len(raw): break
        cur.append((w1, raw[i+2], raw[i+3])); i += 4
    if cur: lines.append(cur)
    return lines

def render(raw, sheet, SW, rows=40):
    lines = parse(raw)
    out = Image.new('L', (640, max(1, len(lines)) * rows))
    pix = out.load()
    for ln, recs in enumerate(lines):
        for w1, dst, b3 in recs:
            sh, wb = b3 & 7, b3 >> 4
            sy, sx = divmod(w1, 80)
            for k in range(wb):
                for r in range(rows):
                    y = sy + r
                    if y >= len(sheet): continue
                    byte = 0
                    for b in range(8):
                        xx = (sx + k)*8 + b
                        if xx < SW and sheet[y][xx]: byte |= 0x80 >> b
                    if not byte: continue
                    v = byte << (8 - sh) if False else byte                # 16-bit ror of an 8-bit value
                    word = ((byte >> sh) << 8) | ((byte << (8 - sh)) & 0xFF) if sh else byte << 8
                    # ror ax,cl on AX=byte -> high byte = byte>>sh, low = bits shifted out (stored via 16-bit OR at [di])
                    x0 = (dst + k) * 8
                    for b in range(16):
                        if word & (0x8000 >> b) and x0 + b < 640:
                            pix[x0 + b, ln*rows + r] = 255
    return out, lines

if __name__ == '__main__':
    src, outd = sys.argv[1:3]; os.makedirs(outd, exist_ok=True)
    sheet, SW, SH = sheet_bits(open(os.path.join(src, 'EndFont2.LBM'), 'rb').read())
    for f in sorted(os.listdir(src)):
        if f.startswith('Scr_'):
            im, lines = render(open(os.path.join(src, f), 'rb').read(), sheet, SW)
            im.save(os.path.join(outd, f[:-4] + '.png')); print(f, len(lines), 'lines', im.size)

# ---- text decoding: cells in the font sheet are kerning pairs; a record's character is the FIRST letter of its cell
def _glyph_map():
    m = {}
    def put(band, items):
        for x, ch in items: m[band*40*80 + x] = ch
    put(0, zip([0,6,9,12,15,18,21,24,27,30,33,36,39,45,51,54,57,60,63,66,69,72], 'ABCDEFGHIJKLMNOPQRSTUV'))
    put(1, zip([0,6,12,18], 'WXYZ'))
    put(1, zip([39,42,45,48,51,54,57,60,63,66], '0123456789'))
    put(1, [(69,'!'),(72,'.'),(75,'?'),(78,',')])
    put(2, zip([0,3,6,9,12,15,18,21,24,27,30,33,36,42,45,48,51,54,57,60,63,66,69,75], 'abcdefghijklmnopqrstuvwx'))
    put(3, [(0,'y'),(3,'z'),(6,'ä'),(9,'å'),(12,'ö'),(15,':'),(21,'('),(24,')'),(27,'-'),(30,'+'),(33,'*'),(36,'/'),(42,"'"),(45,'"'),(48,'='),(51,'■'),(57,' ')])
    return m
GLYPHS = _glyph_map()

def page_text(raw):
    out = []
    for ln in parse(raw):
        out.append(''.join(GLYPHS.get(w1, '¿') for w1, d, b3 in ln).rstrip())
    return out
