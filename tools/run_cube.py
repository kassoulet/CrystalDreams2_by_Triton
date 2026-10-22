"""Run the demo's cube / "spacecut" scene loop (image 0xB41D) under Unicorn and record each frame at the page flip.
Stubs: GetMem/FreeMem/MemAvail (Borland heap), the VGA status port, the music tick counter, the page flip (frame boundary)."""
import struct, os, sys, collections
import numpy as np
from unicorn import *
from unicorn.x86_const import *
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = open(os.path.join(HERE, 'img.bin'), 'rb').read()
BASE = 0x10000                     # image loaded at segment 1000h
DS = 0x42d2
SS = 0x9000
def lin(seg, off): return (seg << 4) + off
def img_to_lin(o): return BASE + o


class VGA:
    """Minimal planar VGA: map mask, graphics controller registers 0-8, write modes 0-3, latches, 4 planes x 64 KB."""
    def __init__(self):
        self.planes = [bytearray(0x10000) for _ in range(4)]
        self.seq = [0]*8; self.seq[2] = 0x0F
        self.gc = [0]*9; self.gc[8] = 0xFF
        self.latch = [0]*4
        self.seq_idx = 0; self.gc_idx = 0
        self.log_writes = 0
    def out(self, port, size, val):
        if port == 0x3c4:
            if size == 2: self.seq_idx = val & 0xFF; self.seq[self.seq_idx & 7] = (val >> 8) & 0xFF
            else: self.seq_idx = val & 0xFF
        elif port == 0x3c5: self.seq[self.seq_idx & 7] = val & 0xFF
        elif port == 0x3ce:
            if size == 2: self.gc_idx = val & 0xFF; self.gc[self.gc_idx % 9] = (val >> 8) & 0xFF
            else: self.gc_idx = val & 0xFF
        elif port == 0x3cf: self.gc[self.gc_idx % 9] = val & 0xFF
    def read(self, off):
        off &= 0xFFFF
        for p in range(4): self.latch[p] = self.planes[p][off]
        if self.gc[5] & 8:                                           # read mode 1: colour compare (reg 2) on the planes enabled in reg 7
            cc, care, r = self.gc[2] & 15, self.gc[7] & 15, 0xFF
            for p in range(4):
                if (care >> p) & 1: r &= ~(self.planes[p][off] ^ (0xFF if (cc >> p) & 1 else 0)) & 0xFF
            return r
        return self.planes[self.gc[4] & 3][off]
    def write(self, off, b):
        off &= 0xFFFF
        gc = self.gc; mode = gc[5] & 3; func = (gc[3] >> 3) & 3; rot = gc[3] & 7; bm = gc[8]
        mm = self.seq[2] & 0xF
        b &= 0xFF
        if rot: b = ((b >> rot) | (b << (8 - rot))) & 0xFF
        for p in range(4):
            if not (mm >> p) & 1: continue
            lat = self.latch[p]
            if mode == 0:
                d = (0xFF if (gc[0] >> p) & 1 else 0) if (gc[1] >> p) & 1 else b
            elif mode == 1:
                self.planes[p][off] = lat; continue
            elif mode == 2:
                d = 0xFF if (b >> p) & 1 else 0
            else:                                                   # mode 3: set/reset colour, CPU data (rotated) ANDed with the bit mask
                d = 0xFF if (gc[0] >> p) & 1 else 0
                m = b & bm
                r = d if func == 0 else (d & lat if func == 1 else (d | lat if func == 2 else d ^ lat))
                self.planes[p][off] = (r & m) | (lat & ~m & 0xFF); continue
            r = d if func == 0 else (d & lat if func == 1 else (d | lat if func == 2 else d ^ lat))
            self.planes[p][off] = (r & bm) | (lat & ~bm & 0xFF)
    def image(self, start, pitch=40, w=320, h=200):
        out = np.zeros((h, w), np.uint8)
        xs = np.arange(w)
        pl = [np.frombuffer(bytes(self.planes[p]), dtype=np.uint8) for p in range(4)]
        for y in range(h):
            base = start + y*pitch
            row = np.zeros(w, np.uint8)
            for p in range(4):
                bytes_ = pl[p][(base + (xs >> 3)) & 0xFFFF]
                row |= (((bytes_ >> (7 - (xs & 7))) & 1) << p).astype(np.uint8)
            out[y] = row
        return out

