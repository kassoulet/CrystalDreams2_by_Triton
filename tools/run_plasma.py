"""Run the demo's own plasma routines under Unicorn (real mode) and compare with the Python/JS port.
 table  : loop body at image 0x3BD1..0x3C35 (Borland Real: round(128 + 127*sin(2*pi*i/1024)))
 frame  : 0x3A82  (plasma renderer: 4-pixel blocks, two identical lines per row pair)
 palette: 0x3A10  (three sine waves, level-scaled)"""
import struct, os, sys, math
import numpy as np
from unicorn import *
from unicorn.x86_const import *
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = open(os.path.join(HERE, 'img.bin'), 'rb').read()
CS_SEG, DS_SEG = 0x13a1, 0x42d2          # unit code segment (image 0x3A10) and the data segment
TAB_SEG, ES_SEG, SS_SEG = 0x6000, 0x0000, 0x0C00

def new_machine():
    mu = Uc(UC_ARCH_X86, UC_MODE_16); mu.mem_map(0, 0x200000); mu.mem_write(0x10000, IMG)
    return mu

def build_table_emulated():
    """execute the original table loop for i in 0..1023"""
    mu = new_machine()
    mu.mem_write(DS_SEG*16 + 0x8b98, struct.pack('<HH', 0, TAB_SEG))            # far pointer to the table buffer
    mu.reg_write(UC_X86_REG_DS, DS_SEG); mu.reg_write(UC_X86_REG_SS, SS_SEG); mu.reg_write(UC_X86_REG_CS, 0x13a1)
    # the function frame: bp-2 = loop counter. Start at 0x3BD4 (after "inc [bp-2]") with bp-2 = 0 and run until the loop exits at 0x3C3C.
    bp = 0x2000; sp = 0x1F00
    mu.reg_write(UC_X86_REG_BP, bp); mu.reg_write(UC_X86_REG_SP, sp)
    mu.mem_write(SS_SEG*16 + bp - 2, struct.pack('<H', 0))
    base = 0x13a1 * 16
    mu.hook_add(UC_HOOK_CODE, lambda m, a, s, u: m.emu_stop(), None, base + (0x3c3c - 0x3a10), base + (0x3c3c - 0x3a10))
    mu.emu_start(base + (0x3bd4 - 0x3a10), 0, count=50_000_000)
    return np.frombuffer(bytes(mu.mem_read(TAB_SEG*16, 1024)), dtype=np.uint8).copy()

def table_float():
    return np.array([int(round(128 + 127*math.sin(2*math.pi*i/1024))) for i in range(1024)], dtype=np.uint8)

def machine_with_table(T):
    mu = new_machine()
    rows = np.tile(T, 63)
    mu.mem_write(TAB_SEG*16, rows.tobytes())
    mu.mem_write(DS_SEG*16 + 0x8b96, struct.pack('<H', CS_SEG))                  # code alias segment (self-patching)
    mu.mem_write(DS_SEG*16 + 0x8b98, struct.pack('<HH', 0, TAB_SEG))
    mu.mem_write(DS_SEG*16 + 0x8b9a, struct.pack('<H', TAB_SEG))
    return mu

def call(mu, ip, args, count=50_000_000):
    sp = 0x1E00
    for w in list(args) + [0xBEEF]:
        sp -= 2; mu.mem_write(SS_SEG*16 + sp, struct.pack('<H', w & 0xFFFF))
    mu.reg_write(UC_X86_REG_SS, SS_SEG); mu.reg_write(UC_X86_REG_SP, sp)
    mu.reg_write(UC_X86_REG_CS, CS_SEG); mu.reg_write(UC_X86_REG_DS, DS_SEG); mu.reg_write(UC_X86_REG_FS, DS_SEG)
    stop = CS_SEG*16 + 0xBEEF
    h = mu.hook_add(UC_HOOK_CODE, lambda m, a, s, u: m.emu_stop(), None, stop, stop)
    mu.emu_start(CS_SEG*16 + ip, stop + 1, count=count)
    mu.hook_del(h)

def plasma_frame_emulated(mu, p1, p2, p3, p4, step=7):
    mu.mem_write(ES_SEG*16, bytes(0x8000 + 0x200))
    call(mu, 0x3a82 - 0x3a10, [p1, p2, p3, p4, ES_SEG, step])                   # push p1,p2,p3,p4,page,step ; near ret
    mem = bytes(mu.mem_read(ES_SEG*16, 200*160))
    return np.array([[mem[160*L + b] for b in range(80)] for L in range(200)], dtype=np.uint8)   # 200 lines x 80 bytes

def plasma_frame_port(T, p1, p3, p4):
    r = np.arange(100)[:, None]; xb = np.arange(80)[None, :]
    v = (T[(p1 + 2*r + 7*xb) & 1023].astype(int) + T[(p3 - 3*r) & 1023] + T[(p4 - r) & 1023]) & 255
    return np.repeat(v, 2, axis=0).astype(np.uint8)                              # two identical lines per row pair

def palette_emulated(mu, pr, pg, pb, level):
    call(mu, 0, [pr, pg, pb, 0x100, level])                                      # push R-phase, G-phase, B-phase, count, level
    return np.frombuffer(bytes(mu.mem_read(DS_SEG*16 + 0xee00, 768)), dtype=np.uint8).reshape(256, 3).copy()

def palette_port(T, pr, pg, pb, level):
    i = np.arange(256)
    out = np.stack([((T[(p + 4*i) & 1023].astype(int) * level) & 0xFFFF) >> 10 for p in (pr, pg, pb)], 1)
    return out.astype(np.uint8)

if __name__ == '__main__':
    Te = build_table_emulated(); Tf = table_float()
    print('table: emulated vs float64 formula, mismatching entries =', int((Te != Tf).sum()))
    rng = np.random.default_rng(1); bad = 0
    mu = machine_with_table(Te)
    for k in range(12):
        p1, p2, p3, p4 = [int(x) for x in rng.integers(0, 1024, 4)]
        e = plasma_frame_emulated(mu, p1, p2, p3, p4); m = plasma_frame_port(Te, p1, p3, p4)
        bad += int((e[:, :] != m).sum())
    print('frame: mismatching bytes over 12 random phase sets =', bad)
    bad = 0
    for k in range(12):
        pr, pg, pb = [int(x) for x in rng.integers(0, 1024, 3)]; lvl = int(rng.choice([2, 10, 85, 170, 256]))
        bad += int((palette_emulated(machine_with_table(Te), pr, pg, pb, lvl) != palette_port(Te, pr, pg, pb, lvl)).sum())
    print('palette: mismatching components over 12 random cases =', bad)
