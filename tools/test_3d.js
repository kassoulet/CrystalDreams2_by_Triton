// node tools/test_3d.js OUTDIR : renders chess + earth frames to PPM files (no browser needed)
const fs = require('fs'), path = require('path');
require('../js/demo3d.js');
const T = globalThis.CD2_3D;
const objs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets/orig/objects.json')));
// emulate load()
for (const k in objs) { const o = objs[k]; T.models[k] = { n: o.v.length / 3, v: Float32Array.from(o.v), faces: o.f.map(f => ({ i: f.slice(0, -1), c: f[f.length - 1] })) }; }
const out = process.argv[2] || '.'; fs.mkdirSync(out, { recursive: true });
const W = 320, H = 200, r = new T.Renderer(W, H);
const tex = { w: 256, h: 200, data: new Uint32Array(256 * 200) };
for (let y = 0; y < 200; y++) for (let x = 0; x < 256; x++) tex.data[y * 256 + x] = T.rgba(60 + (x * 2) % 180, 90 + ((x >> 4) ^ (y >> 4)) % 2 * 100, 140);
function save(name) { const b = Buffer.alloc(W * H * 3); for (let i = 0; i < W * H; i++) { const c = r.buf[i]; b[i * 3] = c & 255; b[i * 3 + 1] = (c >> 8) & 255; b[i * 3 + 2] = (c >> 16) & 255; } fs.writeFileSync(path.join(out, name), Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), b])); }
const t0 = Date.now();
const mb = fs.readFileSync(process.argv[3]); const marble = { w: 320, h: 200, data: new Uint32Array(320 * 200) }; for (let i = 0; i < 64000; i++) marble.data[i] = T.rgba(mb[i * 3], mb[i * 3 + 1], mb[i * 3 + 2]);
for (const t of [0, 4, 9]) { if (!T.chessFrame(r, t, marble)) throw 'chess'; save(`chess_${t}.ppm`); }
const t1 = Date.now();
for (const t of [0, 3]) { if (!T.earthFrame(r, t, tex)) throw 'earth'; save(`earth_${t}.ppm`); }
console.log('chess ms/frame', ((t1 - t0) / 3).toFixed(0), 'earth ms/frame', ((Date.now() - t1) / 2).toFixed(0));
