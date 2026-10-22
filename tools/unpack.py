"""Run CD2.EXE's own real-mode unpacker under Unicorn and dump the unpacked image to tools/img.bin.
Usage: pip install unicorn; python3 tools/unpack.py
"""
import struct,sys
from unicorn import *
from unicorn.x86_const import *
import os
HERE=os.path.dirname(os.path.abspath(__file__))
d=open(os.path.join(HERE,'..','CD2.EXE'),'rb').read()
mod=d[0x60:0x60+79177]
L=0x1000
mu=Uc(UC_ARCH_X86,UC_MODE_16); mu.mem_map(0,0x100000+0x10000)
mu.mem_write(L*16,mod)
w=struct.unpack('<H',mod[7:9])[0]; mu.mem_write(L*16+7,struct.pack('<H',(w+L)&0xffff))
mu.mem_write((L-16)*16+2,struct.pack('<H',0xA000))
for r,v in ((UC_X86_REG_DS,L-16),(UC_X86_REG_ES,L-16),(UC_X86_REG_SS,L+0x135B),(UC_X86_REG_SP,0x200),(UC_X86_REG_CS,L-16)): mu.reg_write(r,v)
ev=[]
def hk(mu,a,sz,u):
    b=mu.mem_read(a,1)[0]
    if b==0xCB:
        ss=mu.reg_read(UC_X86_REG_SS)*16+mu.reg_read(UC_X86_REG_SP)
        ip,cs=struct.unpack('<HH',bytes(mu.mem_read(ss,4)))
        ev.append((hex(a),hex(cs),hex(ip)))
        if len(ev)>=2: mu.emu_stop()
mu.hook_add(UC_HOOK_CODE,hk)
try: mu.emu_start(((L-16)<<4)+0x100,0,count=200_000_000)
except UcError as e: print('err',e,hex(mu.reg_read(UC_X86_REG_CS)),hex(mu.reg_read(UC_X86_REG_IP)))
print(ev)
cs=mu.reg_read(UC_X86_REG_CS);print(hex(cs),hex(mu.reg_read(UC_X86_REG_IP)))
# unpacked image starts at linear 0x10000 (segment 1000h); entry = 1000:0151
open(os.path.join(HERE,'img.bin'),'wb').write(bytes(mu.mem_read(0x10000,0x4E100)))