class Cube:
    def __init__(self):
        self.mu = mu = Uc(UC_ARCH_X86, UC_MODE_16)
        mu.mem_map(0, 0x400000)
        mu.mem_write(BASE, IMG)
        self.heap = 0x20000 * 0 + 0xA000     # next free segment for GetMem (paragraphs), above the image (image ends ~0x5E1)
        self.heap = 0x6000
        self.calls = collections.Counter()
        self.vga_toggle = 0
        self.frames = []
        self.flip_hit = False
        self.trace_calls = False
        self.vga = VGA()
        mu.hook_add(UC_HOOK_INSN, self._in, None, 1, 0, UC_X86_INS_IN)
        mu.hook_add(UC_HOOK_INSN, self._out, None, 1, 0, UC_X86_INS_OUT)
        mu.hook_add(UC_HOOK_MEM_WRITE, self._vw, None, 0xA0000, 0xAFFFF)
        mu.hook_add(UC_HOOK_MEM_READ, self._vr, None, 0xA0000, 0xAFFFF)
        # stubs are hooked at the callee's entry address only (a hook on every instruction would be ~100x slower)
        for (seg, ip), fn in (((0x3d0d, 0x1631), self._getmem), ((0x3d0d, 0x14df), self._freemem), ((0x3d0d, 0x17c7), self._memavail), ((0x3d0d, 0x3475), self._flip)):
            a = lin(seg, ip); mu.hook_add(UC_HOOK_CODE, (lambda f: lambda m, ad, sz, u: f(m))(fn), None, a, a)
    # ---------------- helpers
    def r16(self, seg, off): return struct.unpack('<H', bytes(self.mu.mem_read(lin(seg, off), 2)))[0]
    def w16(self, seg, off, v): self.mu.mem_write(lin(seg, off), struct.pack('<H', v & 0xFFFF))
    def ds16(self, off): return self.r16(DS, off)
    def set_ds16(self, off, v): self.w16(DS, off, v)
    def alloc(self, nbytes):
        seg = self.heap; self.heap += (nbytes + 15) // 16 + 1
        assert self.heap < 0xF000
        return seg
    # ---------------- hooks
    def _in(self, mu, port, size, ud):
        if port == 0x3da:
            self.vga_toggle ^= 1; return 0x09 if self.vga_toggle else 0x00       # alternate retrace / display bits
        return 0
    def _out(self, mu, port, size, val, ud):
        self.vga.out(port, size, val)
    def _vw(self, mu, access, addr, size, val, ud):
        for k in range(size): self.vga.write(addr - 0xA0000 + k, (val >> (8*k)) & 0xFF)
    def _vr(self, mu, access, addr, size, val, ud):
        b = self.vga.read(addr - 0xA0000)                       # loads latches
        mu.mem_write(addr, bytes([b]))
    def _ret_far(self, mu, nargs_bytes):
        """emulate RETF n: pop ip, cs, drop the callee-cleaned arguments"""
        sp = mu.reg_read(UC_X86_REG_SP); ss = mu.reg_read(UC_X86_REG_SS)
        ip, cs = struct.unpack('<HH', bytes(mu.mem_read(lin(ss, sp), 4)))
        mu.reg_write(UC_X86_REG_SP, (sp + 4 + nargs_bytes) & 0xFFFF)
        self._resume = (cs, ip); self._restart = True; mu.emu_stop()
    def _args(self, mu, n):
        sp = mu.reg_read(UC_X86_REG_SP); ss = mu.reg_read(UC_X86_REG_SS)
        return struct.unpack('<%dH' % n, bytes(mu.mem_read(lin(ss, sp + 4), 2 * n)))
    def _getmem(self, mu):
        size_lo, size_hi, poff, pseg = self._args(mu, 4)
        seg = self.alloc((size_hi << 16 | size_lo) & 0xFFFFF)
        mu.mem_write(lin(pseg, poff), struct.pack('<HH', 0, seg))
        self._ret_far(mu, 8)
    def _freemem(self, mu): self._ret_far(mu, 4)
    def _memavail(self, mu):
        mu.reg_write(UC_X86_REG_AX, 0xFFFF); mu.reg_write(UC_X86_REG_DX, 0x0010); self._ret_far(mu, 0)
    def _flip(self, mu):
        self.flip_arg = self._args(mu, 1)[0]                         # display start address passed to the flip
        self.flip_hit = True
        self._ret_far(mu, 2)
    # ---------------- driving
    def run_until(self, cs, ip, stop_cs=None, stop_ip=None, count=200_000_000):
        """run from cs:ip until the flip hook fires (frame) or stop address reached"""
        mu = self.mu
        self._resume = (cs, ip)
        stop = lin(stop_cs, stop_ip) if stop_cs is not None else None
        h = None
        if stop is not None:
            h = mu.hook_add(UC_HOOK_CODE, lambda m, a, s, u: (setattr(self, '_stopped', True), m.emu_stop()) if a == stop else None, None, stop, stop)
        self._stopped = False; self.flip_hit = False; restarts = 0
        while True:
            c, i = self._resume
            mu.reg_write(UC_X86_REG_CS, c)
            self._restart = False
            try: mu.emu_start(lin(c, i), 0xFFFFF0, count=count)
            except UcError as e:
                print('UC error', e, 'at', hex(mu.reg_read(UC_X86_REG_CS)), hex(mu.reg_read(UC_X86_REG_IP))); raise
            if self._stopped or self.flip_hit: break
            if not self._restart:                                   # emulation ended without a stub asking for a restart: instruction cap hit
                cs_ = mu.reg_read(UC_X86_REG_CS); ip_ = mu.reg_read(UC_X86_REG_IP)
                raise TimeoutError('instruction cap at image offset %#x' % (lin(cs_, ip_) - BASE))
            restarts += 1
            if restarts > 20000: raise TimeoutError('too many stub restarts')
        if h is not None: mu.hook_del(h)

