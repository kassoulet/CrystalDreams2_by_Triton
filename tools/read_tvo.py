"""Parse Triton's .TVO vector objects ("VEC-ED v2.01"), reverse-engineered from the files.
 header: 4 words A,B,C,D (section offsets), word 10, word 256, Pascal string " VEC-ED v2.01"
 0x40  : 256 x RGB palette (6-bit-ish steps of 2: a grey ramp for shaded objects)
 A     : faces, 16 bytes each:  flags(0x140 poly | 0x80 sentinel), v0,v1,v2,v3, colour, 0, 0x38 ; the last 2 records are sentinels
 B     : vertices, 6 bytes each: x,y,z int16 (cube = +-9830); last 6 bytes are an extra record
 C,D   : 12 and 4 bytes per vertex, runtime scratch as far as I can tell (not needed to draw)
Counts: faces = (B-A)/16 - 2, vertices = (C-B)/6 - 1  (verified against the authors' numbers for King/Pawn/Knight)."""
import struct, sys, json

def read_tvo(b):
    A, B, C, D = struct.unpack('<4H', b[:8])
    nv = (C - B) // 6 - 1; nf = (B - A) // 16 - 2
    verts = [struct.unpack('<3h', b[B + i*6: B + i*6 + 6]) for i in range(nv)]
    faces = []
    for i in range(nf):
        f = struct.unpack('<8H', b[A + i*16: A + i*16 + 16])
        n = 4 if f[4] != f[1] or f[4] != f[3] else 3
        idx = list(f[1:5])
        # triangles repeat a vertex or use 0 padding; keep the unique-in-order run
        poly = []
        for v in idx:
            if not poly or v != poly[-1]: poly.append(v)
        if len(poly) > 3 and poly[0] == poly[-1]: poly.pop()
        faces.append({'flags': f[0], 'v': poly, 'raw': idx, 'color': f[5], 'extra': f[7]})
    pal = [tuple(b[0x40 + i*3: 0x43 + i*3]) for i in range(256)]
    return {'verts': verts, 'faces': faces, 'palette': pal, 'ver': b[0x0d:0x1b].decode('latin1')}

if __name__ == '__main__':
    o = read_tvo(open(sys.argv[1], 'rb').read())
    print(len(o['verts']), 'verts', len(o['faces']), 'faces', o['verts'][:3], o['faces'][:3])
