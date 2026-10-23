"""Run the demo's tunnel-flight scene (image 0xBA92, CS=1B7Ah, "Virtual Reality") under Unicorn and record each frame.
Mode 2 is unchained 320x200 (planes interleaved, 80 bytes per row), two pages 0x4000 apart.  Builds on run_slime.py (file layer, heap, palette)
and run_cube.py (VGA model).  The scene's video selectors 30h/40h are patched to the VGA segments A000h/A400h."""
import sys, os, struct
import numpy as np
from unicorn import *
from unicorn.x86_const import *
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_slime as S
from run_slime import lin, DS, SS, BASE, IMG
from run_cube import VGA
CS = 0x1b7a
P0, P1 = 0xA000, 0xA400

class Tunnel(S.Slime):
    def __init__(self):
        super().__init__()
        self.heap = 0x6E30                                    # the engine addresses its tables as SS:xxxx (SS = DS in the original): keep the whole 64 KB window of SS (5E20h..6E1Fh) out of the heap
        self.vga = VGA(); self.vga_toggle = 0; mu = self.mu
        mu.hook_add(UC_HOOK_INSN, self._in, None, 1, 0, UC_X86_INS_IN)
        mu.hook_add(UC_HOOK_INSN, self._out, None, 1, 0, UC_X86_INS_OUT)
        mu.hook_add(UC_HOOK_MEM_WRITE, self._vw, None, 0xA0000, 0xAFFFF)
        mu.hook_add(UC_HOOK_MEM_READ, self._vr, None, 0xA0000, 0xAFFFF)
        for o, a, b in ((0xbadd + 1, 0x30, P0), (0xbaf7 + 1, 0x40, P1), (0xbc71 + 1, 0x30, P0)):          # mov ax,sel
            assert IMG[o - 1] == 0xB8 and IMG[o] == a; mu.mem_write(BASE + o, struct.pack('<H', b))
        ad = lin(0x2598, 0x409)                                                                             # text routine: its destination argument is the selector 30h (a 2-byte push, so it is fixed on entry)
        mu.hook_add(UC_HOOK_CODE, lambda m, a_, sz, u: self._fix_text_dest(), None, ad, ad)
        o = 0xbc8a; assert IMG[o:o + 2] == b'\xc7\x06'; mu.mem_write(BASE + o + 4, struct.pack('<H', P0))   # mov [5f92],30h
    def _fix_text_dest(self):
        mu = self.mu; sp = mu.reg_read(UC_X86_REG_SP); ss = mu.reg_read(UC_X86_REG_SS)
        if self.r16(ss, sp + 0xe) == 0x30: self.w16(ss, sp + 0xe, P0)
    def _frame(self, mu): self.flip_hit = True; self.flip_arg = None; self._ret_far(mu, 0)
    def _flip(self, mu): self.flip_hit = True; self.flip_arg = self._args(mu, 1)[0]; self._ret_far(mu, 2)

def image_x(vga, start):
    out = np.zeros((200, 320), np.uint8)
    for p in range(4):
        pl = np.frombuffer(bytes(vga.planes[p]), np.uint8)
        for y in range(200): out[y, p::4] = pl[(start + y * 80 + np.arange(80)) & 0xFFFF]
    return out


def record(nframes, tick_hz=50.0, fps=70.0, per_frame_limit=200_000_000):
    c = Tunnel(); mu = c.mu; c.shrink64k = False
    import run_title
    fseg = c.alloc(32000); mu.mem_write(lin(fseg, 0), run_title.font_planes(open(os.environ['CD2_FONT'], 'rb').read()))
    c.set_ds16(0xced8, fseg); c.set_ds16(0xced4, 0x2598)
    c.set_ds16(0xf100, P0); c.set_ds16(0xf104, P1)                      # page selectors
    S.init_files(c, 0x4100); mu.mem_write(DS * 16 + 0xee00, bytes(768)); c.set_ds16(0x6ff4, P0); c.set_ds16(0x6670, 1); c.set_ds16(0x6674, 0xFFFF)
    for seg, off in ((0x296a, 0xc82b), (0x2612, 0x3577), (0x2598, 0x798), (0x21a1, 0x29ab), (0x1f63, 0x1dad), (0x1e45, 0x11d5), (0x1df6, 0x4ea), (0x1de3, 0x11f),
                     (0x1bee, 0x1f4a), (0x1b7a, 0x733), (0x19b2, 0x1c72), (0x18e1, 0xd08)):      # the program's unit initialisations (entry 1000:0151), those that touch memory only
        S.call(c, off, cs=seg)
    S.call(c, 0x34c7, cs=0x2612)                                        # vector-engine init called by the main program before the scenes
    S.call(c, 0x6c7, cs=CS)                                             # world loader (nfly2.tvw)
    print('world at', hex(c.ds16(0x8bde)), 'log', c.log, flush=True)
    sp = 0xA000
    for w in (0x1000, 0xBEEF): sp -= 2; c.w16(SS, sp, w)
    mu.reg_write(UC_X86_REG_SS, SS); mu.reg_write(UC_X86_REG_SP, sp); mu.reg_write(UC_X86_REG_BP, 0xFF00); mu.reg_write(UC_X86_REG_DS, DS); mu.reg_write(UC_X86_REG_ES, DS)
    F = []; P = []; T = []; A = []; pos = (CS, 0x2f2); f0 = [None]
    mark = lin(CS, 0xbca9 - 0xb7a0)                                      # "mov [667e],0": the tick counter restarts for the flight
    mu.hook_add(UC_HOOK_CODE, lambda m, a, s, u: f0.__setitem__(0, len(F)) if f0[0] is None else None, None, mark + 5, mark + 5)
    for f in range(nframes):
        c.set_ds16(0x667e, 0 if f0[0] is None else int((f - f0[0]) * tick_hz / fps))
        try: c.run_until(pos[0], pos[1], 0x1000, 0xBEEF, count=per_frame_limit)
        except Exception as e: print('frame', f, 'stopped:', repr(e)[:120]); break
        if not c.flip_hit: print('frame', f, 'scene returned'); break
        pos = c._resume
        start = c.flip_arg if c.flip_arg is not None else (A[-1] if A else 0)
        A.append(start); F.append(image_x(c.vga, start)); P.append(np.frombuffer(bytes(mu.mem_read(DS * 16 + 0xee00, 768)), np.uint8).copy()); T.append(c.ds16(0x667e))
        if f % int(os.environ.get('PRINT_EVERY', 100)) == 0: print('frame', f, 'tick', T[-1], 'dist', c.ds16(0xcfd8), 'pos', hex(c._resume[1]), flush=True)
    return np.array(F), np.array(P).reshape(-1, 256, 3), np.array(T), np.array(A)

if __name__ == '__main__':
    F, P, T, A = record(int(sys.argv[2]) if len(sys.argv) > 2 else 6000)
    np.savez_compressed(sys.argv[1], frames=F, palettes=P, ticks=T, starts=A); print('saved', F.shape)
