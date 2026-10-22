"""Pack the recorded cube-scene frames (tools/run_cube.py output) into assets/orig/cube_frames.bin.
Layout: 'CD2C', u16 nframes, u16 frames_per_chunk, u16 nchunks, u32 offsets[nchunks+1];
each chunk = raw deflate of [palettes: n x 48 bytes (16 x RGB, 6-bit DAC)] + [frame0: 32000 bytes, two 4-bit pixels per byte]
+ [frames 1..n-1: XOR with the previous frame].   Usage: export_cube.py frames.npz OUT.bin"""
import sys, struct, zlib
import numpy as np
d = np.load(sys.argv[1]); F = d['frames']; P = d['palettes']; N = len(F); CH = 35
def pack(f): a = f.reshape(-1); return ((a[0::2] << 4) | a[1::2]).astype(np.uint8)
blobs = []
for c in range(0, N, CH):
    n = min(CH, N - c); body = bytearray(P[c:c+n].tobytes())
    prev = None
    for i in range(n):
        cur = pack(F[c+i]); body += (cur if prev is None else cur ^ prev).tobytes(); prev = cur
    co = zlib.compressobj(9, zlib.DEFLATED, -15); blobs.append(co.compress(bytes(body)) + co.flush())
head = b'CD2C' + struct.pack('<HHH', N, CH, len(blobs)); off = len(head) + 4 * (len(blobs) + 1); offs = []
for b in blobs: offs.append(off); off += len(b)
offs.append(off)
open(sys.argv[2], 'wb').write(head + struct.pack('<%dI' % len(offs), *offs) + b''.join(blobs))
print('frames', N, 'chunks', len(blobs), 'bytes', off)