def call_far(c, seg, ip, limit=200_000_000, stop=None):
    """call a far procedure with no arguments and run it until it returns (or until `stop` = (cs, ip))"""
    mu = c.mu; sp = 0xFE00
    for w in (0x1000, 0xBEEF):
        sp -= 2; c.w16(SS, sp, w)
    mu.reg_write(UC_X86_REG_SS, SS); mu.reg_write(UC_X86_REG_SP, sp); mu.reg_write(UC_X86_REG_BP, 0xFF00); mu.reg_write(UC_X86_REG_DS, DS)
    if stop is None: stop = (0x1000, 0xBEEF)
    c.run_until(seg, ip, stop[0], stop[1], count=limit)

CS_SCENE = 0x19b2
def cso(img_off): return img_off - (CS_SCENE - 0x1000) * 16        # image offset -> offset inside the scene's code segment

def setup(c):
    mu = c.mu
    sin = open(os.path.join(HERE, '..', 'assets', 'orig', 'sintab.raw'), 'rb').read()
    sseg = c.alloc(len(sin)); mu.mem_write(lin(sseg, 0), sin)
    for k, off in enumerate((0xf110, 0xf114, 0xf118, 0xf11c)):         # sin23170, cos23170, sin32766, cos32766 (assumed order)
        mu.mem_write(DS * 16 + off, struct.pack('<HH', 2048 * k, sseg))
    p0, p1 = 0xA000, 0xA400                                        # two VRAM pages, 0x4000 bytes apart
    c.set_ds16(0xf100, p0); c.set_ds16(0xf104, p1)
    mu.reg_write(UC_X86_REG_SS, SS); mu.reg_write(UC_X86_REG_SP, 0xFE00); mu.reg_write(UC_X86_REG_BP, 0xFF00)   # SP below the scene's locals (enter 0xe)
    mu.reg_write(UC_X86_REG_DS, DS); mu.reg_write(UC_X86_REG_ES, DS); mu.reg_write(UC_X86_REG_FS, DS)
    c.w16(SS, 0xFF00 - 6, 0)                                            # [bp-6] page toggle
    pal = c.alloc(0x300); mu.mem_write(lin(SS, 0xFF00 - 0xe), struct.pack('<HH', 0, pal))   # [bp-0xe] far ptr
    call_far(c, 0x1f63, 0x1dad)                                         # engine unit init
    call_far(c, 0x21a1, 0x2848, stop=(0x21a1, 0x143a8 - 0x11a10))       # row-offset and pixel-mask tables; stop before the text/file calls at the end
    mu.reg_write(UC_X86_REG_SS, SS); mu.reg_write(UC_X86_REG_SP, 0xFE00); mu.reg_write(UC_X86_REG_BP, 0xFF00)   # SP below the scene's locals (enter 0xe)
    c.w16(SS, 0xFF00 - 6, 0); mu.mem_write(lin(SS, 0xFF00 - 0xe), struct.pack('<HH', 0, pal))
    return p0, p1

