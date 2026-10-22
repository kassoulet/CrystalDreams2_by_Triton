/* ProTracker / FastTracker-style MOD renderer (4 and 8 channels).
   renderMod(arrayBuffer, sampleRate) -> { left, right, seconds, title, channels }
   Pure and deterministic: the whole song is mixed offline into Float32Arrays, so the
   page can pause and seek with a plain AudioBufferSourceNode. Covers the effects the
   four CD2 modules use; exotic ones are ignored (see EFFECTS below). */
(function (root) {
  "use strict";

  const PERIODS = [856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
                   428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
                   214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113];
  const SINE = [0, 24, 49, 74, 97, 120, 141, 161, 180, 197, 212, 224, 235, 244, 250, 253,
                255, 253, 250, 244, 235, 224, 212, 197, 180, 161, 141, 120, 97, 74, 49, 24];
  const PAULA = 7093789.2 / 2;               // PAL Amiga: sample rate = PAULA / period

  function parse(buf) {
    const b = new Uint8Array(buf);
    const tag = String.fromCharCode(b[1080], b[1081], b[1082], b[1083]);
    let ch = 4;
    if (/^(\d)CHN$/.test(tag)) ch = +tag[0];
    else if (/^(\d\d)CH$/.test(tag)) ch = +tag.slice(0, 2);
    else if (tag !== "M.K." && tag !== "M!K!" && tag !== "FLT4") throw new Error("unsupported MOD tag " + tag);
    const title = String.fromCharCode.apply(null, b.subarray(0, 20)).replace(/\0.*$/, "");
    const samples = [];
    for (let i = 0; i < 31; i++) {
      const o = 20 + i * 30;
      samples.push({
        len: ((b[o + 22] << 8) | b[o + 23]) * 2,
        fine: (b[o + 24] & 15) > 7 ? (b[o + 24] & 15) - 16 : b[o + 24] & 15,
        vol: Math.min(64, b[o + 25]),
        loopStart: ((b[o + 26] << 8) | b[o + 27]) * 2,
        loopLen: ((b[o + 28] << 8) | b[o + 29]) * 2,
        data: null
      });
    }
    const songLen = b[950];
    const order = Array.from(b.subarray(952, 952 + 128));
    const nPat = Math.max.apply(null, order.slice(0, songLen)) + 1;
    const patBase = 1084, patSize = 64 * ch * 4;
    const patterns = [];
    for (let p = 0; p < nPat; p++) {
      const rows = [];
      for (let r = 0; r < 64; r++) {
        const row = [];
        for (let c = 0; c < ch; c++) {
          const o = patBase + p * patSize + (r * ch + c) * 4;
          const period = ((b[o] & 15) << 8) | b[o + 1];
          const sample = (b[o] & 0xf0) | (b[o + 2] >> 4);
          row.push({ period, sample, eff: b[o + 2] & 15, param: b[o + 3] });
        }
        rows.push(row);
      }
      patterns.push(rows);
    }
    let so = patBase + nPat * patSize;
    for (const s of samples) {
      const d = new Float32Array(s.len);
      for (let i = 0; i < s.len && so + i < b.length; i++) { const v = b[so + i]; d[i] = (v > 127 ? v - 256 : v) / 128; }
      s.data = d; so += s.len;
    }
    return { title, ch, samples, order, songLen, patterns };
  }

  function renderMod(buf, rate, maxSeconds) {
    const m = parse(buf), ch = m.ch;
    rate = rate || 44100; maxSeconds = maxSeconds || 420;
    const maxFrames = rate * maxSeconds;
    let outL = new Float32Array(rate * 60), outR = new Float32Array(rate * 60), n = 0;
    function ensure(k) {
      if (n + k <= outL.length) return;
      const nl = new Float32Array(outL.length * 2), nr = new Float32Array(outL.length * 2);
      nl.set(outL); nr.set(outR); outL = nl; outR = nr;
    }
    const C = [];
    for (let i = 0; i < ch; i++) C.push({ s: null, pos: 0, step: 0, per: 0, tper: 0, vol: 0, fine: 0, porta: 0, vib: 0, vibPos: 0, vibSp: 0, vibDp: 0, trm: 0, trmPos: 0, trmSp: 0, trmDp: 0, off: 0, cut: -1, delay: 0, loopRow: 0, loopCnt: 0, arp: 0, ret: 0, sampleNo: 0, wave: 0, pan: ((i & 3) === 0 || (i & 3) === 3) ? 0.25 : 0.75 });
    let speed = 6, tempo = 125, ord = 0, row = 0, tick = 0, breakRow = -1, jumpOrd = -1, patDelay = 0, bJump = false;
    const seen = new Set();
    const per = (note, fine) => {
      // find nearest table index for the period, then apply finetune scaling
      return fine ? Math.round(note * Math.pow(2, -fine / 96)) : note;
    };

    function trigger(c, e) {
      if (e.sample) { const s = m.samples[e.sample - 1]; if (s) { c.s = s; c.sampleNo = e.sample; c.vol = s.vol; c.fine = s.fine; } }
      if (e.period) {
        if (e.eff === 3 || e.eff === 5) { c.tper = per(e.period, c.fine); }
        else {
          c.per = per(e.period, c.fine); c.tper = c.per; c.pos = 0;
          if (c.wave < 4) c.vibPos = 0; if (c.wave >> 2 < 1) c.trmPos = 0;
        }
      }
    }
    function doRow(r) {
      const rowData = m.patterns[m.order[ord]][r];
      for (let i = 0; i < ch; i++) {
        const c = C[i], e = rowData[i];
        c.cut = -1; c.arp = 0; c.delay = 0;
        const fx = e.eff, p = e.param, hi = p >> 4, lo = p & 15;
        if (fx === 14 && hi === 13 && lo > 0) { c.delay = lo; c.pending = e; continue; }
        trigger(c, e);
        if (fx === 9 && p) c.off = p * 256;
        if (fx === 9 && e.period) c.pos = c.off;
        if (fx === 3 && p) c.porta = p;
        if (fx === 4) { if (hi) c.vibSp = hi; if (lo) c.vibDp = lo; }
        if (fx === 7) { if (hi) c.trmSp = hi; if (lo) c.trmDp = lo; }
        if (fx === 12) c.vol = Math.min(64, p);
        if (fx === 15) { if (p === 0) { /* stop */ } else if (p < 32) speed = p; else tempo = p; }
        if (fx === 11) { jumpOrd = p; breakRow = 0; bJump = true; }
        if (fx === 13) { breakRow = hi * 10 + lo; if (jumpOrd < 0) jumpOrd = ord + 1; }
        if (fx === 14) {
          if (hi === 1) c.per = Math.max(113, c.per - lo);
          else if (hi === 2) c.per = Math.min(856, c.per + lo);
          else if (hi === 4) c.wave = lo;
          else if (hi === 5) c.fine = lo > 7 ? lo - 16 : lo;
          else if (hi === 6) { if (lo === 0) c.loopRow = r; else { if (c.loopCnt === 0) c.loopCnt = lo; else c.loopCnt--; if (c.loopCnt > 0) { breakRow = c.loopRow; jumpOrd = ord; } } }
          else if (hi === 10) c.vol = Math.min(64, c.vol + lo);
          else if (hi === 11) c.vol = Math.max(0, c.vol - lo);
          else if (hi === 12) c.cut = lo;
          else if (hi === 14) patDelay = lo;
        }
        if (fx === 8 && p) c.pan = p / 255;
        if (fx === 14 && hi === 8) c.pan = lo / 15;
      }
    }
    function doTick(t) {
      for (let i = 0; i < ch; i++) {
        const c = C[i], rowData = m.patterns[m.order[ord]][row][i];
        const fx = rowData.eff, p = rowData.param, hi = p >> 4, lo = p & 15;
        if (c.delay && t === c.delay) { trigger(c, c.pending); c.delay = 0; }
        if (t === 0) continue;
        if (fx === 0 && p) { const k = t % 3; c.arp = k === 0 ? 0 : k === 1 ? hi : lo; }
        else if (fx === 1) c.per = Math.max(113, c.per - p);
        else if (fx === 2) c.per = Math.min(856, c.per + p);
        else if (fx === 3 || fx === 5) {
          if (c.tper && c.per) {
            if (c.per < c.tper) c.per = Math.min(c.tper, c.per + c.porta);
            else if (c.per > c.tper) c.per = Math.max(c.tper, c.per - c.porta);
          }
          if (fx === 5) c.vol = Math.max(0, Math.min(64, c.vol + (hi ? hi : -lo)));
        }
        else if (fx === 4 || fx === 6) {
          if (fx === 6) c.vol = Math.max(0, Math.min(64, c.vol + (hi ? hi : -lo)));
          c.vibPos = (c.vibPos + c.vibSp) & 63;
        }
        else if (fx === 7) c.trmPos = (c.trmPos + c.trmSp) & 63;
        else if (fx === 10) c.vol = Math.max(0, Math.min(64, c.vol + (hi ? hi : -lo)));
        else if (fx === 14) {
          if (hi === 9 && lo && t % lo === 0) c.pos = 0;
          if (hi === 12 && t === lo) c.vol = 0;
        }
      }
    }
    function wavev(pos, kind) {
      const k = kind & 3, q = pos & 31;
      if (k === 0) return (pos & 32 ? -1 : 1) * SINE[q];
      if (k === 1) return 255 - 8 * (pos & 63);
      return pos & 32 ? -255 : 255;
    }
    function mix(frames) {
      ensure(frames);
      for (let i = 0; i < ch; i++) {
        const c = C[i]; if (!c.s || !c.s.len || !c.per) continue;
        let pr = c.per, vol = c.vol;
        const rd = m.patterns[m.order[ord]][row][i], fx = rd.eff;
        if (c.arp) { let idx = 0, best = 1e9; for (let k = 0; k < 36; k++) { const d = Math.abs(PERIODS[k] - c.per); if (d < best) { best = d; idx = k; } } pr = PERIODS[Math.min(35, idx + c.arp)]; }
        if (fx === 4 || fx === 6) pr += (wavev(c.vibPos, c.wave & 3) * c.vibDp) / 128;
        if (fx === 7) vol = Math.max(0, Math.min(64, vol + (wavev(c.trmPos, c.wave >> 4) * c.trmDp) / 64));
        if (pr < 50) pr = 50;
        const step = PAULA / pr / rate, g = vol / 64 * 0.5 / Math.sqrt(ch / 4);
        const s = c.s, d = s.data, ll = s.loopLen > 2, ls = s.loopStart, le = s.loopStart + s.loopLen;
        const gl = g * (1 - c.pan) * 1.2, gr = g * c.pan * 1.2;
        let pos = c.pos;
        for (let f = 0; f < frames; f++) {
          let ip = pos | 0;
          if (ip >= (ll ? le : s.len)) { if (ll) { pos = ls + (pos - le); ip = pos | 0; } else { c.s = null; break; } }
          const fr = pos - ip, i2 = ip + 1 >= (ll ? le : s.len) ? (ll ? ls : ip) : ip + 1;
          const v = d[ip] + (d[i2] - d[ip]) * fr;
          outL[n + f] += v * gl; outR[n + f] += v * gr;
          pos += step;
        }
        c.pos = pos;
      }
      n += frames;
    }

    let finished = false;
    while (!finished && n < maxFrames) {
      // song end: revisiting the same order/row means it has looped
      const visit = ord * 64 + row;
      if (seen.has(visit) && tick === 0 && row === 0 && ord === 0) break;
      if (tick === 0) { if (patDelay) { patDelay--; } else doRow(row); seen.add(visit); }
      doTick(tick);
      const frames = Math.round(rate * 2.5 / tempo);
      mix(frames);
      // note cut (ECx)
      for (const c of C) if (c.cut === tick) c.vol = 0;
      tick++;
      if (tick >= speed) {
        tick = 0;
        if (jumpOrd >= 0 || breakRow >= 0) {
          let to = jumpOrd >= 0 ? jumpOrd : ord + 1; const rr = breakRow >= 0 ? breakRow : 0;
          if (bJump && to <= ord) finished = true;
          bJump = false;
          if (to >= m.songLen) { to = 0; finished = true; }
          ord = to; row = rr; jumpOrd = -1; breakRow = -1;
        } else if (++row >= 64) { row = 0; if (++ord >= m.songLen) { ord = 0; finished = true; } }
        if (!finished && seen.has(ord * 64 + row) && row === 0 && ord === 0) finished = true;
      }
    }
    // soft limit
    let peak = 0; for (let i = 0; i < n; i++) { const a = Math.abs(outL[i]), b2 = Math.abs(outR[i]); if (a > peak) peak = a; if (b2 > peak) peak = b2; }
    const k = peak > 0.95 ? 0.95 / peak : 1;
    const L = outL.slice(0, n), R = outR.slice(0, n);
    if (k !== 1) for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
    return { left: L, right: R, seconds: n / rate, title: m.title, channels: ch, rate };
  }

  root.renderMod = renderMod;
  if (typeof module !== "undefined") module.exports = { renderMod, parse };
})(typeof window !== "undefined" ? window : globalThis);
