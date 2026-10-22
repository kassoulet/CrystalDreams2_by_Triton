"""Extract, from the demo's own fractal scaler (run under Unicorn), the zoom-independent part of every output pixel:
   output pixel  <-  tile[2*k + bit9(col)][ (S + col*128) & 0xFFFF ]      col = max(0, T[z&7][j] - (z>>3))
Writes assets/orig/fractal_map.bin : 200x200 pixels x (j u8, k u8, S u16).
Also verifies the formula against the emulator at several zoom values.  Usage: extract_fractal_map.py MegaFrac.DAT OUT.bin"""
import sys, os, struct, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_fractal as R
from unicorn import *
from unicorn.x86_const import *

def extract(mega):
    F = R.Fractal(mega); mu = F.mu
    reads, ev = [], []
    cur_j = [0]
    base = 0x13fb * 16
    def rd(m, acc, addr, size, val, u): ev.append(('r', addr))
    def wr(m, acc, addr, size, val, u):
        ev.append(('w', addr - F.ES*16, size, F.plane))
    def jhook(m, a, s, u):
        bp = m.reg_read(UC_X86_REG_BP); ss = m.reg_read(UC_X86_REG_SS)
        cur_j[0] = struct.unpack('<H', bytes(m.mem_read(ss*16 + bp - 2, 2)))[0]
    mu.hook_add(UC_HOOK_MEM_READ, rd, None, 0x60000, 0xDFFFF)
    mu.hook_add(UC_HOOK_CODE, jhook, None, base + 0x403b, base + 0x403b)
    # track j at each write: wrap writes with the current j
    ev2 = []
    def wr2(m, acc, addr, size, val, u):
        ev2.append((cur_j[0], addr - F.ES*16, size, F.plane, len(ev)))
    mu.hook_add(UC_HOOK_MEM_WRITE, wr2, None, F.ES*16, F.ES*16 + 0xAFFF)
    F.frame(0xFFF8)                         # base = 8191 > every table value: col = 0 everywhere
    rec = []
    last_read = None
    # pair each write with the most recent read before it
    ri = 0; reads_only = [e for e in ev if e[0] == 'r']
    # simpler: ev holds reads only (writes are in ev2 with index of ev length at the time)
    for (j, off, size, plane, idx) in ev2:
        assert size == 1
        r = ev[idx - 1][1] if idx > 0 else None            # the read just before this write (movsb)
        ptr, S = divmod(r - 0x60000, 0x10000)
        rec.append((off, plane, j, ptr // 2, S, ptr))
    return rec

def pack(rec):
    """dense 200x200 map (x 60..259, even rows 0..398 -> 0..199): per pixel j(u8) k(u8) S(u16 LE)"""
    out = bytearray(200*200*4); seen = set()
    for off, plane, j, k, S, ptr in rec:
        y, xb = divmod(off, 80); x = 4*xb + {1: 0, 2: 1, 4: 2, 8: 3}[plane]
        assert y % 2 == 0 and 60 <= x < 260 and 0 <= y//2 < 200 and (x, y) not in seen
        seen.add((x, y)); q = ((y//2)*200 + (x-60))*4
        out[q] = j; out[q+1] = k; out[q+2] = S & 255; out[q+3] = S >> 8
    assert len(seen) == 40000
    return bytes(out)

def reference(mega, packed, z):
    """what the JS does, in numpy: returns the 200x200 picture"""
    T = [round(i/8 + 68.1*math.log((j+1)*2**24/500)) for i in range(8) for j in range(128)]
    base, i = z >> 3, z & 7
    a = np.frombuffer(packed, dtype=np.uint8).reshape(40000, 4)
    j, k, S = a[:, 0].astype(int), a[:, 1].astype(int), a[:, 2].astype(int) | (a[:, 3].astype(int) << 8)
    col = np.array([0] + [max(0, T[i*128 + n - 1] - base) for n in range(1, 101)])
    c = col[j]; ptr = 2*k + ((c >> 9) & 1); addr = (S + (c << 7)) & 0xFFFF
    m = np.frombuffer(mega, dtype=np.uint8)
    return m[ptr*65536 + addr].reshape(200, 200)

if __name__ == '__main__':
    mega = open(sys.argv[1], 'rb').read()
    rec = extract(mega)
    packed = pack(rec)
    open(sys.argv[2], 'wb').write(packed)
    F = R.Fractal(mega); bad = 0
    for z in (48, 53, 400, 1600, 3205, 6001, 7599):
        ref, _ = F.frame(z); mine = reference(mega, packed, z)
        bad += int((ref[0::2, 60:260] != mine).sum())
    print('wrote', sys.argv[2], len(packed), 'bytes; mismatching pixels vs emulator:', bad)
