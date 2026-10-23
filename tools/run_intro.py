"""Run the demo's intro (unit 1BEEh: image 0xBEE0.., 16-colour planar mode 0) under Unicorn and record each frame.
Builds on run_tunnel.py (units, file layer, VGA model).  usage: run_intro.py OUT.npz [nframes]"""
import sys, os, struct
import numpy as np
from unicorn import *
from unicorn.x86_const import *
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_slime as S, run_tunnel as T
from run_slime import lin, DS, SS, BASE, IMG

def setup():
    c = T.Tunnel(); mu = c.mu; c.shrink64k = os.environ.get('SHRINK64K') == '1'; c.cap64k = 0xA000        # the polygon filler's code buffer needs 0x9E5B bytes of the 64 KB block
    import run_title
    fseg = c.alloc(32000); mu.mem_write(lin(fseg, 0), run_title.font_planes(open(os.environ['CD2_FONT'], 'rb').read()))
    c.set_ds16(0xced8, fseg); c.set_ds16(0xced4, 0x2598)
    for i in range(8): c.set_ds16(0xf100 + 2 * i, 0xA000 + 0x200 * i)             # eight 8 KB page selectors
    S.init_files(c, 0x4100); mu.mem_write(DS * 16 + 0xee00, bytes(768)); c.set_ds16(0x6ff4, 0xA000); c.set_ds16(0x6670, 1); c.set_ds16(0x6674, 0xFFFF)
    for seg, off in ((0x296a, 0xc82b), (0x2612, 0x3577), (0x2598, 0x798), (0x21a1, 0x29ab), (0x1f63, 0x1dad), (0x1e45, 0x11d5), (0x1df6, 0x4ea), (0x1de3, 0x11f),
                     (0x1bee, 0x1f4a), (0x1b7a, 0x733), (0x19b2, 0x1c72), (0x18e1, 0xd08)):
        S.call(c, off, cs=seg)
    return c

def record(nframes, tick_hz=50.0, fps=70.0, per_frame_limit=100_000_000):
    c = setup(); mu = c.mu
    S.call(c, 0x1d50, cs=0x1bee)                                       # intro init: buffers, the four pictures
    sp = c.sp0
    for w in (0x1000, 0xBEEF): sp -= 2; c.w16(SS, sp, w)
    mu.reg_write(UC_X86_REG_SS, SS); mu.reg_write(UC_X86_REG_SP, sp); mu.reg_write(UC_X86_REG_BP, 0xFF00); mu.reg_write(UC_X86_REG_DS, DS); mu.reg_write(UC_X86_REG_ES, DS)
    F = []; P = []; T_ = []; A = []; pos = (0x1bee, 0x1d0c)
    for f in range(nframes):
        c.set_ds16(0x667e, int(f * tick_hz / fps)); c.set_ds16(0x667c, f)
        try: c.run_until(pos[0], pos[1], 0x1000, 0xBEEF, count=per_frame_limit)
        except Exception as e: print('frame', f, 'stopped:', repr(e)[:120]); break
        if not c.flip_hit: print('frame', f, 'scene returned'); break
        pos = c._resume
        start = c.flip_arg if c.flip_arg is not None else (A[-1] if A else 0)
        A.append(start); F.append(c.vga.image(start)); P.append(np.frombuffer(bytes(c.dac[:48]), np.uint8).copy()); T_.append(c.ds16(0x667e))
        if f % int(os.environ.get('PRINT_EVERY', 100)) == 0: print('frame', f, 'pos', hex(pos[0]), hex(pos[1]), 'start', hex(start), flush=True)
    return np.array(F), np.array(P).reshape(-1, 16, 3), np.array(T_), np.array(A)

if __name__ == '__main__':
    F, P, T_, A = record(int(sys.argv[2]) if len(sys.argv) > 2 else 6000)
    np.savez_compressed(sys.argv[1], frames=F, palettes=P, ticks=T_, starts=A); print('saved', F.shape)