if __name__ == '__main__' and False:
    c = Cube(); p0, p1 = setup(c)
    c.trace_calls = True
    # a) prologue pieces: constants then the engine init call
    c.run_until(CS_SCENE, cso(0xb057), CS_SCENE, cso(0xb07d))
    print('after engine init: ok')
    c.run_until(CS_SCENE, cso(0xb3b7), CS_SCENE, cso(0xb41d))
    print('at loop start; ds[6670]=', c.ds16(0x6670))
    c.set_ds16(0x667e, 10)
    c.run_until(CS_SCENE, cso(0xb41d))
    print('frame produced; flip hit', c.flip_hit)
    for k, v in c.calls.most_common(25): print(v, k)


def record(nframes, tick_hz=50.0, fps=70.0, progress=None, save=None, per_frame_limit=30_000_000):
    """Run the scene and return (frames[n,200,320] uint8 colour indices, palettes[n,16,3] 6-bit DAC, ticks[n], flip_args[n])."""
    c = Cube(); setup(c)
    c.run_until(CS_SCENE, cso(0xb057), CS_SCENE, cso(0xb07d))
    c.run_until(CS_SCENE, cso(0xb3b7), CS_SCENE, cso(0xb41d))
    F = np.zeros((nframes, 200, 320), np.uint8); P = np.zeros((nframes, 16, 3), np.uint8); T = np.zeros(nframes, np.int32); A = np.zeros(nframes, np.int32)
    ip = cso(0xb41d); done = 0
    for f in range(nframes):
        tick = int(f * tick_hz / fps); T[f] = tick
        c.set_ds16(0x667e, tick)
        try:
            c.run_until(CS_SCENE, ip, count=per_frame_limit)
        except Exception as e:
            print('frame', f, 'tick', tick, 'stopped:', e, flush=True); break
        if not c.flip_hit:
            cs = c.mu.reg_read(UC_X86_REG_CS); ipp = c.mu.reg_read(UC_X86_REG_IP)
            print('frame', f, 'tick', tick, 'no flip within limit; at', hex(lin(cs, ipp) - BASE), flush=True); break
        ip = c._resume[1]; done = f + 1
        A[f] = c.flip_arg
        F[f] = c.vga.image(c.flip_arg)
        P[f] = np.frombuffer(bytes(c.mu.mem_read(DS*16 + 0xee00, 48)), np.uint8).reshape(16, 3)
        if progress and f % 100 == 0: progress(f, tick)
        if save and f % 400 == 399: np.savez_compressed(save, frames=F[:done], palettes=P[:done], ticks=T[:done], flip_args=A[:done])
    return F[:done], P[:done], T[:done], A[:done]

if __name__ == '__main__':
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 2400
    F, P, T, A = record(n, progress=lambda f, t: print('frame', f, 'tick', t, flush=True), save=sys.argv[1])
    np.savez_compressed(sys.argv[1], frames=F, palettes=P, ticks=T, flip_args=A)
    print('saved', sys.argv[1], F.shape)
