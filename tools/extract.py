"""Extract the 58 files embedded in CD2.EXE.
Layout (reverse-engineered from the demo's own opener at image 0x2FAF2):
  EOF-4 : dword, start of overlay (0x135A9)       EOF-6 : word count (XOR 0x55) = 58
  directory = count * 21 bytes ending at EOF-6, XOR 0x55: [len][name[12]][dword offset][dword size]
  file i is at  EOF - offset  (size bytes); plain[j] = ((raw[j] ^ 0x5A) + 21*(j//64)) & 255, j = offset in file.
Usage: python3 tools/extract.py OUTDIR
"""
import struct, sys, os
d = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'CD2.EXE'), 'rb').read()
EOF = len(d)
x = lambda b, k: bytes(c ^ k for c in b)
n = struct.unpack('<H', x(d[-6:-4], 0x55))[0]
base = EOF - 6 - n * 21
out = sys.argv[1] if len(sys.argv) > 1 else 'extracted'
os.makedirs(out, exist_ok=True)
for i in range(n):
    e = x(d[base + i*21: base + i*21 + 21], 0x55)
    name = e[1:1+e[0]].decode('latin1')
    off, size = struct.unpack('<II', e[13:21])
    raw = d[EOF - off: EOF - off + size]
    data = bytes(((c ^ 0x5A) + 21 * (j >> 6)) & 255 for j, c in enumerate(raw))
    open(os.path.join(out, name), 'wb').write(data)
    print(f'{name:14} {size:7}  {data[:8].hex(" ")}  {data[:4]!r}')
