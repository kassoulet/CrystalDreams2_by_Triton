// Smoke test for js/modplayer.js: node tools/test_mod.js
const fs = require('fs'), path = require('path');
const { renderMod } = require('../js/modplayer.js');
for (const f of ['Declogue', 'AmbPower', 'Desert-D', 'TrnsAtln']) {
  const b = fs.readFileSync(path.join(__dirname, '..', 'assets', 'orig', f + '.mod'));
  const t0 = Date.now();
  const r = renderMod(b.buffer.slice(b.byteOffset, b.byteOffset + b.length), 22050);
  let e = 0, pk = 0; for (let i = 0; i < r.left.length; i++) { e += r.left[i] * r.left[i]; pk = Math.max(pk, Math.abs(r.left[i])); }
  console.log(f.padEnd(9), JSON.stringify(r.title), r.channels + 'ch', r.seconds.toFixed(1) + 's', 'rms', Math.sqrt(e / r.left.length).toFixed(3), 'peak', pk.toFixed(2), (Date.now() - t0) + 'ms');
  if (!(r.seconds > 20 && e > 0)) { console.error('FAIL', f); process.exitCode = 1; }
}
