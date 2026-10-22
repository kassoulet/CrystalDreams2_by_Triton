"""Decode the extracted CD2 images (TGA 8-bit, IFF ILBM/PBM) to PNG.  Usage: convert_assets.py EXTRACTED OUT"""
import os, sys, struct
from PIL import Image

def tga(b):
    idlen = b[0]; clen = struct.unpack('<H', b[5:7])[0]; w, h = struct.unpack('<HH', b[12:16])
    o = 18 + idlen; pal = b[o:o + clen*3]; o += clen*3
    im = Image.frombytes('P', (w, h), b[o:o + w*h])
    p = []
    for i in range(clen): bb, g, r = pal[i*3:i*3+3]; p += [r, g, bb]
    im.putpalette(p)
    return im.transpose(Image.FLIP_TOP_BOTTOM) if not b[17] & 0x20 else im

def unpackbits(src, n):
    out = bytearray(); i = 0
    while len(out) < n and i < len(src):
        c = src[i]; i += 1
        if c < 128: out += src[i:i+c+1]; i += c + 1
        elif c > 128: out += bytes([src[i]]) * (257 - c); i += 1
    return out[:n]

def iff(b):
    typ = b[8:12]; i = 12; bm = None; pal = None; body = None
    while i + 8 <= len(b):
        cid = b[i:i+4]; ln = struct.unpack('>I', b[i+4:i+8])[0]; d = b[i+8:i+8+ln]; i += 8 + ln + (ln & 1)
        if cid == b'BMHD': bm = struct.unpack('>HHhhBBBBHBBhh', d[:20])
        elif cid == b'CMAP': pal = d
        elif cid == b'BODY': body = d
    w, h, _, _, planes, mask, comp = bm[:7]
    rowb = ((w + 15) // 16) * 2
    if typ == b'PBM ':
        data = unpackbits(body, w*h) if comp else body[:w*h]   # PBM rows may be padded to even width
        im = Image.frombytes('P', (w, h), bytes(data))
    else:
        nplanes = planes + (1 if mask == 1 else 0)
        raw = unpackbits(body, rowb*nplanes*h) if comp else body
        px = bytearray(w*h)
        for y in range(h):
            for p in range(planes):
                row = raw[(y*nplanes + p)*rowb:(y*nplanes + p + 1)*rowb]
                for x in range(w):
                    if row[x >> 3] & (0x80 >> (x & 7)): px[y*w + x] |= 1 << p
        im = Image.frombytes('P', (w, h), bytes(px))
    if pal: im.putpalette(list(pal) + [0]*(768 - len(pal)))
    return im

if __name__ == '__main__':
    src, out = sys.argv[1:3]; os.makedirs(out, exist_ok=True)
    for f in sorted(os.listdir(src)):
        b = open(os.path.join(src, f), 'rb').read()
        try:
            im = tga(b) if f.endswith('.TGA') else iff(b) if f.endswith('.LBM') else None
        except Exception as e:
            print('FAIL', f, e); continue
        if im: im.convert('RGB').save(os.path.join(out, os.path.splitext(f)[0] + '.png')); print(f, im.size)
