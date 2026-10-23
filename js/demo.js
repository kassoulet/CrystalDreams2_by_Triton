/* ============================================================
   CD2 / BROWSER PORT
   A 320x200 indexed framebuffer, 256-colour palette, and six
   scenes reconstructed from the disassembly of CD2.EXE.
   ============================================================ */
(function () {
  "use strict";

  const W = 320, H = 200;
  const canvas = document.getElementById("demoCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const imageData = ctx.createImageData(W, H);
  const px = new Uint32Array(imageData.data.buffer);
  const pal = new Uint32Array(256);

  /* ------------------------------------------------------------
     palette
     ------------------------------------------------------------ */
  function col(i, r, g, b) {
    pal[i] = (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
  }
  function clearPalette() { pal.fill(0xff000000); }

  /* ------------------------------------------------------------
     framebuffer primitives
     ------------------------------------------------------------ */
  function clear(c) { px.fill(pal[c === undefined ? 0 : c]); }
  function pset(x, y, c) {
    x |= 0; y |= 0;
    if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = pal[c & 255];
  }
  function hline(x0, x1, y, c) {
    if (y < 0 || y >= H) return;
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    x0 = Math.max(0, x0 | 0); x1 = Math.min(W - 1, x1 | 0);
    if (x1 < x0) return;
    const v = pal[c & 255];
    const base = y * W;
    for (let x = x0; x <= x1; x++) px[base + x] = v;
  }
  function fillRect(x, y, w, h, c) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W - 1, (x + w) | 0), y1 = Math.min(H - 1, (y + h) | 0);
    if (x1 < x0 || y1 < y0) return;
    const v = pal[c & 255];
    for (let yy = y0; yy <= y1; yy++) {
      const b = yy * W;
      for (let xx = x0; xx <= x1; xx++) px[b + xx] = v;
    }
  }
  function line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      pset(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function fillPoly(pts, c) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
    const y0 = Math.max(0, Math.ceil(minY)), y1 = Math.min(H - 1, Math.floor(maxY));
    const xs = [];
    for (let y = y0; y <= y1; y++) {
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
        }
      }
      xs.sort((a, b) => a - b);
      for (let j = 0; j + 1 < xs.length; j += 2) hline(Math.ceil(xs[j]), Math.floor(xs[j + 1]), y, c);
    }
  }

  /* ------------------------------------------------------------
     5 x 7 bitmap font
     ------------------------------------------------------------ */
  const FONT = {
    " ": [0, 0, 0, 0, 0],
    "A": [0x7c, 0x12, 0x11, 0x12, 0x7c],
    "B": [0x7f, 0x49, 0x49, 0x49, 0x36],
    "C": [0x3e, 0x41, 0x41, 0x41, 0x22],
    "D": [0x7f, 0x41, 0x41, 0x22, 0x1c],
    "E": [0x7f, 0x49, 0x49, 0x49, 0x41],
    "F": [0x7f, 0x09, 0x09, 0x09, 0x01],
    "G": [0x3e, 0x41, 0x49, 0x49, 0x7a],
    "H": [0x7f, 0x08, 0x08, 0x08, 0x7f],
    "I": [0x00, 0x41, 0x7f, 0x41, 0x00],
    "J": [0x20, 0x40, 0x41, 0x3f, 0x01],
    "K": [0x7f, 0x08, 0x14, 0x22, 0x41],
    "L": [0x7f, 0x40, 0x40, 0x40, 0x40],
    "M": [0x7f, 0x02, 0x0c, 0x02, 0x7f],
    "N": [0x7f, 0x04, 0x08, 0x10, 0x7f],
    "O": [0x3e, 0x41, 0x41, 0x41, 0x3e],
    "P": [0x7f, 0x09, 0x09, 0x09, 0x06],
    "Q": [0x3e, 0x41, 0x51, 0x21, 0x5e],
    "R": [0x7f, 0x09, 0x19, 0x29, 0x46],
    "S": [0x46, 0x49, 0x49, 0x49, 0x31],
    "T": [0x01, 0x01, 0x7f, 0x01, 0x01],
    "U": [0x3f, 0x40, 0x40, 0x40, 0x3f],
    "V": [0x1f, 0x20, 0x40, 0x20, 0x1f],
    "W": [0x3f, 0x40, 0x38, 0x40, 0x3f],
    "X": [0x63, 0x14, 0x08, 0x14, 0x63],
    "Y": [0x07, 0x08, 0x70, 0x08, 0x07],
    "Z": [0x61, 0x51, 0x49, 0x45, 0x43],
    "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
    "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
    "2": [0x42, 0x61, 0x51, 0x49, 0x46],
    "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
    "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
    "5": [0x27, 0x45, 0x45, 0x45, 0x39],
    "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
    "7": [0x01, 0x71, 0x09, 0x05, 0x03],
    "8": [0x36, 0x49, 0x49, 0x49, 0x36],
    "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
    ":": [0x00, 0x36, 0x36, 0x00, 0x00],
    ".": [0x00, 0x60, 0x60, 0x00, 0x00],
    ",": [0x00, 0x50, 0x30, 0x00, 0x00],
    "-": [0x08, 0x08, 0x08, 0x08, 0x08],
    "_": [0x40, 0x40, 0x40, 0x40, 0x40],
    "/": [0x20, 0x10, 0x08, 0x04, 0x02],
    "+": [0x08, 0x08, 0x3e, 0x08, 0x08],
    "!": [0x00, 0x00, 0x5f, 0x00, 0x00],
    "?": [0x02, 0x01, 0x51, 0x09, 0x06],
    "'": [0x00, 0x07, 0x00, 0x00, 0x00],
    "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
    ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
    "*": [0x14, 0x08, 0x3e, 0x08, 0x14],
    "=": [0x14, 0x14, 0x14, 0x14, 0x14],
    "<": [0x08, 0x14, 0x22, 0x41, 0x00],
    ">": [0x00, 0x41, 0x22, 0x14, 0x08]
  };

  function colorFn(c) {
    if (typeof c === "function") return c;
    if (Array.isArray(c)) return (row) => c[row % c.length];
    return () => c;
  }
  function drawText(str, x, y, scale, c) {
    const cf = colorFn(c);
    let cx = x | 0;
    const s = scale | 0;
    str = String(str).toUpperCase();
    for (let i = 0; i < str.length; i++) {
      const glyph = FONT[str[i]] || FONT["?"];
      for (let col = 0; col < 5; col++) {
        const bits = glyph[col];
        for (let row = 0; row < 7; row++) {
          if (bits & (1 << row)) fillRect(cx + col * s, y + row * s, s, s, cf(row));
        }
      }
      cx += 6 * s;
    }
    return cx - x;
  }
  function textWidth(str, scale) { return String(str).length * 6 * (scale | 0) - (scale | 0); }
  function drawCentered(str, y, scale, c) {
    drawText(str, ((W - textWidth(str, scale)) / 2) | 0, y, scale, c);
  }

  /* ------------------------------------------------------------
     helpers
     ------------------------------------------------------------ */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

  /* ------------------------------------------------------------
     audio: the demo's own .MOD files (extracted from CD2.EXE), mixed offline by
     js/modplayer.js into AudioBuffers, so pause and seek are exact.
     Credits page of the demo: music for intro, spacecut and fractal/tunnelflight is by Vogue,
     for the chessboard and the information viewer by LizardKing (their two modules sit in a
     "lizrdmod" folder name inside the binary). Which module goes with which scene inside each
     pair is my guess; "Auto" follows it, the selector overrides it.
     ------------------------------------------------------------ */
  function autoTrack(g) {              // timeline second -> module and offset (s)
    let a = 0; const start = {};
    for (const n of ORDER) { start[n] = a; a += SCENES[n].dur; }
    if (g >= start.end) return { track: "TrnsAtln", off: g - start.end };
    if (g >= start.chess) return { track: "Desert-D", off: g - start.chess };
    if (g >= start.fractal) return { track: "AmbPower", off: g - start.fractal };
    return { track: "Declogue", off: g };
  }
  const music = {
    on: false, ctx: null, gain: null, src: null, bufs: {}, pick: "auto", pending: {},
    async load(name) {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !window.renderMod) return null;
        this.ctx = new AC();
        this.gain = this.ctx.createGain(); this.gain.gain.value = 0.8;
        this.gain.connect(this.ctx.destination);
      }
      if (this.bufs[name]) return this.bufs[name];
      if (!this.pending[name]) this.pending[name] = fetch("assets/orig/" + name + ".mod").then(r => r.arrayBuffer()).then(ab => {
        const r = window.renderMod(ab, this.ctx.sampleRate);
        const b = this.ctx.createBuffer(2, r.left.length, this.ctx.sampleRate);
        b.getChannelData(0).set(r.left); b.getChannelData(1).set(r.right);
        b.title = r.title; this.bufs[name] = b; return b;
      });
      return this.pending[name];
    },
    stopSrc() { if (this.src) { try { this.src.stop(); } catch (e) {} this.src.disconnect(); this.src = null; } },
    async play(g) {
      const w = this.pick === "auto" ? autoTrack(g || 0) : { track: this.pick, off: g || 0 };
      const buf = await this.load(w.track);
      if (!this.on || !buf) return;
      if (this.src && this.current === w.track && this.pick === "auto") {      // same module: keep playing if already in sync
        const pos = (this.startOff + this.ctx.currentTime - this.startAt) % buf.duration;
        if (Math.abs(pos - w.off % buf.duration) < 0.6) return;
      }
      this.stopSrc();
      this.src = this.ctx.createBufferSource();
      this.src.buffer = buf; this.src.loop = true; this.src.connect(this.gain);
      this.src.start(0, w.off % buf.duration);
      this.startOff = w.off % buf.duration; this.startAt = this.ctx.currentTime;
      this.current = w.track;
    },
    async toggle() {
      if (this.on) { this.on = false; this.stopSrc(); return false; }
      this.on = true;
      const first = this.pick === "auto" ? autoTrack(globalT()).track : this.pick;
      if (!await this.load(first)) { this.on = false; return false; }
      await this.ctx.resume();
      await this.play(globalT());
      if (paused) this.ctx.suspend();
      return true;
    },
    setTrack(name) { this.pick = name; if (this.on) this.play(globalT()); },
    pause(p) { if (this.ctx && this.on) p ? this.ctx.suspend() : this.ctx.resume(); },
    seek(g) { if (this.on) this.play(g); }
  };

  /* ------------------------------------------------------------
     scenes
     ------------------------------------------------------------ */
  const SCENES = {
    boot:     { dur: 7,  label: "BOOT" },
    intro:    { dur: 2150 / 70, label: "INTRO" },
    plasma:   { dur: 11.5, label: "PLASMA" },
    cube:     { dur: 39.5, label: "MAGIC CUBE" },
    fractal:  { dur: 29, label: "FRACTAL ZOOM" },
    slime:    { dur: 1136 / 70, label: "VECTORSLIME" },
    tunnel:   { dur: 4750 / 70, label: "TUNNEL FLIGHT" },
    pictures: { dur: 20, label: "PICTURES" },
    earth:    { dur: (471 + 1567) / 70, label: "EARTH" },        // frame counts of the original procedures 18e1:0427 and 18e1:0687 run under emulation (retrace counter 70 Hz)
    chess:    { dur: 8526 / 70, label: "CHESSBOARD" },       // 11c1:02ed ran 8,526 frames to its closing fade under emulation
    end:      { dur: 20, label: "ENDPART" }
  };
  // Order follows the authors' own list on the Comments page (CD2.EXE, Scr_Comm): intro, objects/spacecut,
  // plasma, fractal zoom, raytraced pictures, earth, chessboard, endpart. Durations are mine.
  const ORDER = ["boot", "intro", "cube", "plasma", "fractal", "slime", "tunnel", "pictures", "earth", "chess", "end"];

  let scene = "boot";
  let sceneT = 0;
  let frame = 0;
  let paused = false;
  let loop = true;
  let visible = true;

  const stars = [];
  function resetStars(n) {
    stars.length = 0;
    for (let i = 0; i < n; i++) {
      stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() * 0.9 + 0.1 });
    }
  }
  function drawStars(dt, speed, c) {
    for (const st of stars) {
      st.z -= dt * speed;
      if (st.z < 0.06) {
        st.x = Math.random() * 2 - 1;
        st.y = Math.random() * 2 - 1;
        st.z = 0.9 + Math.random() * 0.1;
      }
      const sx = (W / 2 + (st.x / st.z) * W * 0.55) | 0;
      const sy = (H / 2 + (st.y / st.z) * H * 0.55) | 0;
      if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
        pset(sx, sy, st.z > 0.65 ? c[0] : st.z > 0.3 ? c[1] : c[2]);
      }
    }
  }

  /* ---------- boot ---------- */
  let bootStars = [];
  function initBoot() {
    clearPalette();
    col(0, 0, 0, 0);
    col(1, 255, 180, 84);
    col(2, 160, 90, 30);
    col(3, 92, 225, 209);
    col(4, 236, 233, 226);
    col(5, 242, 92, 162);
    col(6, 98, 72, 58);
    resetStars(80);
    bootStars = stars;
  }
  function drawBoot(t) {
    clear(0);
    drawStars(0.016, 0.045, [4, 6, 6]);
    const blink = (Math.sin(t * 5) > -0.3) ? 1 : 0;
    if (t > 0.3) drawCentered("ATTENTION", 52, 3, [1, 1, 2, 2, 2, 1, 1]);
    if (t > 1.0) {
      drawCentered("THIS IS A TRITON", 92, 2, [4, 4, 4, 4, 4, 4, 4]);
      drawCentered("PRODUCTION", 112, 2, [4, 4, 4, 4, 4, 4, 4]);
    }
    if (t > 3.0) {
      drawCentered("TIME TO WAKEUP", 142, 2, blink ? [3, 3, 3, 3, 3, 3, 3] : [2, 2, 2, 2, 2, 2, 2]);
    }
    if (t > 5.4) {
      const a = 1 - clamp((t - 5.4) / 1.2, 0, 1);
      if (a > 0.15) drawCentered("CD2", 166, 1, 2);
    }
    // centre crosshair, like the DOS mouse cursor
    if (t > 1) {
      const cx = W / 2, cy = H / 2;
      hline(cx - 4, cx - 1, cy, 5); hline(cx + 1, cx + 4, cy, 5);
      vline(cx, cy - 4, cy - 1, 5); vline(cx, cy + 1, cy + 4, 5);
    }
  }
  function vline(x, y0, y1, c) {
    if (x < 0 || x >= W) return;
    y0 = Math.max(0, y0 | 0); y1 = Math.min(H - 1, y1 | 0);
    const v = pal[c & 255];
    for (let y = y0; y <= y1; y++) px[y * W + x] = v;
  }

  /* ---------- plasma: the demo's own routine (image 0x3C7D, 0x3A82, 0x3A10), ported and verified ----------
     tools/run_plasma.py runs the original table builder, frame renderer and palette routine under emulation and
     compares them with this port (0 mismatches).
       T[i]      = round(128 + 127*sin(2*pi*i/1024))
       pixel     = T[p1 + 2y + 7x] + T[p3 - 3y] + T[p4 - y]   (x = 80 blocks of 4 px, y = 100 row pairs, 2 identical lines)
       palette   = 3 sine waves: channel = (T[(phase + 4i) & 1023] * level & 0xFFFF) >> 10   (6-bit DAC)
     Per frame the phases move: p1 -= 2, p3 -= 2, p4 += 2; palette phases: R -= 2, G += 2 (from 0x200), B = p3.
     Level fades in at 2 per frame to 256; the main loop runs until the music player has ticked 512 times (assumed 50 Hz),
     then 86 frames of fade-out (level 256 -> 86) while the display start address pans right 1 byte (4 px) per frame. */
  const PL_T = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) PL_T[i] = Math.round(128 + 127 * Math.sin(2 * Math.PI * i / 1024));
  const PL_FPS = 70, PL_MAIN = Math.ceil(512 / 50 * PL_FPS), PL_OUT = 86;
  const plPal = new Uint32Array(256);
  function plasmaPalette(f, level) {
    const pr = (-2 * f) & 1023, pg = (512 + 2 * f) & 1023, pb = (-2 * f) & 1023;
    for (let i = 0; i < 256; i++) {
      const r = ((PL_T[(pr + 4 * i) & 1023] * level) & 0xFFFF) >> 10;
      const g = ((PL_T[(pg + 4 * i) & 1023] * level) & 0xFFFF) >> 10;
      const b = ((PL_T[(pb + 4 * i) & 1023] * level) & 0xFFFF) >> 10;
      plPal[i] = (255 << 24) | ((((b << 2) | (b >> 4)) & 255) << 16) | ((((g << 2) | (g >> 4)) & 255) << 8) | (((r << 2) | (r >> 4)) & 255);
    }
  }
  function initPlasma() { resetStars(0); }
  function drawPlasma(t) {
    const f = Math.max(0, Math.floor(t * PL_FPS));
    let level, pan = 0;
    if (f < PL_MAIN) level = Math.min(256, 2 * (f + 1));
    else {
      const k = Math.min(PL_OUT - 1, f - PL_MAIN);
      level = 256 - 2 * k; pan = Math.min(k + 1, 80);
      if (f >= PL_MAIN + PL_OUT) { px.fill(0xff000000); return; }          // palette zeroed, start address 0
    }
    plasmaPalette(f, level);
    const p1 = (-2 * (f + 1)) & 1023, p3 = (-2 * (f + 1)) & 1023, p4 = (2 * (f + 1)) & 1023;
    for (let r = 0; r < 100; r++) {
      const b = PL_T[(p3 - 3 * r) & 1023] + PL_T[(p4 - r) & 1023];
      for (let sx = 0; sx < 80; sx++) {
        const xb = sx + pan;
        const col = xb < 80 ? plPal[(PL_T[(p1 + 2 * r + 7 * xb) & 1023] + b) & 255] : plPal[0];     // beyond the plasma: zero bytes = colour 0
        const o = 2 * r * W + 4 * sx;
        px[o] = px[o + 1] = px[o + 2] = px[o + 3] = col;
        px[o + W] = px[o + W + 1] = px[o + W + 2] = px[o + W + 3] = col;
      }
    }
  }

  /* ---------- cube scene: title card (original text routine, original palette and fade timeline) ----------
     The four lines were drawn by the demo's own text routine (image 0x15980) with the Nice-f16 font under emulation
     (tools/run_title.py); assets/orig/title_idx.png holds the palette indices. Timeline from the scene code
     (0xB274..0xB38B): four fades of 64 frames (one more colour group each), a 64-frame hold, a 64-frame fade out. */
  const TITLE_F = 6 * 64, TITLE_T = TITLE_F / 70;
  const TT = { state: 0, idx: null, tgt: null, pal: new Uint32Array(64) };
  function titleLoad() {
    if (TT.state) return;
    TT.state = 1;
    const im = loadImg("assets/orig/title_idx.png");
    Promise.all([fetch("assets/orig/title_pal.json").then(r => r.json()), new Promise(r => { im.onload = r; if (im.complete) r(); })]).then(([pal]) => {
      TT.tgt = pal;
      const c = document.createElement("canvas"); c.width = 320; c.height = 200;
      const g = c.getContext("2d"); g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, 320, 200).data;
      TT.idx = new Uint8Array(64000);
      for (let i = 0; i < 64000; i++) TT.idx[i] = d[i * 4];
      TT.state = 2;
    });
  }
  function drawTitle(t) {
    clear(0);
    if (TT.state !== 2) return;
    const f = Math.min(TITLE_F - 1, Math.floor(t * 70)), ph = f >> 6, k = (f & 63) + 1;
    for (let e = 0; e < 64; e++) {
      const g = e >> 4, v = [0, 0, 0];
      for (let q = 0; q < 3; q++) {
        const tg = TT.tgt[e * 3 + q];
        v[q] = ph < 4 ? (g < ph ? tg : g === ph ? Math.min(tg, k) : 0) : ph === 4 ? tg : Math.max(0, tg - k);
      }
      TT.pal[e] = fracDACto32(v[0], v[1], v[2]);
    }
    for (let i = 0; i < 64000; i++) px[i] = TT.pal[TT.idx[i]];
  }
  /* ---- 16-colour clips: frames recorded from the demo's own scenes under emulation (tools/run_cube.py, tools/run_intro.py -> tools/export_cube.py) ----
     The scene loop ran with a small VGA model; each frame is the 16-colour page at the flip, with the DAC palette. They are stored
     as 35-frame chunks (delta + deflate) and decoded on demand. */
  function nibbleClip(url) {
    const C = { url, state: 0, n: 0, chunkN: 35, offs: null, buf: null, cache: new Map(), pending: new Set(), keep: null };
    const pal16 = new Uint32Array(16);
    C.load = function () {
      if (C.state) return;
      C.state = 1;
      fetch(url).then(r => r.arrayBuffer()).then(ab => {
        const dv = new DataView(ab);
        C.n = dv.getUint16(4, true); C.chunkN = dv.getUint16(6, true); const nc = dv.getUint16(8, true);
        C.offs = []; for (let i = 0; i <= nc; i++) C.offs.push(dv.getUint32(10 + 4 * i, true));
        C.buf = ab; C.state = 2;
      });
    };
    async function decode(c) {
      const blob = new Uint8Array(C.buf, C.offs[c], C.offs[c + 1] - C.offs[c]);
      const ab = await new Response(new Blob([blob]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      const d = new Uint8Array(ab), n = Math.min(C.chunkN, C.n - c * C.chunkN), pal = d.subarray(0, n * 48);
      const frames = new Uint8Array(n * 32000);
      frames.set(d.subarray(n * 48, n * 48 + 32000), 0);
      for (let i = 1; i < n; i++) {
        const o = n * 48 + i * 32000, a = (i - 1) * 32000, b = i * 32000;
        for (let k = 0; k < 32000; k++) frames[b + k] = frames[a + k] ^ d[o + k];
      }
      C.cache.set(c, { n, pal, frames });
      if (C.cache.size > 6) C.cache.delete(C.cache.keys().next().value);
      C.pending.delete(c);
    }
    function chunk(c) {
      if (c < 0 || c * C.chunkN >= C.n) return null;
      const e = C.cache.get(c);
      if (e) return e;
      if (!C.pending.has(c)) { C.pending.add(c); decode(c); }
      return null;
    }
    C.draw = function (f) {
      if (C.state !== 2) { clear(0); return; }
      f = Math.min(C.n - 1, Math.max(0, f));
      const c = (f / C.chunkN) | 0, e = chunk(c);
      chunk(c + 1);
      if (e) {
        const i = f - c * C.chunkN;
        for (let q = 0; q < 16; q++) pal16[q] = fracDACto32(e.pal[i * 48 + q * 3], e.pal[i * 48 + q * 3 + 1], e.pal[i * 48 + q * 3 + 2]);
        const fr = e.frames.subarray(i * 32000, (i + 1) * 32000);
        for (let k = 0; k < 32000; k++) { const v = fr[k]; px[2 * k] = pal16[v >> 4]; px[2 * k + 1] = pal16[v & 15]; }
        if (!C.keep) C.keep = new Uint32Array(64000);
        C.keep.set(px);
      } else if (C.keep) px.set(C.keep); else clear(0);        // chunk still decoding: keep the previous frame
    };
    return C;
  }
  const CUBE3D = nibbleClip("assets/orig/cube_frames.bin"), INTRO = nibbleClip("assets/orig/intro_frames.bin");
  function draw3dFrame(f) { CUBE3D.draw(f); }
  /* ---------- vectorslime and tunnel flight: frames recorded from the demo's own scene procedures ----------
     tools/run_slime.py and tools/run_tunnel.py run the procedures (image 0x248b and 0xBA92) under emulation, loading their
     objects through the demo's own archive reader; each frame is the 320x200 256-colour screen at the retrace/flip call plus
     the DAC palette. tools/export_slime.py packs them in 30-frame chunks (XOR delta + deflate), decoded on demand here. */
  function frameClip(url) {
    const C = { url, state: 0, n: 0, chunkN: 30, offs: null, buf: null, cache: new Map(), pending: new Set(), keep: null };
    C.load = function () {
      if (C.state) return;
      C.state = 1;
      fetch(url).then(r => r.arrayBuffer()).then(ab => {
        const dv = new DataView(ab);
        C.n = dv.getUint16(4, true); C.chunkN = dv.getUint16(6, true); const nc = dv.getUint16(8, true);
        C.offs = []; for (let i = 0; i <= nc; i++) C.offs.push(dv.getUint32(10 + 4 * i, true));
        C.buf = ab; C.state = 2;
      });
    };
    async function decode(c) {
      const blob = new Uint8Array(C.buf, C.offs[c], C.offs[c + 1] - C.offs[c]);
      const d = new Uint8Array(await new Response(new Blob([blob]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      const n = Math.min(C.chunkN, C.n - c * C.chunkN), pal = d.slice(0, n * 768), fr = d.slice(n * 768);
      for (let i = 1; i < n; i++) {
        for (let k = 0; k < 768; k++) pal[i * 768 + k] ^= pal[(i - 1) * 768 + k];
        for (let k = 0; k < 64000; k++) fr[i * 64000 + k] ^= fr[(i - 1) * 64000 + k];
      }
      C.cache.set(c, { n, pal, fr });
      if (C.cache.size > 5) C.cache.delete(C.cache.keys().next().value);
      C.pending.delete(c);
    }
    function chunk(c) {
      if (c < 0 || c * C.chunkN >= C.n) return null;
      const e = C.cache.get(c);
      if (e) return e;
      if (!C.pending.has(c)) { C.pending.add(c); decode(c); }
      return null;
    }
    C.draw = function (t) {
      if (C.state !== 2) { clear(0); return; }
      const f = Math.min(C.n - 1, Math.max(0, Math.floor(t * 70))), c = (f / C.chunkN) | 0, e = chunk(c);
      chunk(c + 1);
      if (!e) { if (C.keep) px.set(C.keep); else clear(0); return; }
      const i = f - c * C.chunkN, pal = new Uint32Array(256);
      for (let q = 0; q < 256; q++) pal[q] = fracDACto32(e.pal[i * 768 + q * 3], e.pal[i * 768 + q * 3 + 1], e.pal[i * 768 + q * 3 + 2]);
      const fr = e.fr.subarray(i * 64000, (i + 1) * 64000);
      for (let k = 0; k < 64000; k++) px[k] = pal[fr[k]];
      if (!C.keep) C.keep = new Uint32Array(64000);
      C.keep.set(px);
    };
    return C;
  }
  const SLIME = frameClip("assets/orig/slime_frames.bin"), TUNNEL = frameClip("assets/orig/tunnel_frames.bin");
  function initSlime() { SLIME.load(); resetStars(0); }
  function initTunnel() { TUNNEL.load(); resetStars(0); }
  function drawSlime(t) { SLIME.draw(t); }
  function drawTunnel(t) { TUNNEL.draw(t); }
  function initCube() { titleLoad(); CUBE3D.load(); resetStars(0); }
  function drawCube(t) { if (t < TITLE_T) drawTitle(t); else draw3dFrame(Math.floor((t - TITLE_T) * 70)); }

  /* ---------- fractal zoom: the original data, the original scaler's pixel map, the original palette ----------
     MegaFrac.DAT = 4 VGA planes x 1024 columns x 128 rows of Mandelbrot iteration counts (plus a 16 KB table).
     tools/extract_fractal_map.py ran the demo's own column scaler (image 0x7FB1) and recorded, for each of the
     200x200 output pixels, (j, k, S); the pixel is   tile[2k + bit9(col)][(S + col*128) & 0xFFFF]
     with  col = max(0, T[z&7][j-1] - (z>>3)),  T[i][j] = round(i/8 + 68.1*ln((j+1)*2^24/500)).
     The zoom schedule is the one in the scene loop: c0c starts at 384, speed ramps 1..32, ends past 0xED80,
     one step per vertical retrace (70 Hz is my assumption). 20 octaves = the authors' 1,048,576x. */
  const FR = { state: 0, j: null, k: null, S: null, mega: null, sin0: null, T: null, tgt: null, pal: new Uint32Array(256), frames: 0 };
  function fracLoad() {
    if (FR.state) return;
    FR.state = 1;
    Promise.all([
      fetch("assets/orig/fractal_map.bin").then(r => r.arrayBuffer()),
      fetch("assets/orig/megafrac.dat").then(r => r.arrayBuffer()),
      fetch("assets/orig/sintab.raw").then(r => r.arrayBuffer())
    ]).then(([m, d, st]) => {
      const a = new Uint8Array(m), n = 40000;
      FR.j = new Uint8Array(n); FR.k = new Uint8Array(n); FR.S = new Uint16Array(n);
      for (let p = 0; p < n; p++) { FR.j[p] = a[p * 4]; FR.k[p] = a[p * 4 + 1]; FR.S[p] = a[p * 4 + 2] | (a[p * 4 + 3] << 8); }
      FR.mega = new Uint8Array(d);
      FR.sin0 = new Int16Array(st, 0, 1024);
      FR.T = new Int32Array(8 * 128);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 128; j++) FR.T[i * 128 + j] = Math.round(i / 8 + 68.1 * Math.log((j + 1) * 16777216 / 500));
      // palette generator at image 0x3091E: three sine phases (788, 838, 896), step 6, value = 0x20 + sin/1024 (6-bit DAC)
      FR.tgt = new Uint8Array(768);
      let p1 = 788, p2 = 838, p3 = 896;
      for (let i = 0; i < 256; i++) {
        p1 = (p1 + 6) & 1023; p2 = (p2 + 6) & 1023; p3 = (p3 + 6) & 1023;
        FR.tgt[i * 3] = 0x20 + Math.trunc(FR.sin0[p1] / 1024);
        FR.tgt[i * 3 + 1] = 0x20 + Math.trunc(FR.sin0[p2] / 1024);
        FR.tgt[i * 3 + 2] = 0x20 + Math.trunc(FR.sin0[p3] / 1024);
      }
      FR.tgt[0] = FR.tgt[1] = FR.tgt[2] = 0;
      // number of zoom frames: loop runs while c0c <= 0xED80
      let c = 384, nf = 0;
      while (c <= 0xED80) { nf++; c += Math.min(nf, 32); }
      FR.frames = nf;
      FR.state = 2;
    });
  }
  const FR_FADE = 63 / 70;                                  // 63 retraces to fade the palette in / to white
  function fracC0C(n) { const m = n - 1; return 384 + (m <= 32 ? m * (m + 1) / 2 : 528 + 32 * (m - 32)); }
  function fracDACto32(r, g, b) { return (255 << 24) | ((((b << 2) | (b >> 4)) & 255) << 16) | ((((g << 2) | (g >> 4)) & 255) << 8) | (((r << 2) | (r >> 4)) & 255); }
  function setFracPalette(level, towardWhite) {              // level = retrace ticks of fading so far
    const L = Math.max(0, Math.min(63, level | 0));
    for (let i = 0; i < 256; i++) {
      let c = [0, 0, 0];
      for (let q = 0; q < 3; q++) {
        const tg = FR.tgt[i * 3 + q];
        c[q] = towardWhite ? Math.min(63, tg + L) : Math.min(tg, L);
      }
      FR.pal[i] = fracDACto32(c[0], c[1], c[2]);
    }
  }
  function initFractal() { fracLoad(); resetStars(0); }
  function fracTotal() { return FR.state === 2 ? FR_FADE + FR.frames / 70 + FR_FADE : 0; }
  function drawFractal(t) {
    clear(0);
    if (FR.state !== 2) { drawCentered("LOADING", 96, 1, [13, 13, 13, 13, 13, 13, 13]); return; }
    const tz = t - FR_FADE, tot = FR.frames / 70;
    let n, level, white = false;
    if (tz < 0) { n = 1; level = Math.floor(t * 70); }                         // first picture, palette fading in
    else if (tz < tot) { n = Math.min(FR.frames, 1 + Math.floor(tz * 70)); level = 63; }
    else { n = FR.frames; level = Math.floor((tz - tot) * 70); white = true; }  // fade to white
    setFracPalette(level, white);
    const z = fracC0C(n) >> 3, base = z >> 3, i = z & 7;
    const col = new Int32Array(101);
    for (let q = 1; q <= 100; q++) col[q] = Math.max(0, FR.T[i * 128 + q - 1] - base);
    const mega = FR.mega, J = FR.j, K = FR.k, S = FR.S, pal32 = FR.pal;
    // The scaler fills 200x200 pixels (x 60..259). The whole frame is then shown in the 256x133 window (see present()).
    for (let y = 0; y < 200; y++) {
      for (let x = 60; x < 260; x++) {
        const p = y * 200 + (x - 60), c = col[J[p]];
        px[y * W + x] = pal32[mega[((2 * K[p] + ((c >> 9) & 1)) << 16) + ((S[p] + (c << 7)) & 0xFFFF)]];
      }
    }
    // Frame lines drawn by the scene (image 0x8860): rows 8 and 192, x 0..59 and 260..319, palette index 0xF0 - i (fading outwards)
    for (let i = 0; i < 60; i++) {
      for (const y of [8, 192]) { px[y * W + i] = pal32[0xF0 - i]; px[y * W + 260 + i] = pal32[0xB5 + i]; }
    }
  }

  /* ---------- pictures ---------- */
  // The original 320x400 pictures, decoded from the TGA files inside CD2.EXE (tools/extract.py).
  const PICTURES = [
    { src: "assets/orig/Raytrac1.png", label: "RAYTRAC1.TGA" },
    { src: "assets/orig/Raytrac3.png", label: "RAYTRAC3.TGA" },
    { src: "assets/orig/Raytrac4.png", label: "RAYTRAC4.TGA" },
    { src: "assets/orig/TRN-L3.png", label: "TRN-L3.TGA" }
  ];
  const picImgs = [];
  function loadImg(src) { const im = new Image(); im.src = src; return im; }
  // These two scenes are 320x400 (Mode X, doubled vertical resolution); the CSS keeps the frame 4:3.
  function setTall(on) {
    const h = on ? 400 : 200;
    if (canvas.height !== h) { canvas.height = h; ctx.imageSmoothingEnabled = false; }
  }
  function initPictures() {
    if (!picImgs.length) PICTURES.forEach(p => picImgs.push(loadImg(p.src)));
    setTall(true);
  }
  function drawPicture(t) {
    const per = 5.0;
    const i = Math.floor(t / per) % PICTURES.length;
    const local = t % per;
    const alpha = clamp(Math.min(local / 0.9, (per - local) / 0.9), 0, 1);
    const im = picImgs[i];
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 320, 400);
    if (im && im.complete && im.naturalWidth) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(im, 0, 0, 320, 400);
      ctx.globalAlpha = 1;
    }
    ctx.font = "8px ui-monospace, monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(4, 386, 120, 11);
    ctx.fillStyle = "#d8d2c4";
    ctx.fillText(PICTURES[i].label, 7, 388);
    ctx.fillStyle = "#5ce1d1";
    ctx.fillText((i + 1) + "/" + PICTURES.length, 292, 388);
  }

  /* ---------- end ---------- */
  /* ---------- earth + chessboard: the original .TVO models (js/demo3d.js) ---------- */
  const R3 = window.CD2_3D ? new window.CD2_3D.Renderer(W, H) : null;
  let models3d = false;
  const tex = {};
  function texFromImg(im, sw, sh) {
    const c = document.createElement("canvas"); c.width = sw; c.height = sh;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0, sw, sh, 0, 0, sw, sh);
    const d = g.getImageData(0, 0, sw, sh);
    return { w: sw, h: sh, data: new Uint32Array(d.data.buffer.slice(0)) };
  }
  function ensure3d() {
    if (!R3) return;
    if (!models3d) { models3d = true; window.CD2_3D.load("assets/orig/objects.json"); }
    const want = (k, src, w, h) => {
      if (tex[k]) return;
      const im = loadImg(src);
      tex[k] = null;
      im.onload = () => { tex[k] = texFromImg(im, w, h); };
    };
    want("earth", "assets/orig/Earth1.png", 256, 200);
    want("marble", "assets/orig/Marb32.png", 320, 200);
  }
  function initEarth() { ensure3d(); clearPalette(); col(0, 0, 0, 0); }
  function initChess() { ensure3d(); clearPalette(); col(0, 0, 0, 0); }
  function draw3d(fn) {
    if (!R3 || !fn()) { clear(0); drawCentered("LOADING", 96, 1, [13, 13, 13, 13, 13, 13, 13]); return; }
    px.set(R3.buf);
  }
  function drawEarth(t) { draw3d(() => window.CD2_3D.earthFrame(R3, t, tex.earth)); }
  function drawChess(t) { draw3d(() => window.CD2_3D.chessFrame(R3, t, tex.marble)); }

  // Endpart: the original MainM256.TGA (320x400). The cursor marker is my addition;
  // the original's menu logic was not reversed.
  const MENU_Y = [272, 292, 312, 330, 350, 368, 388];
  let menuImg = null;
  function initEnd() {
    if (!menuImg) menuImg = loadImg("assets/orig/MainM256.png");
    setTall(true);
  }
  function drawEnd(t) {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 320, 400);
    if (menuImg.complete && menuImg.naturalWidth) ctx.drawImage(menuImg, 0, 0, 320, 400);
    const sel = Math.floor(t / 1.6) % MENU_Y.length, y = MENU_Y[sel] - 6;
    ctx.fillStyle = "#5ce1d1";
    ctx.beginPath(); ctx.moveTo(40, y - 4); ctx.lineTo(48, y); ctx.lineTo(40, y + 4); ctx.fill();
  }

  /* ------------------------------------------------------------
     scene switching / loop
     ------------------------------------------------------------ */
  function buildScene(name) {
    scene = name;
    setTall(name === "pictures" || name === "end");
    sceneT = 0;
    frame = 0;
    if (name === "boot") initBoot();
    else if (name === "intro") { INTRO.load(); resetStars(0); }
    else if (name === "plasma") initPlasma();
    else if (name === "cube") initCube();
    else if (name === "fractal") initFractal();
    else if (name === "slime") initSlime();
    else if (name === "tunnel") initTunnel();
    else if (name === "pictures") initPictures();
    else if (name === "earth") initEarth();
    else if (name === "chess") initChess();
    else if (name === "end") initEnd();
    syncButtons();
    updateHud();
    if (music.on) music.seek(globalT());
  }

  function nextScene() {
    const i = ORDER.indexOf(scene);
    buildScene(ORDER[(i + 1) % ORDER.length]);
  }

  /* ------------------------------------------------------------
     HUD / controls
     ------------------------------------------------------------ */
  const hudScene = document.getElementById("hudScene");
  const hudTime = document.getElementById("hudTime");
  function updateHud() {
    if (hudScene) hudScene.textContent = (SCENES[scene] || {}).label || scene.toUpperCase();
    if (hudTime) {
      const mmss = x => { x = Math.floor(x); return String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0"); };
      const g = globalT();
      hudTime.textContent = mmss(g);
      if (hudTotal) hudTotal.textContent = mmss(TOTAL);
      if (seekBar && document.activeElement !== seekBar) seekBar.value = g;
    }
  }
  function syncButtons() {
    document.querySelectorAll("[data-scene]").forEach(b => {
      b.classList.toggle("active", b.dataset.scene === scene);
    });
  }

  const pauseBtn = document.getElementById("pauseBtn");
  const soundBtn = document.getElementById("soundBtn");
  const crtBtn = document.getElementById("crtBtn");
  const crtOverlay = document.getElementById("crtOverlay");

  function togglePause(force) {
    if (force === undefined && paused && pauseBtn && pauseBtn.textContent === "REPLAY") {
      loop = true;
      buildScene("boot");
      paused = false;
      pauseBtn.textContent = "PAUSE";
      return;
    }
    paused = force === undefined ? !paused : force;
    music.pause(paused);
    if (pauseBtn) pauseBtn.textContent = paused ? "RESUME" : "PAUSE";
  }
  async function toggleSound() {
    const on = await music.toggle();
    if (soundBtn) {
      soundBtn.textContent = on ? "SOUND ON" : "SOUND OFF";
      soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    return on;
  }
  const trackSel = document.getElementById("trackSel");
  if (trackSel) trackSel.addEventListener("change", () => music.setTrack(trackSel.value));
  function toggleCRT() {
    const off = crtOverlay.classList.toggle("off");
    if (crtBtn) {
      crtBtn.textContent = off ? "CRT OFF" : "CRT ON";
      crtBtn.setAttribute("aria-pressed", off ? "false" : "true");
    }
    return !off;
  }

  if (pauseBtn) pauseBtn.addEventListener("click", () => togglePause());
  if (soundBtn) soundBtn.addEventListener("click", () => toggleSound());
  if (crtBtn) crtBtn.addEventListener("click", () => toggleCRT());
  document.querySelectorAll("[data-scene]").forEach(b => {
    b.addEventListener("click", () => buildScene(b.dataset.scene));
  });

  /* ------------------------------------------------------------
     main loop
     ------------------------------------------------------------ */
  let last = performance.now();
  let hudAcc = 0;

  // Scenes the original shows inside a centred 256x133 window: the whole 320x200 frame is scaled by 0.8 x 2/3
  // (measured on the original screenshots; it gives square pixels on a 4:3 screen).
  const WINDOWED = new Set(["plasma", "fractal", "cube", "slime", "tunnel", "intro"]);
  const winSrc = new Uint32Array(W * H);
  function presentWindow() {
    winSrc.set(px); px.fill(0xff000000);
    for (let y = 0; y < 133; y++) {
      const sy = Math.min(H - 1, Math.floor(y * 200 / 133)) * W, o = (34 + y) * W + 32;
      for (let x = 0; x < 256; x++) px[o + x] = winSrc[sy + Math.floor(x * 320 / 256)];
    }
  }
  function render(dt) {
    const t = sceneT;
    if (scene === "boot") drawBoot(t);
    else if (scene === "intro") INTRO.draw(Math.floor(t * 70));
    else if (scene === "plasma") drawPlasma(t);
    else if (scene === "cube") drawCube(t);
    else if (scene === "fractal") drawFractal(t, dt);
    else if (scene === "slime") drawSlime(t);
    else if (scene === "tunnel") drawTunnel(t);
    else if (scene === "pictures") drawPicture(t);
    else if (scene === "earth") drawEarth(t);
    else if (scene === "chess") drawChess(t);
    else if (scene === "end") drawEnd(t);
    if (WINDOWED.has(scene)) presentWindow();
    if (scene !== "pictures" && scene !== "end") ctx.putImageData(imageData, 0, 0);
  }

  /* timeline: scenes laid end to end, seekable while playing or paused */
  const TOTAL = ORDER.reduce((a, n) => a + SCENES[n].dur, 0);
  const seekBar = document.getElementById("seekBar");
  const seekMarks = document.getElementById("seekMarks");
  const hudTotal = document.getElementById("hudTotal");
  function globalT() {
    let a = 0;
    for (const n of ORDER) { if (n === scene) break; a += SCENES[n].dur; }
    return a + Math.min(sceneT, SCENES[scene].dur);
  }
  function seek(g) {
    g = clamp(g, 0, TOTAL - 0.01);
    for (const n of ORDER) {
      const d = SCENES[n].dur;
      if (g < d) {
        if (n !== scene) buildScene(n);
        sceneT = g;
        render(0.016);
        updateHud();
        music.seek(globalT());
        return;
      }
      g -= d;
    }
  }
  if (seekMarks) {
    let a = 0;
    for (const n of ORDER) {
      const m = document.createElement("i");
      m.style.left = (a / TOTAL * 100) + "%";
      m.title = SCENES[n].label;
      seekMarks.appendChild(m);
      a += SCENES[n].dur;
    }
  }
  if (seekBar) {
    seekBar.max = TOTAL; seekBar.step = 0.1;
    seekBar.addEventListener("input", () => seek(+seekBar.value));
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (visible && !paused) {
      sceneT += dt;
      frame++;
      const def = SCENES[scene];
      if (sceneT > def.dur) {
        if (loop) {
          if (scene === "end") buildScene("boot");
          else nextScene();
        } else if (scene === "end") {
          pauseBtn && (pauseBtn.textContent = "REPLAY");
          paused = true;
        }
      }
      render(dt);
      hudAcc += dt;
      if (hudAcc > 0.2) { hudAcc = 0; updateHud(); }
    }
    requestAnimationFrame(tick);
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) visible = e.isIntersecting;
    }, { threshold: 0.05 });
    io.observe(canvas);
  }

  /* start */
  buildScene("boot");
  requestAnimationFrame(tick);

  /* keyboard */
  window.addEventListener("keydown", e => {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (!visible) return;
    const k = e.key.toLowerCase();
    if (k === "1") { buildScene("plasma"); e.preventDefault(); }
    else if (k === "2") { buildScene("pictures"); e.preventDefault(); }
    else if (k === "3") { buildScene("end"); e.preventDefault(); }
    else if (k === "0") { buildScene("boot"); e.preventDefault(); }
    else if (k === "4") { buildScene("cube"); e.preventDefault(); }
    else if (k === "5") { buildScene("fractal"); e.preventDefault(); }
    else if (k === "9") { buildScene("tunnel"); e.preventDefault(); }
    else if (k === "8") { buildScene("slime"); e.preventDefault(); }
    else if (k === "6") { buildScene("earth"); e.preventDefault(); }
    else if (k === "7") { buildScene("chess"); e.preventDefault(); }
    else if (k === "l") { loop = !loop; toast(loop ? "LOOP ON" : "LOOP OFF"); e.preventDefault(); }
    else if (k === "h") { toast("1–3 original start modes · 0/4–7 extra scenes · L loop · ←/→ seek · Space pause · M mute"); e.preventDefault(); }
    else if (k === " ") { togglePause(); e.preventDefault(); }
    else if (k === "m") { toggleSound(); e.preventDefault(); }
    else if (k === "n") { nextScene(); e.preventDefault(); }
    else if (k === "arrowright") { seek(globalT() + 5); e.preventDefault(); }
    else if (k === "arrowleft") { seek(globalT() - 5); e.preventDefault(); }
  });

  function toast(msg) {
    let el = document.getElementById("cd2Toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "cd2Toast";
      el.style.cssText = "position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:200;background:#0b0f16;border:1px solid rgba(255,255,255,.18);color:#ece9e2;font:10px ui-monospace,monospace;letter-spacing:.12em;padding:10px 16px;pointer-events:none;transition:opacity .3s;text-transform:uppercase";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = "0"; }, 1800);
  }

  window.CD2 = {
    jump: buildScene,
    next: nextScene,
    pause: togglePause,
    music,
    seek,
    sound: toggleSound,
    crt: toggleCRT,
    loop: (v) => { loop = v === undefined ? !loop : !!v; return loop; }
  };
})();
