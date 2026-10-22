"""Render the cube scene's four title lines with the demo's own text routine (image 0x15980) under emulation.
The routine converts a 4-plane font bitmap (planes 8000 bytes apart) to linear 256-colour pixels with a colour base."""
import sys, os, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_cube as R, convert_assets as C
import numpy as np
from unicorn import *
from unicorn.x86_const import *
# the exact Pascal strings from the scene (leading spaces centre the text; '&' is part of the original string)
LINES = [' View the inside', '      of a cube', '     &through a', '    magic block']
Y = (0x32, 0x50, 0x6e, 0x8c); BASE = (0, 0x10, 0x20, 0x30)

def font_planes(lbm):
    px = np.array(C.iff(lbm)).astype(np.uint8)
    out = bytearray()
    for p in range(4):
        for y in range(200): out += bytes(np.packbits((px[y] >> p) & 1))
    return bytes(out)

def render(lbm_bytes):
    c = R.Cube(); mu = c.mu
    fseg = c.alloc(32000); mu.mem_write(R.lin(fseg, 0), font_planes(lbm_bytes)); c.set_ds16(0xced8, fseg); c.set_ds16(0xced4, 0x2598)      # code alias for the self-patching text routine
    dst = c.alloc(64016); sseg = c.alloc(256); offs = []; o = 0
    for l in LINES:
        mu.mem_write(R.lin(sseg, o), bytes([len(l)]) + l.encode()); offs.append(o); o += len(l) + 2
    ss = R.SS
    mu.reg_write(UC_X86_REG_SS, ss); mu.reg_write(UC_X86_REG_DS, R.DS); mu.reg_write(UC_X86_REG_FS, R.DS)
    mu.mem_write(R.lin(dst, 0), bytes(64000))
    for i in range(4):
        sp = 0xFE00
        for w in (dst, 0xa, Y[i], BASE[i], sseg, offs[i], 0x2598, 0xBEEF):     # args (pascal order), far return cs:ip
            sp -= 2; c.w16(ss, sp, w)
        mu.reg_write(UC_X86_REG_SP, sp); mu.reg_write(UC_X86_REG_BP, 0xFF00); mu.reg_write(UC_X86_REG_CS, 0x2598)
        stop = R.lin(0x2598, 0xBEEF)
        h = mu.hook_add(UC_HOOK_CODE, lambda m, a, s, u: m.emu_stop() if a == stop else None, None, stop, stop)
        mu.emu_start(R.lin(0x2598, 0), stop + 1, count=100_000_000); mu.hook_del(h)
    return np.frombuffer(bytes(mu.mem_read(R.lin(dst, 0), 64000)), np.uint8).reshape(200, 320).copy()

if __name__ == '__main__':
    # usage: run_title.py Nice-f16.LBM OUT.png   (writes an 8-bit grey PNG whose grey value is the palette index 0..63)
    from PIL import Image
    buf = render(open(sys.argv[1], 'rb').read())
    print('nonzero pixels', int((buf > 0).sum()), 'index range', buf[buf > 0].min(), buf.max())
    Image.fromarray(buf, 'L').save(sys.argv[2])
