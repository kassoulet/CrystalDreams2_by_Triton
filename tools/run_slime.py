"""Run the demo's Vectorslime scene (image 0x248b, CS=1240h) under Unicorn and record each frame (screen page + DAC palette).
Stubs: Borland heap, the CPU-alias call, DOS INT 21h file I/O on CD2.EXE (the demo reads its own archive), the vsync/frame call (0x3d0d:3433), the music tick."""
import struct, os, sys, collections
import numpy as np
from unicorn import *
from unicorn.x86_const import *
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from run_cube import IMG, BASE, DS, lin, Cube
SS = 0x5E20; SCREEN = 0x30    # stack 5E20:0..3FFF; the demo's video selector 30h is hard-coded in the scene, so the screen is real-mode segment 30h (the 64 KB clear overwrites image bytes 0..2FFh: start-up code, unused here); heap 6300h..FFFFh
CS = 0x1240
EXE = os.path.join(HERE, '..', 'CD2.EXE')
def cso(o): return o - (CS - 0x1000) * 16

class Slime(Cube):
    def __init__(self):
        self.mu = mu = Uc(UC_ARCH_X86, UC_MODE_16)
        mu.mem_map(0, 0x400000); mu.mem_write(BASE, IMG)
        self.shrink64k = True; self.heap = 0x6300; self.calls = collections.Counter(); self.flip_hit = False
        self.exe = open(os.path.join(HERE, '..', 'CD2.EXE'), 'rb'); self.handles = {}; self.next_h = 5
        self.log = []
        for (seg, ip), fn in (((0x3d0d, 0x1631), self._getmem), ((0x3d0d, 0x14df), self._freemem), ((0x3d0d, 0x17c7), self._memavail),
                              ((0x3d0d, 0x3475), self._flip), ((0x3d0d, 0x3433), self._frame), ((0x3d0d, 0xaa0), self._alias), ((0x3d0d, 0x22c2), self._rterr), ((0x3d0d, 0x20bf), self._dos)):
            a = lin(seg, ip); mu.hook_add(UC_HOOK_CODE, (lambda f: lambda m, ad, sz, u: f(m))(fn), None, a, a)
    def alloc(self, nbytes):
        if nbytes >= 0xFFF0 and self.shrink64k: nbytes = 0x6000            # the 64 KB I/O block of the file layer: only a part is ever used, and the heap is tight (1 MB real mode)
        seg = self.heap; self.heap += (nbytes + 15) // 16 + 1
        assert self.heap <= 0x10000, 'heap exhausted'
        return seg
    def _flip(self, mu): self._ret_far(mu, 2)
    def _alias(self, mu):                                              # CodeAlias(seg, var alias: word): real mode needs no alias
        poff, pseg, seg = self._args(mu, 3); self.w16(pseg, poff, seg); self._ret_far(mu, 6)
    def _rterr(self, mu):
        sp = mu.reg_read(UC_X86_REG_SP); ss = mu.reg_read(UC_X86_REG_SS); ip, cs = struct.unpack('<HH', bytes(mu.mem_read(lin(ss, sp), 4)))
        raise RuntimeError('RTL error %d called from image %#x' % (self._args(mu, 1)[0], lin(cs, ip) - BASE))
    def _frame(self, mu): self.flip_hit = True; self._ret_far(mu, 0)
    def _dos(self, mu):                                                # Intr(intno, var regs: TRegisters) of the RTL: do the DOS call on host files
        regs, rseg, intno = self._args(mu, 3)
        R = lambda i: self.r16(rseg, regs + 2 * i)
        W = lambda i, v: self.w16(rseg, regs + 2 * i, v)
        ax, bx, cx, dx, ds = R(0), R(1), R(2), R(3), R(7); ah = ax >> 8; al = ax & 255
        carry = 0
        if intno != 0x21: raise RuntimeError('int %#x' % intno)
        if ah == 0x3D:
            name = bytes(mu.mem_read(lin(ds, dx), 80)).split(b'\0')[0].decode('latin1'); self.log.append(('open', name))
            h = self.next_h; self.next_h += 1; self.handles[h] = [open(EXE, 'rb'), 0]; W(0, h)     # every open is the archive (CD2.EXE)
        elif ah == 0x3E: self.handles.pop(bx, None)
        elif ah == 0x3F:
            f = self.handles[bx][0]; data = f.read(cx); mu.mem_write(lin(ds, dx), data); W(0, len(data))
        elif ah == 0x42:
            f = self.handles[bx][0]; off = (cx << 16) | dx
            if off >= 0x80000000: off -= 0x100000000
            pos = f.seek(off, al); W(0, pos & 0xFFFF); W(3, pos >> 16)
        else: raise RuntimeError('int21 ah=%02x' % ah)
        W(9, (R(9) & ~1) | carry)
        self._ret_far(mu, 6)

