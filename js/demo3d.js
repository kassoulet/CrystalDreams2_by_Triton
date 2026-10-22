/* Tiny software 3D renderer for the .TVO models decoded from CD2.EXE (assets/orig/objects.json).
   Painter's algorithm, flat or textured triangles, drawn into a Uint32 RGBA buffer.
   The 320x200 screen is shown at 4:3, so pixels are 1.2x taller than wide: projection divides y by PIXEL_ASPECT. */
(function (root) {
  "use strict";
  const PIXEL_ASPECT = 1.2;
  const models = {};
  let loading = null;

  function prep(o) {
    const n = o.v.length / 3;
    const faces = o.f.map(f => ({ i: f.slice(0, -1), c: f[f.length - 1] }));
    return { n, v: Float32Array.from(o.v), faces };
  }
  function load(url) {
    if (!loading) loading = fetch(url).then(r => r.json()).then(o => { for (const k in o) models[k] = prep(o[k]); return models; });
    return loading;
  }

  /* 3x4 matrices as 12-element arrays, row-major: [r00 r01 r02 tx, r10 ...] */
  function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; }
  function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; }
  function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; }
  function mul(a, b) { // a*b, both 3x4 (affine)
    const r = new Array(12);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) r[i * 4 + j] = a[i * 4] * b[j] + a[i * 4 + 1] * b[4 + j] + a[i * 4 + 2] * b[8 + j];
      r[i * 4 + 3] = a[i * 4] * b[3] + a[i * 4 + 1] * b[7] + a[i * 4 + 2] * b[11] + a[i * 4 + 3];
    }
    return r;
  }
  function trans(x, y, z) { return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]; }
  function scale(s) { return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0]; }

  function rgba(r, g, b) { return (255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255); }

  class Renderer {
    constructor(W, H) {
      this.W = W; this.H = H; this.buf = new Uint32Array(W * H);
      this.f = W * 0.9;                 // focal length in pixels
      this.xl = new Int32Array(H); this.xr = new Int32Array(H);
    }
    clear(c) { this.buf.fill(c); }
    // flat triangle, convex scanline fill
    tri(x0, y0, x1, y1, x2, y2, col) {
      const W = this.W, H = this.H, xl = this.xl, xr = this.xr, buf = this.buf;
      let ymin = Math.max(0, Math.floor(Math.min(y0, y1, y2))), ymax = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (ymin > ymax) return;
      for (let y = ymin; y <= ymax; y++) { xl[y] = 1e9; xr[y] = -1e9; }
      const edge = (ax, ay, bx, by) => {
        if (ay === by) return;
        if (ay > by) { let t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; }
        const ys = Math.max(ymin, Math.ceil(ay - 0.5)), ye = Math.min(ymax, Math.floor(by - 0.5));
        const dx = (bx - ax) / (by - ay);
        for (let y = ys; y <= ye; y++) {
          const x = ax + (y + 0.5 - ay) * dx;
          if (x < xl[y]) xl[y] = x; if (x > xr[y]) xr[y] = x;
        }
      };
      edge(x0, y0, x1, y1); edge(x1, y1, x2, y2); edge(x2, y2, x0, y0);
      for (let y = ymin; y <= ymax; y++) {
        let a = Math.ceil(xl[y] - 0.5), b = Math.floor(xr[y] - 0.5);
        if (a < 0) a = 0; if (b > W - 1) b = W - 1;
        for (let x = a, o = y * W + a; x <= b; x++, o++) buf[o] = col;
      }
    }
    // textured triangle (affine), tex = {w,h,data:Uint32Array}; shade 0..1 multiplies the texel
    triTex(p0, p1, p2, tex, shade) {
      const W = this.W, H = this.H, buf = this.buf;
      const minx = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0]))), maxx = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
      const miny = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1]))), maxy = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
      const d = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
      if (Math.abs(d) < 1e-6) return;
      const sh = Math.max(0, Math.min(1.2, shade));
      for (let y = miny; y <= maxy; y++) {
        for (let x = minx; x <= maxx; x++) {
          const px = x + 0.5, py = y + 0.5;
          const a = ((p1[1] - p2[1]) * (px - p2[0]) + (p2[0] - p1[0]) * (py - p2[1])) / d;
          const b = ((p2[1] - p0[1]) * (px - p2[0]) + (p0[0] - p2[0]) * (py - p2[1])) / d;
          const c = 1 - a - b;
          if (a < -0.001 || b < -0.001 || c < -0.001) continue;
          const u = a * p0[2] + b * p1[2] + c * p2[2], v = a * p0[3] + b * p1[3] + c * p2[3];
          let tx = Math.floor(u * tex.w) % tex.w, ty = Math.floor(v * tex.h) % tex.h;
          if (tx < 0) tx += tex.w; if (ty < 0) ty += tex.h;
          const t = tex.data[ty * tex.w + tx];
          const r = Math.min(255, (t & 255) * sh), g = Math.min(255, ((t >> 8) & 255) * sh), bl = Math.min(255, ((t >> 16) & 255) * sh);
          buf[y * W + x] = (255 << 24) | (bl << 16) | (g << 8) | r;
        }
      }
    }
    // transform model vertices into camera space with m (3x4); returns Float32Array xyz
    xform(model, m) {
      const n = model.n, v = model.v, out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
        out[i * 3] = m[0] * x + m[1] * y + m[2] * z + m[3];
        out[i * 3 + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
        out[i * 3 + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
      }
      return out;
    }
    // flat-shaded model. light: unit vector in camera space. base: [r,g,b]. opts.ambient
    drawModel(model, m, base, light, opts) {
      opts = opts || {};
      const amb = opts.ambient === undefined ? 0.28 : opts.ambient;
      const c = this.xform(model, m), W = this.W, H = this.H, f = this.f;
      const sx = new Float32Array(model.n), sy = new Float32Array(model.n);
      for (let i = 0; i < model.n; i++) {
        const z = c[i * 3 + 2];
        sx[i] = W / 2 + f * c[i * 3] / z;
        sy[i] = H / 2 - f * c[i * 3 + 1] / z / PIXEL_ASPECT;
      }
      const list = [];
      const faces = model.faces;
      for (let k = 0; k < faces.length; k++) {
        const idx = faces[k].i; let zs = 0, ok = true;
        for (let j = 0; j < idx.length; j++) { const z = c[idx[j] * 3 + 2]; if (z < 1) { ok = false; break; } zs += z; }
        if (ok) list.push([zs / idx.length, k]);
      }
      list.sort((a, b) => b[0] - a[0]);
      for (const [, k] of list) {
        const idx = faces[k].i, a = idx[0], b = idx[1], d = idx[2];
        const ux = c[b * 3] - c[a * 3], uy = c[b * 3 + 1] - c[a * 3 + 1], uz = c[b * 3 + 2] - c[a * 3 + 2];
        const vx = c[d * 3] - c[a * 3], vy = c[d * 3 + 1] - c[a * 3 + 1], vz = c[d * 3 + 2] - c[a * 3 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const lam = Math.abs(nx * light[0] + ny * light[1] + nz * light[2]);
        const s = amb + (1 - amb) * lam;
        const col = rgba(base[0] * s, base[1] * s, base[2] * s);
        for (let j = 1; j < idx.length - 1; j++) this.tri(sx[idx[0]], sy[idx[0]], sx[idx[j]], sy[idx[j]], sx[idx[j + 1]], sy[idx[j + 1]], col);
      }
    }
    // textured quad given 4 camera-space points [x,y,z] and uv per corner, split into n x n sub-quads (affine mapping)
    texQuad(c, uv, tex, shade, n) {
      const W = this.W, H = this.H, f = this.f;
      const lerp2 = (i, j, a, b) => {            // bilinear point inside the quad
        const w = [(1 - a) * (1 - b), a * (1 - b), a * b, (1 - a) * b];
        const p = [0, 0, 0, 0, 0];
        for (let k = 0; k < 4; k++) { const q = [0, 1, 2, 3][k]; p[0] += w[k] * c[q][0]; p[1] += w[k] * c[q][1]; p[2] += w[k] * c[q][2]; p[3] += w[k] * uv[q][0]; p[4] += w[k] * uv[q][1]; }
        return p;
      };
      const pr = p => [W / 2 + f * p[0] / p[2], H / 2 - f * p[1] / p[2] / PIXEL_ASPECT, p[3], p[4]];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const a0 = i / n, a1 = (i + 1) / n, b0 = j / n, b1 = (j + 1) / n;
        const P = [lerp2(0, 0, a0, b0), lerp2(0, 0, a1, b0), lerp2(0, 0, a1, b1), lerp2(0, 0, a0, b1)];
        if (P.some(q => q[2] < 1)) continue;
        const Q = P.map(pr);
        this.triTex(Q[0], Q[1], Q[2], tex, shade); this.triTex(Q[0], Q[2], Q[3], tex, shade);
      }
    }
    // textured sphere-ish model: uv from object-space position (equirectangular), shaded
    drawTexturedSphere(model, m, tex, light, radius) {
      const c = this.xform(model, m), W = this.W, H = this.H, f = this.f;
      const uv = new Float32Array(model.n * 2);
      for (let i = 0; i < model.n; i++) {
        const x = model.v[i * 3], y = model.v[i * 3 + 1], z = model.v[i * 3 + 2];
        uv[i * 2] = Math.atan2(x, z) / (2 * Math.PI) + 0.5;
        uv[i * 2 + 1] = 0.5 - Math.asin(Math.max(-1, Math.min(1, y / radius))) / Math.PI;
      }
      const list = [];
      model.faces.forEach((fc, k) => { let z = 0; for (const i of fc.i) z += c[i * 3 + 2]; list.push([z / fc.i.length, k]); });
      list.sort((a, b) => b[0] - a[0]);
      const P = i => [W / 2 + f * c[i * 3] / c[i * 3 + 2], H / 2 - f * c[i * 3 + 1] / c[i * 3 + 2] / PIXEL_ASPECT];
      const c0 = [m[3], m[7], m[11]];
      for (const [, k] of list) {
        const idx = model.faces[k].i;
        let cx = 0, cy = 0, cz = 0;
        for (const i of idx) { cx += c[i * 3]; cy += c[i * 3 + 1]; cz += c[i * 3 + 2]; }
        cx /= idx.length; cy /= idx.length; cz /= idx.length;
        let ox = cx - c0[0], oy = cy - c0[1], oz = cz - c0[2];            // outward direction of this patch
        const ol = Math.hypot(ox, oy, oz) || 1; ox /= ol; oy /= ol; oz /= ol;
        if (ox * -cx + oy * -cy + oz * -cz <= 0) continue;                // facing away from the camera
        const shade = 0.22 + 0.98 * Math.max(0, ox * light[0] + oy * light[1] + oz * light[2]);
        const pts = idx.map(i => { const p = P(i); return [p[0], p[1], uv[i * 2], uv[i * 2 + 1]]; });
        // fix texture seam
        for (let j = 1; j < pts.length; j++) { if (pts[j][2] - pts[0][2] > 0.5) pts[j][2] -= 1; else if (pts[0][2] - pts[j][2] > 0.5) pts[j][2] += 1; }
        for (let j = 1; j < pts.length - 1; j++) this.triTex(pts[0], pts[j], pts[j + 1], tex, shade);
      }
    }
  }


  /* ---------------- scenes built from the decoded data ---------------- */
  function normalize(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function rotateVec(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]]; }
  // world (X right, Y depth, Z up) -> camera (x right, y up, z forward): orbit by az, tilt el, distance D around target T
  function orbit(az, el, D, T) {
    const S = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0];
    return mul(trans(0, 0, D), mul(rotX(el), mul(S, mul(rotZ(az), trans(-T[0], -T[1], -T[2])))));
  }
  // Board model NC-MB3: playing surface at z=0, walls below it (z points DOWN), 4x4 squares of 16000;
  // the pieces are 13104 wide, i.e. 82% of a square, so this model is a 4x4 board. The arrangement below is mine.
  const SQ = 16000;
  const ROW = ['Towr', 'Quen', 'King', 'Hrse'];
  function chessPieces() {
    const out = [], c = f => -32000 + SQ / 2 + f * SQ;
    for (let f = 0; f < 4; f++) {
      out.push({ n: 'NCL-' + ROW[f], x: c(f), y: c(0), light: true }); out.push({ n: 'NCD-' + ROW[3 - f], x: c(f), y: c(3), light: false });
      out.push({ n: 'NCL-Bond', x: c(f), y: c(1), light: true }); out.push({ n: 'NCD-Bond', x: c(f), y: c(2), light: false });
    }
    return out;
  }
  function chessFrame(r, t, marble) {
    const M = models; if (!M['NC-MB3']) return false;
    r.clear(rgba(8, 10, 18));
    const az = 0.5 + t * 0.18, el = 0.34 + 0.12 * Math.sin(t * 0.35), D = 118000 - 22000 * Math.min(1, t / 6);
    const V = orbit(az, el, D, [0, 0, 9000]);
    const lw = normalize([Math.cos(t * 0.9), Math.sin(t * 0.9), 0.9]);             // moving light, world space (Z up)
    const lc = normalize(rotateVec(V, lw));
    const FLIP = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0];                               // model z-down -> world z-up
    r.drawModel(M['NC-MB3'], mul(V, FLIP), [70, 74, 92], lc, { ambient: 0.35 });      // slab walls (its top faces get covered below)
    const cam = (x, y, z) => [V[0] * x + V[1] * y + V[2] * z + V[3], V[4] * x + V[5] * y + V[6] * z + V[7], V[8] * x + V[9] * y + V[10] * z + V[11]];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const x0 = -32000 + sx * SQ, y0 = -32000 + sy * SQ, dark = (sx + sy) & 1;
      const u0 = sx * 0.2, v0 = sy * 0.3;
      const quad = [cam(x0, y0, 0), cam(x0 + SQ, y0, 0), cam(x0 + SQ, y0 + SQ, 0), cam(x0, y0 + SQ, 0)];
      const uv = [[u0, v0], [u0 + 0.2, v0], [u0 + 0.2, v0 + 0.3], [u0, v0 + 0.3]];
      r.texQuad(quad, uv, marble || { w: 1, h: 1, data: new Uint32Array([rgba(160, 160, 170)]) }, dark ? 0.42 : 1.05, 4);
    }
    // pieces: model y is up -> world z, model z -> world y
    const P = [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0];
    const list = chessPieces().map(p => ({ p, d: (V[8] * p.x + V[9] * p.y + V[11]) })).sort((a, b) => b.d - a.d);
    for (const { p } of list) {
      const m = mul(V, mul(trans(p.x, p.y, 0), P));
      r.drawModel(M[p.n], m, p.light ? [236, 226, 196] : [96, 64, 48], lc, { ambient: 0.3 });
    }
    return true;
  }
  function earthFrame(r, t, tex) {
    const M = models; if (!M['Earth3'] || !tex) return false;
    r.clear(rgba(0, 0, 6));
    const V = mul(trans(0, 0, 105000), mul(rotX(0.35), rotY(t * 0.5)));
    const lc = normalize([0.55, 0.35, -0.75]);
    r.drawTexturedSphere(M['Earth3'], V, tex, lc, 30000);
    return true;
  }

  root.CD2_3D = { chessFrame, earthFrame, chessPieces, orbit, PIXEL_ASPECT, models, load, Renderer, rotX, rotY, rotZ, mul, trans, scale, rgba };
})(typeof window !== "undefined" ? window : globalThis);
