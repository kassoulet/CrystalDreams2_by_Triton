/* ============================================================
   CD2 / FIELD NOTES — page behaviour
   Header state, section nav, reveals, ASM colouring, copy
   buttons, and the ambient plasma behind the hero.
   ============================================================ */
(function () {
  "use strict";

  const doc = document;
  const reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------
     header + section navigation
     ------------------------------------------------------------ */
  const header = doc.querySelector(".site-head");
  const nav = doc.getElementById("siteNav");
  const navToggle = doc.getElementById("navToggle");
  const navLinks = Array.from(doc.querySelectorAll(".site-nav a"));
  const sections = navLinks
    .map(a => doc.querySelector(a.getAttribute("href")))
    .filter(Boolean);

  let activeHref = "";

  function updateHeader() {
    if (header) header.classList.toggle("scrolled", window.scrollY > 8);

    let current = "";
    for (const section of sections) {
      const r = section.getBoundingClientRect();
      if (r.top <= 150 && r.bottom > 150) {
        current = "#" + section.id;
        break;
      }
    }
    if (current !== activeHref) {
      activeHref = current;
      for (const a of navLinks) {
        const on = a.getAttribute("href") === current;
        a.classList.toggle("active", on);
        if (on) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      }
    }
  }

  let scrollQueued = false;
  function onScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      updateHeader();
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  updateHeader();

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    navLinks.forEach(a => a.addEventListener("click", closeNav));
    doc.addEventListener("click", e => {
      if (!nav.classList.contains("open")) return;
      if (nav.contains(e.target) || navToggle.contains(e.target)) return;
      closeNav();
    });
    doc.addEventListener("keydown", e => {
      if (e.key === "Escape") closeNav();
    });
  }

  /* ------------------------------------------------------------
     scroll reveals
     ------------------------------------------------------------ */
  const revealGroups = [
    [".section-head", 0],
    [".scene-strip .shot", 55],
    [".filebar", 0],
    [".note-grid", 0],
    [".code-card", 0],
    [".callout", 0],
    [".asm-grid .asm-card", 55],
    [".faith-grid .faith", 55],
    [".method-grid .method", 55],
    [".player-shell", 0],
    [".appendix-tables", 0],
    [".refs", 0]
  ];

  const revealEls = [];
  for (const [selector, stagger] of revealGroups) {
    doc.querySelectorAll(selector).forEach((el, i) => {
      if (el.closest(".appendix-tables") && !el.classList.contains("appendix-tables")) return;
      if (revealEls.includes(el)) return;
      el.classList.add("reveal");
      if (stagger) el.style.transitionDelay = ((i % 6) * stagger) + "ms";
      revealEls.push(el);
    });
  }
  doc.querySelectorAll(".table-card").forEach(el => {
    if (el.closest(".appendix-tables")) return;
    if (revealEls.includes(el)) return;
    el.classList.add("reveal");
    revealEls.push(el);
  });

  if (!reduceMotion && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });

    for (const el of revealEls) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.94) el.classList.add("in");
      else io.observe(el);
    }
  } else {
    revealEls.forEach(el => el.classList.add("in"));
  }

  /* ------------------------------------------------------------
     x86 syntax colouring
     ------------------------------------------------------------ */
  const MNEMONICS = new Set((
    "mov movsb movsw movsd stosb stosw stosd lodsb lodsw lodsd " +
    "xchg add adc sub sbb cmp test jmp jz jnz jc jnc ja jae jb jbe " +
    "jg jge jl jle js jns jo jno call ret retf push pop pushf popf " +
    "pusha popa cli sti cld std shl shr shld shrd sal sar rcl rcr " +
    "rol ror imul mul idiv div neg not inc dec and or xor out in int " +
    "loop loope loopne enter leave les lds lea rep repe repne nop " +
    "cbw cwd cdq lahf sahf xlat scasb cmpsb dw db dd equ org"
  ).split(" "));
  const REGISTERS = new Set((
    "ax bx cx dx si di bp sp al ah bl bh cl ch dl dh " +
    "eax ebx ecx edx esi edi ebp esp " +
    "cs ds es fs gs ss cr0 cr2 cr3 cr4 dr0 dr1 dr2 dr3 dr6 dr7 " +
    "st0 st1 st2 st3 st4 st5 st6 st7"
  ).split(" "));

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => ESC[ch]);
  }
  function span(cls, text) {
    return '<span class="' + cls + '">' + esc(text) + "</span>";
  }

  function findComment(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === quote && line[i - 1] !== "\\") quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ";") {
        return i;
      }
    }
    return -1;
  }

  function tokenize(body) {
    let out = "";
    let i = 0;
    while (i < body.length) {
      const ch = body[i];

      if (/\s/.test(ch)) { out += ch; i++; continue; }

      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < body.length && body[j] !== ch) j++;
        out += span("s", body.slice(i, j + 1));
        i = j + 1;
        continue;
      }

      if (ch === ".") {
        const label = body.slice(i).match(/^\.[A-Za-z_][\w.]*/);
        if (label) {
          out += span("l", label[0]);
          i += label[0].length;
          continue;
        }
      }

      const word = body.slice(i).match(/^[A-Za-z_][\w.]*/);
      if (word) {
        const w = word[0];
        const lw = w.toLowerCase();
        if (lw === "word" || lw === "byte" || lw === "far" || lw === "near" || lw === "ptr") {
          out += span("m", w);
        } else if (MNEMONICS.has(lw)) {
          out += span("m", w);
        } else if (REGISTERS.has(lw)) {
          out += span("r", w);
        } else {
          out += esc(w);
        }
        i += w.length;
        continue;
      }

      const num = body.slice(i).match(/^(0x[0-9A-Fa-f]+|[0-9][0-9A-Fa-f]*h?)/);
      if (num) {
        out += span("n", num[0]);
        i += num[0].length;
        continue;
      }

      out += esc(ch);
      i++;
    }
    return out;
  }

  function highlightAsm(source) {
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    return lines.map(line => {
      const cut = findComment(line);
      let body = cut >= 0 ? line.slice(0, cut) : line;
      const comment = cut >= 0 ? line.slice(cut) : "";
      let out = "";

      const addr = body.match(/^([0-9A-Fa-f]{4,6})([ \t]+)/);
      if (addr) {
        out += span("a", addr[1]) + addr[2];
        body = body.slice(addr[0].length);
      }

      const bytes = body.match(/^((?:[0-9A-Fa-f]{2}(?:[ \t]+|$))+)/);
      if (bytes) {
        out += span("b", bytes[1].replace(/[ \t]+$/, "")) + " ";
        body = body.slice(bytes[0].length);
      }

      out += tokenize(body);
      if (comment) out += span("c", comment);
      return out;
    }).join("\n");
  }

  doc.querySelectorAll("code.asm").forEach(code => {
    if (code.dataset.highlighted) return;
    code.dataset.highlighted = "1";
    code.innerHTML = highlightAsm(code.textContent);
  });

  /* ------------------------------------------------------------
     copy buttons
     ------------------------------------------------------------ */
  function fallbackCopy(text) {
    const ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand("copy"); } catch (e) { /* nothing else to try */ }
    doc.body.removeChild(ta);
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (e) { /* fall through */ }
    }
    fallbackCopy(text);
    return true;
  }

  doc.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".code-card") || btn.closest("figure");
      const code = card && card.querySelector("pre code");
      const text = code ? code.textContent : "";
      if (!text) return;
      const old = btn.textContent;
      const ok = await copyText(text);
      btn.textContent = ok ? "Copied" : "Copy failed";
      btn.classList.toggle("done", ok);
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => {
        btn.textContent = old;
        btn.classList.remove("done");
      }, 1400);
    });
  });

  /* ------------------------------------------------------------
     hero: slow ambient plasma on the original 320x200 grid
     ------------------------------------------------------------ */
  const hero = doc.getElementById("heroCanvas");
  if (hero) {
    const hctx = hero.getContext("2d", { alpha: false });
    if (hctx) {
      const HW = 320, HH = 200;
      const off = doc.createElement("canvas");
      off.width = HW; off.height = HH;
      const octx = off.getContext("2d", { alpha: false });
      const frame = octx.createImageData(HW, HH);
      const buf = new Uint32Array(frame.data.buffer);
      const palette = new Uint32Array(256);
      const SIN = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) SIN[i] = Math.sin(i * Math.PI * 2 / 1024);

      const stops = [
        [0.00, [3, 6, 10]],
        [0.16, [6, 20, 28]],
        [0.34, [9, 62, 74]],
        [0.50, [17, 128, 136]],
        [0.64, [74, 214, 204]],
        [0.76, [154, 63, 128]],
        [0.88, [242, 92, 162]],
        [1.00, [255, 196, 120]]
      ];
      function mixPalette() {
        for (let i = 0; i < 256; i++) {
          const t = i / 255;
          let a = stops[0], b = stops[stops.length - 1];
          for (let s = 1; s < stops.length; s++) {
            if (t <= stops[s][0]) { a = stops[s - 1]; b = stops[s]; break; }
          }
          const k = (t - a[0]) / Math.max(0.0001, b[0] - a[0]);
          const r = (a[1][0] + (b[1][0] - a[1][0]) * k) | 0;
          const g = (a[1][1] + (b[1][1] - a[1][1]) * k) | 0;
          const bl = (a[1][2] + (b[1][2] - a[1][2]) * k) | 0;
          palette[i] = (255 << 24) | (bl << 16) | (g << 8) | r;
        }
      }
      mixPalette();

      const stars = [];
      for (let i = 0; i < 54; i++) {
        stars.push({
          x: (Math.random() * HW) | 0,
          y: (Math.random() * HH) | 0,
          p: Math.random() * Math.PI * 2,
          s: 0.6 + Math.random() * 1.4
        });
      }

      hctx.imageSmoothingEnabled = false;

      let heroVisible = true;
      let heroTime = 0;
      let last = 0;

      function paint(t) {
        const px = (t * 70) | 0;
        const py = (t * 47) | 0;
        const pd = (t * 93) | 0;
        for (let y = 0; y < HH; y++) {
          const sy = SIN[(y * 7 + py) & 1023];
          const row = y * HW;
          for (let x = 0; x < HW; x++) {
            const v = SIN[(x * 5 + px) & 1023] + sy + SIN[((x + y) * 4 + pd) & 1023];
            let idx = ((v + 3) * 42.5) | 0;
            if (idx < 0) idx = 0; else if (idx > 255) idx = 255;
            buf[row + x] = palette[idx];
          }
        }
        for (const s of stars) {
          const tw = 0.5 + 0.5 * Math.sin(t * s.s + s.p);
          if (tw < 0.72) continue;
          const x = (s.x + ((t * 2.2) | 0)) % HW;
          const y = s.y;
          const idx = 225 + ((tw * 30) | 0);
          buf[y * HW + x] = palette[idx];
        }
        octx.putImageData(frame, 0, 0);
        hctx.drawImage(off, 0, 0, hero.width, hero.height);
      }

      function heroLoop(now) {
        if (!last) last = now;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (heroVisible && !doc.hidden && !reduceMotion) {
          heroTime += dt;
          paint(heroTime);
        }
        requestAnimationFrame(heroLoop);
      }

      if (reduceMotion) {
        paint(0.7);
      } else {
        paint(0);
        requestAnimationFrame(heroLoop);
        if ("IntersectionObserver" in window) {
          new IntersectionObserver(entries => {
            for (const e of entries) heroVisible = e.isIntersecting;
          }, { threshold: 0 }).observe(hero);
        }
        doc.addEventListener("visibilitychange", () => { last = 0; });
      }
    }
  }

  /* ------------------------------------------------------------
     tiny page-level toast (the demo has its own)
     ------------------------------------------------------------ */
  function siteToast(msg) {
    let el = doc.getElementById("siteToast");
    if (!el) {
      el = doc.createElement("div");
      el.id = "siteToast";
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:300;" +
        "background:#0b0f16;border:1px solid rgba(255,255,255,.18);color:#ece9e2;" +
        "font:10px ui-monospace,monospace;letter-spacing:.12em;padding:10px 16px;" +
        "pointer-events:none;transition:opacity .3s;text-transform:uppercase;text-align:center";
      doc.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.opacity = "0"; }, 2400);
  }

  doc.addEventListener("keydown", e => {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === "?") {
      e.preventDefault();
      siteToast("In the player: 1 plasma · 2 pictures · 3 endpart · L loop · Space pause · M mute");
    }
  });
})();