def init_files(c, bufsize=0x200):
    """what the program start-up gives the file layer: a DOS-visible buffer for names, and the archive's FileRec (name at +0x30)"""
    buf = c.alloc(bufsize)                    # must hold the largest single read (the tunnel world reads 6464 bytes at once)
    c.mu.mem_write(DS * 16 + 0xebe4, struct.pack('<HHHH', 0, buf, 0, buf))
    c.mu.mem_write(DS * 16 + 0xec36, bytes([0x80]) + bytes(0x2f) + b'CD2.EXE\0')
    c.set_ds16(0x6654, 0)

def call(c, ip, limit=500_000_000, stop=None, cs=None):
    mu = c.mu; sp = 0xA000
    for w in (0x1000, 0xBEEF): sp -= 2; c.w16(SS, sp, w)
    mu.reg_write(UC_X86_REG_SS, SS); mu.reg_write(UC_X86_REG_SP, sp); mu.reg_write(UC_X86_REG_BP, 0xFF00); mu.reg_write(UC_X86_REG_DS, DS); mu.reg_write(UC_X86_REG_ES, DS)
    pos = (cs or CS, ip)
    while True:                                                          # a retrace wait (frame hook) ends run_until early: resume until the procedure returns
        c.run_until(pos[0], pos[1], 0x1000, 0xBEEF, count=limit)
        if c._stopped: break
        pos = c._resume

def prepare():
    c = Slime(); init_files(c); mu = c.mu
    import run_title                                          # global font (Nice-f16.LBM: extract it with extract.py, point CD2_FONT at it) as 4 planes x 8000 bytes at DS:CED8; DS:CED4 = the text routine's code alias
    fseg = c.alloc(32000); mu.mem_write(lin(fseg, 0), run_title.font_planes(open(os.environ['CD2_FONT'], 'rb').read()))
    c.set_ds16(0xced8, fseg); c.set_ds16(0xced4, 0x2598)
    mu.mem_write(DS * 16 + 0xee00, bytes(768)); c.set_ds16(0x6ff4, SCREEN); c.set_ds16(0x6670, 1); c.set_ds16(0x6674, 0xFFFF)
    return c

def record(nframes, tick_hz=50.0, fps=70.0, per_frame_limit=200_000_000):
    c = prepare(); mu = c.mu
    call_args = dict(limit=per_frame_limit)
    call(c, 0x34c7, cs=0x2612)                               # vector-engine unit init: object buffers, Sintab.raw
    call(c, 0x911)                                           # loader: code alias, random table, shd_cube.tvo
    sp = 0xA000
    for w in (0x1000, 0xBEEF): sp -= 2; c.w16(SS, sp, w)
    mu.reg_write(UC_X86_REG_SS, SS); mu.reg_write(UC_X86_REG_SP, sp); mu.reg_write(UC_X86_REG_BP, 0xFF00); mu.reg_write(UC_X86_REG_DS, DS); mu.reg_write(UC_X86_REG_ES, DS)
    F = []; P = []; T = []; pos = (CS, 0x85c); f0 = [None]
    mark = lin(CS, 0x479)                                    # first instruction after "mov [667e],0": the tick counter restarts here
    mu.hook_add(UC_HOOK_CODE, lambda m, a, s, u: f0.__setitem__(0, len(F)) if f0[0] is None else None, None, mark, mark)
    for f in range(nframes):
        c.set_ds16(0x667e, 0 if f0[0] is None else int((f - f0[0]) * tick_hz / fps))
        try: c.run_until(pos[0], pos[1], 0x1000, 0xBEEF, count=per_frame_limit)
        except Exception as e: print('frame', f, 'stopped:', repr(e)[:120]); break
        if not c.flip_hit: print('frame', f, 'scene returned'); break
        pos = c._resume
        F.append(np.frombuffer(bytes(mu.mem_read(lin(SCREEN, 0), 64000)), np.uint8).copy()); P.append(np.frombuffer(bytes(mu.mem_read(DS * 16 + 0xee00, 768)), np.uint8).copy()); T.append(c.ds16(0x667e))
        if f % 50 == 0: print('frame', f, 'tick', T[-1], flush=True)
    return np.array(F).reshape(-1, 200, 320), np.array(P).reshape(-1, 256, 3), np.array(T)

if __name__ == '__main__':
    F, P, T = record(int(sys.argv[2]) if len(sys.argv) > 2 else 1200)
    np.savez_compressed(sys.argv[1], frames=F, palettes=P, ticks=T); print('saved', F.shape)
