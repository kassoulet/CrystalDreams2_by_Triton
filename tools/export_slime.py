"""Pack the recorded Vectorslime frames (tools/run_slime.py output) into assets/orig/slime_frames.bin.
Layout: 'CD2S', u16 nframes, u16 frames_per_chunk, u16 nchunks, u32 offsets[nchunks+1];
each chunk = raw deflate of n x [768-byte DAC palette (6-bit) XOR previous frame's] + n x [64000-byte frame XOR previous frame's]
(each chunk starts from zeros, so it decodes alone).   Usage: export_slime.py frames.npz OUT.bin"""
import sys, struct, zlib
import numpy as np
d = np.load(sys.argv[1]); F = d['frames'].reshape(-1, 64000); P = d['palettes'].reshape(-1, 768); N = len(F); CH = 30
blobs = []
for c in range(0, N, CH):
    n = min(CH, N - c); pp = np.zeros(768, np.uint8); fp = np.zeros(64000, np.uint8); body = bytearray()
    for i in range(n): body += (P[c+i] ^ pp).tobytes(); pp = P[c+i]
    for i in range(n): body += (F[c+i] ^ fp).tobytes(); fp = F[c+i]
    co = zlib.compressobj(9, zlib.DEFLATED, -15); blobs.append(co.compress(bytes(body)) + co.flush())
head = b'CD2S' + struct.pack('<HHH', N, CH, len(blobs)); off = len(head) + 4 * (len(blobs) + 1); offs = []
for b in blobs: offs.append(off); off += len(b)
offs.append(off)
open(sys.argv[2], 'wb').write(head + struct.pack('<%dI' % len(offs), *offs) + b''.join(blobs))
print('frames', N, 'chunks', len(blobs), 'bytes', off)
