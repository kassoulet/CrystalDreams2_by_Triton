"""Run the demo's own fractal-zoom column scaler (image offset 0x7FB1) under Unicorn and capture the Mode X frame.
Inputs: tools/img.bin (unpacked image) and the extracted MegaFrac.DAT.
 - tiles: first 8 x 64 KB of the file, mapped as segments; DS:8B9C holds their segment words
 - table: the last 16 KB of the file is read by the demo into segment 13FBh:0 (the per-column code-segment table)
 - column map: ss:table[8][128] words = round(i/8 + 68.1*ln((j+1)*2^24/500))  (the real-number loop at 0x89B1)
Usage: run_fractal.py MegaFrac.DAT OUT.npy [z ...]"""
import struct, sys, os, math
import numpy as np
from unicorn import *
from unicorn.x86_const import *
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = open(os.path.join(HERE, 'img.bin'), 'rb').read()

def make_table():
    return b''.join(struct.pack('<H', int(round(i/8 + 68.1*math.log((j+1)*2**24/500))) & 0xFFFF) for i in range(8) for j in range(128))

class Fractal:
    SS, TBL, ES = 0x0C00, 0x2000, 0x0000
    def __init__(self, mega):
        self.mega = mega
        self.mu = mu = Uc(UC_ARCH_X86, UC_MODE_16)
        mu.mem_map(0, 0x200000)
        mu.mem_write(0x10000, IMG)
        for i in range(8): mu.mem_write(0x60000 + 0x10000*i, mega[i*65536:(i+1)*65536])
        mu.mem_write(0x13fb0, mega[8*65536:8*65536+16384])           # cs table
        ds = 0x42d2
        for i in range(9): mu.mem_write(ds*16 + 0x8b9c + i*4, struct.pack('<HH', 0, 0x6000 + 0x1000*i))
        mu.mem_write(self.SS*16 + self.TBL, make_table())
        self.plane = 0xF
        mu.hook_add(UC_HOOK_INSN, self._out, None, 1, 0, UC_X86_INS_OUT)
        mu.hook_add(UC_HOOK_MEM_WRITE, self._w, None, self.ES*16, self.ES*16 + 0xAFFF)
        self.writes = []
    def _out(self, mu, port, size, val, ud):
        if port == 0x3c4 and size == 2 and (val & 255) == 2: self.plane = (val >> 8) & 15
        elif port == 0x3c5 and size == 1: self.plane = val & 15
    def _w(self, mu, access, addr, size, val, ud):
        self.writes.append((addr - self.ES*16, size, val & ((1 << (8*size)) - 1), self.plane))
    def frame(self, z, count=20_000_000):
        mu = self.mu; self.writes = []
        for a in range(self.ES*16, self.ES*16 + 0xB000, 0x1000): mu.mem_write(a, bytes(0x1000))
        sp = 0x1E00
        ss = self.SS
        def push(w):
            nonlocal sp; sp -= 2; mu.mem_write(ss*16 + sp, struct.pack('<H', w))
        for w in (z & 0xFFFF, self.TBL, self.ES, 0x1234, 0xBEEF): push(w)      # z, table, ES, caller bp, return ip
        mu.reg_write(UC_X86_REG_SS, ss); mu.reg_write(UC_X86_REG_SP, sp)
        mu.reg_write(UC_X86_REG_CS, 0x13fb); mu.reg_write(UC_X86_REG_DS, 0x42d2)
        mu.reg_write(UC_X86_REG_ES, self.ES); mu.reg_write(UC_X86_REG_FS, 0x42d2)
        # stop when the near return lands on 0xBEEF (not valid code): hook code at that address
        stop = 0x13fb*16 + 0xBEEF
        h = mu.hook_add(UC_HOOK_CODE, lambda m, a, s, u: m.emu_stop() if a == stop else None, None, stop, stop)
        mu.reg_write(UC_X86_REG_IP, 0x7fb1 - 0x3fb0)
        try: mu.emu_start(0x13fb*16 + (0x7fb1 - 0x3fb0), stop + 1, count=count)
        except UcError as e: print('err', e, hex(mu.reg_read(UC_X86_REG_IP)))
        mu.hook_del(h)
        # rebuild Mode X page: byte offset off in plane p -> pixel x = 4*(off % pitch) + p ; pitch 80 bytes/row
        scr = np.zeros((400, 320), np.uint8)
        for off, size, val, plane in self.writes:
            for k in range(size):
                o = off + k; b = (val >> (8*k)) & 255
                y, xb = divmod(o, 80)
                for p in range(4):
                    if plane & (1 << p) and y < 400 and xb < 80: scr[y, 4*xb + p] = b
        return scr, len(self.writes)

if __name__ == '__main__':
    mega = open(sys.argv[1], 'rb').read()
    F = Fractal(mega)
    frames = []
    for z in map(int, sys.argv[3:]):
        scr, n = F.frame(z); frames.append(scr); print('z', z, 'writes', n, 'nonzero', int((scr > 0).sum()))
    np.save(sys.argv[2], np.array(frames))
