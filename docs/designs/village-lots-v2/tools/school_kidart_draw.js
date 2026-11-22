/**
 * 케이슨 마을 학교 교실 — the classroom's paper things, drawn in a headless Chromium canvas (school_kidart.mjs loads this file
 * into a blank page and calls `window.drawCell(name)`). Owner 2026-11-20: "학교에 걸린 그림액자도 너무 허접해 진짜 학생들이 그린
 * 그림같은 걸 걸어두라고".
 *
 * Everything is procedural and seeded (no fonts for the children's writing, no downloaded art):
 *  - a paper model: per-pixel tooth (fine grain + fibres + clumps) as a height field, slight off-white tint, a few soft crinkles;
 *  - media simulated against that tooth: wax crayon (deposits on the peaks, white specks in the valleys, waxy build-up where strokes
 *    overlap), coloured pencil (thin, light, grainy), felt-tip marker (flat, streaky, darker overlaps, a hair of bleed) and
 *    watercolour (soft wet edges with a darker rim, granulation, cockled paper);
 *  - a child's hand: tremor on every line, shapes that do not close or overlap their start, scribble fill that runs back and forth
 *    and out of the lines, uneven pressure, big heads and stick arms;
 *  - Hangul written stroke by stroke from jamo (a child's 받침 layout with wobbly, uneven letters), plus a few printed classroom
 *    sheets (labels, the timetable, the ㄱㄴㄷ cards, the clock face) set in the system's 맑은 고딕;
 *  - the chalkboard: slate green with a soft eraser haze and the teacher's chalk writing (same hand engine, steadier).
 * Each cell returns its colour (sRGB) and a height map (0..1; the normal map is derived from it) and a roughness value per pixel.
 */
(() => {
  "use strict";

  // ------------------------------------------------------------------------------------------------ seeded random, noise --
  function rng(seed) {
    let s = (seed * 2654435761) >>> 0 || 1;
    const f = () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
    f.range = (a, b) => a + (b - a) * f();
    f.int = (a, b) => Math.floor(a + (b - a + 1) * f());
    f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
    f.gauss = () => (f() + f() + f() - 1.5) / 0.75;
    return f;
  }
  function noise2(seed) {
    const r = rng(seed);
    const P = new Uint16Array(512);
    const G = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; G[i] = r() * 2 - 1; }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = P[i]; P[i] = P[j]; P[j] = t; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const fade = (t) => t * t * (3 - 2 * t);
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const a = G[P[(xi & 255) + P[yi & 255]]], b = G[P[((xi + 1) & 255) + P[yi & 255]]];
      const c = G[P[(xi & 255) + P[(yi + 1) & 255]]], d = G[P[((xi + 1) & 255) + P[(yi + 1) & 255]]];
      const u = fade(xf), v = fade(yf);
      return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    };
    n.fbm = (x, y, oct = 4) => {
      let s = 0, amp = 0.5, f = 1;
      for (let i = 0; i < oct; i++) { s += amp * n(x * f, y * f); f *= 2.03; amp *= 0.5; }
      return s;
    };
    return n;
  }
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // -------------------------------------------------------------------------------------------------------- the sheet --
  /**
   * A sheet: colour (Float32 RGB 0..255), height (Float32 0..1), roughness (Float32 0..1), the paper's tooth (Float32 0..1),
   * and a scratch canvas for stroke coverage.
   */
  function Sheet(W, H, seed, paper = {}) {
    const S = { W, H, seed, r: rng(seed), n: noise2(seed + 7) };
    const N = W * H;
    S.col = new Float32Array(N * 3);
    S.hgt = new Float32Array(N);
    S.rough = new Float32Array(N);
    S.tooth = new Float32Array(N);
    const base = hex(paper.colour || "#FBF8F1");
    const grainScale = paper.grain ?? 1;
    // tooth: fine random grain softened a little, fibres (short streaks), larger clumps
    const white = new Float32Array(N);
    const r = S.r;
    for (let i = 0; i < N; i++) white[i] = r();
    const soft = new Float32Array(N);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const w = dx === 0 && dy === 0 ? 2 : 1;
            s += white[yy * W + xx] * w; c += w;
          }
        soft[y * W + x] = s / c;
      }
    const n = S.n;
    const fib = noise2(seed + 99);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const clump = n.fbm(x / 3.2, y / 3.2, 3);
        const fibre = Math.abs(fib(x / 2.2 + y / 14, y / 22 - x / 40)) < 0.035 ? 0.18 : 0;
        S.tooth[i] = clamp(0.5 + (soft[i] - 0.5) * 1.9 * grainScale + clump * 0.7 * grainScale + fibre);
      }
    // crinkles: a few long soft creases (a sheet carried home in a bag) and a gentle cockle
    const creases = [];
    const nc = paper.creases ?? r.int(1, 3);
    for (let k = 0; k < nc; k++) {
      const a = r() * Math.PI;
      creases.push({ nx: Math.cos(a), ny: Math.sin(a), d: r.range(0.2, 0.8) * (W * Math.abs(Math.cos(a)) + H * Math.abs(Math.sin(a))) * (r() < 0.5 ? 1 : 1), s: r.range(0.006, 0.02), w: r.range(5, 14) });
    }
    const cockle = paper.cockle ?? 0.04;
    const cn = noise2(seed + 31);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let h = S.tooth[i] * 0.06 * grainScale;
        h += cn.fbm(x / 260, y / 260, 2) * cockle;
        for (const c of creases) {
          const dd = x * c.nx + y * c.ny - c.d;
          h += c.s * Math.exp(-(dd * dd) / (c.w * c.w)) * (dd < 0 ? 1 : 0.6);
        }
        S.hgt[i] = 0.5 + h;
        const t = 0.965 + 0.04 * (S.tooth[i] - 0.5) + 0.012 * n.fbm(x / 120, y / 120, 2);
        S.col[i * 3] = base[0] * t;
        S.col[i * 3 + 1] = base[1] * t;
        S.col[i * 3 + 2] = base[2] * t;
        S.rough[i] = paper.rough ?? 0.92;
      }
    S.canvas = document.createElement("canvas");
    S.canvas.width = W;
    S.canvas.height = H;
    S.ctx = S.canvas.getContext("2d", { willReadFrequently: true });
    return S;
  }

  // --------------------------------------------------------------------------------------------------- media (tools) --
  /**
   * Each tool draws its strokes into the scratch canvas as white coverage (alpha = pressure), then `deposit` turns coverage into
   * pigment against the paper's tooth.
   */
  const TOOLS = {
    crayon: { width: 13, alphaJ: 0.35, rough: 0.62, wax: 0.26 },
    crayonThin: { width: 8, alphaJ: 0.35, rough: 0.64, wax: 0.2 },
    pencil: { width: 3.6, alphaJ: 0.25, rough: 0.8, wax: 0.03 },
    marker: { width: 7.5, alphaJ: 0.1, rough: 0.88, wax: 0 },
    markerFat: { width: 15, alphaJ: 0.1, rough: 0.88, wax: 0 },
    paint: { width: 22, alphaJ: 0.15, rough: 0.9, wax: 0 },
    chalk: { width: 7.5, alphaJ: 0.3, rough: 0.95, wax: 0.08 },
    graphite: { width: 2.6, alphaJ: 0.3, rough: 0.55, wax: 0.02 },
  };

  function begin(S) {
    const c = S.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.filter = "none";
    c.fillStyle = "#000";
    c.fillRect(0, 0, S.W, S.H);
    c.globalCompositeOperation = "lighten";
    c.lineCap = "round";
    c.lineJoin = "round";
  }

  /** Coverage -> pigment. kind: crayon | pencil | marker | paint | chalk; col: "#rrggbb"; amount scales the whole layer. */
  function deposit(S, kind, colHex, amount = 1, opts = {}) {
    const { W, H } = S;
    if (kind === "markerFat") kind = "marker";
    const img = S.ctx.getImageData(0, 0, W, H).data;
    // (coverage lives in the red channel: pressure 0..1, strokes combined by max)
    for (let i = 0; i < W * H; i++) img[i * 4 + 3] = img[i * 4];
    const col = hex(colHex);
    const t = TOOLS[kind] || TOOLS.crayon;
    let a2 = null;
    if (kind === "paint" || kind === "marker") {
      // a soft copy of the coverage: the paint's wet edge / the marker's hair of bleed
      const blur = document.createElement("canvas");
      blur.width = W; blur.height = H;
      const bc = blur.getContext("2d", { willReadFrequently: true });
      bc.filter = kind === "paint" ? "blur(5px)" : "blur(0.8px)";
      bc.drawImage(S.canvas, 0, 0);
      a2 = bc.getImageData(0, 0, W, H).data;
      for (let i = 0; i < W * H; i++) a2[i * 4 + 3] = a2[i * 4];
    }
    let hole = null;
    if (opts.holes) {
      const hc = document.createElement("canvas");
      hc.width = W; hc.height = H;
      const hx = hc.getContext("2d", { willReadFrequently: true });
      hx.filter = "blur(3px)";
      hx.fillStyle = "#fff";
      for (const pg of opts.holes) {
        hx.beginPath();
        hx.moveTo(pg[0][0], pg[0][1]);
        for (const q of pg) hx.lineTo(q[0], q[1]);
        hx.closePath();
        hx.fill();
      }
      hole = hx.getImageData(0, 0, W, H).data;
    }
    const gran = kind === "paint" ? noise2(S.seed + colHex.length * 13 + col[0]) : null;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const a = img[i * 4 + 3] / 255;
        if (a <= 0.002 && !(a2 && a2[i * 4 + 3] > 2)) continue;
        const tooth = S.tooth[i];
        let d;
        if (kind === "crayon" || kind === "crayonThin") {
          // wax on the paper's peaks: light pressure leaves only the high tooth, heavy pressure fills most valleys
          d = clamp((tooth - (1 - a) * 1.05 - 0.02) / 0.22) * (0.55 + 0.4 * a);
        } else if (kind === "chalk") {
          d = clamp((tooth - (1 - a) * 1.1) / 0.25) * 0.9;
        } else if (kind === "pencil") {
          d = clamp((tooth - (1 - a) * 0.8 + 0.12) / 0.3) * 0.85;
        } else if (kind === "graphite") {
          d = clamp((tooth - (1 - a) * 0.8 + 0.1) / 0.3) * 0.8;
        } else if (kind === "marker") {
          const b = a2[i * 4 + 3] / 255;
          d = clamp(Math.max(a, b * 0.6)) * (0.9 + 0.1 * tooth);
        } else {
          // watercolour: the soft pool, a darker rim where the wet edge dried, granulation in the dips
          const b = a2[i * 4 + 3] / 255;
          const pool = Math.max(a * 0.55, b * 0.7);
          const rim = clamp((a - b) * 2.2) * 0.65;
          const g = 0.75 + 0.35 * gran.fbm(x / 7, y / 7, 3) + (1 - tooth) * 0.25;
          d = clamp((pool + rim) * g);
        }
        d *= amount;
        if (hole) d *= 1 - hole[i * 4 + 3] / 255;
        if (d <= 0.003) continue;
        const k = i * 3;
        if (kind === "paint" || kind === "marker") {
          // transparent dyes: multiply onto the paper (overlaps darken)
          const m = kind === "paint" ? 1 : 1;
          for (let ch = 0; ch < 3; ch++) S.col[k + ch] = S.col[k + ch] * lerp(1, (col[ch] / 255) * m, d);
        } else {
          // wax / chalk / graphite: semi-opaque, mixing with what is under it
          for (let ch = 0; ch < 3; ch++) {
            const under = S.col[k + ch];
            const over = lerp(col[ch], (under * col[ch]) / 255, 0.35);
            S.col[k + ch] = lerp(under, over, d);
          }
        }
        S.hgt[i] += d * t.wax * (opts.wax ?? 1);
        S.rough[i] = lerp(S.rough[i], t.rough, clamp(d * 1.2));
      }
  }

  // ----------------------------------------------------------------------------------------------------- the hand --
  /** Hand tremor and drift on a polyline (sheet pixels): low wobble (`amp` px over ~`wave` px) and a little jitter. */
  function wobble(S, pts, amp = 3, wave = 90, step = 4) {
    const out = [];
    const r = S.r;
    const ox = r() * 1000, oy = r() * 1000;
    let dist = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(L / step));
      for (let j = 0; j < n; j++) {
        const t = j / n;
        const x = lerp(x0, x1, t), y = lerp(y0, y1, t);
        const s = dist + L * t;
        out.push([x + amp * S.n(ox + s / wave, 3.3) + r.gauss() * 0.25, y + amp * S.n(oy + s / wave, 7.7) + r.gauss() * 0.25]);
      }
      dist += L;
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }

  /** One stroke with a pressure curve (start light, firm middle, lift at the end) and slow pressure drift. */
  function stroke(S, pts, tool, opts = {}) {
    const t = TOOLS[tool];
    const w = (opts.width ?? t.width) * (opts.wscale ?? 1);
    const p0 = opts.pressure ?? 0.85;
    const c = S.ctx;
    const r = S.r;
    const wp = opts.raw ? pts : wobble(S, pts, opts.amp ?? 2.5, opts.wave ?? 90);
    const n = wp.length;
    const ph = r() * 100;
    // a crayon's or chalk's tip leaves parallel striations: the stroke as a few thinner lines, each with its own pressure
    const waxy = tool.startsWith("crayon") || tool === "chalk";
    const k = waxy ? Math.max(2, Math.round(w / 3.2)) : 1;
    const subs = [];
    for (let j = 0; j < k; j++) subs.push({ off: k > 1 ? (j / (k - 1) - 0.5) * w * 0.78 : 0, p: k > 1 ? r.range(0.62, 1.05) : 1, ph: r() * 50 });
    const sw = k > 1 ? (w / k) * 1.9 : w;
    for (const sb of subs) {
      for (let i = 0; i < n - 1; i++) {
        const u = i / Math.max(1, n - 1);
        const ramp = Math.min(1, u * 9 + 0.35) * Math.min(1, (1 - u) * 7 + 0.45);
        const drift = 1 + t.alphaJ * S.n(ph + sb.ph + i * 0.05, 1.7);
        const a = clamp(p0 * sb.p * ramp * drift, 0.05, 1);
        const g = Math.round(a * 255);
        c.strokeStyle = `rgb(${g},${g},${g})`;
        let dx = wp[i + 1][0] - wp[i][0], dy = wp[i + 1][1] - wp[i][1];
        const L = Math.hypot(dx, dy) || 1;
        const ox = (-dy / L) * sb.off, oy = (dx / L) * sb.off;
        c.lineWidth = sw * (0.82 + 0.18 * ramp) * (1 + 0.12 * S.n(ph + i * 0.08, 5.1));
        c.beginPath();
        c.moveTo(wp[i][0] + ox, wp[i][1] + oy);
        c.lineTo(wp[i + 1][0] + ox, wp[i + 1][1] + oy);
        c.stroke();
      }
    }
  }

  const P = {
    circle(cx, cy, rx, ry = rx, a0 = 0, sweep = Math.PI * 2, n = 40) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + (sweep * i) / n;
        pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
      return pts;
    },
    rect(x0, y0, x1, y1) {
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    },
  };

  /** A child's closed outline: drawn as one or two strokes, the end overshooting or short of the start. */
  function outline(S, poly, tool, colour, opts = {}) {
    begin(S);
    const r = S.r;
    const pts = poly.concat([poly[0]]);
    const over = opts.closeMiss ?? r.range(-0.04, 0.08);
    // overshoot: a little of the start again; short: drop the last bit
    let path = pts.slice();
    if (over > 0) path = path.concat(poly.slice(1, 1 + Math.max(1, Math.round(poly.length * over))));
    else if (over < 0) path = path.slice(0, Math.max(2, path.length - Math.round(-over * path.length)));
    stroke(S, path, tool, opts);
    if (opts.double) stroke(S, path.map(([x, y]) => [x + r.range(-3, 3), y + r.range(-3, 3)]), tool, { ...opts, pressure: (opts.pressure ?? 0.85) * 0.6 });
    deposit(S, tool, colour, opts.amount ?? 1);
  }

  /** Open lines (stick arms, rays, grass): each an array of points. */
  function lines(S, list, tool, colour, opts = {}) {
    begin(S);
    for (const l of list) stroke(S, l, tool, opts);
    deposit(S, tool, colour, opts.amount ?? 1);
  }

  /** Points where a horizontal line (in the rotated frame) crosses the polygon. */
  function spans(poly, y) {
    const xs = [];
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
    return out;
  }

  /**
   * Scribble fill: back-and-forth strokes across the shape at an angle, spaced a stroke apart, running past the outline by a
   * random amount, now and then lifting the crayon and leaving a gap; `passes` adds rounds at other angles.
   */
  function scribble(S, poly, tool, colour, opts = {}) {
    const r = S.r;
    begin(S);
    const passes = opts.passes ?? 1;
    const t = TOOLS[tool];
    const w = (opts.width ?? t.width) * (opts.wscale ?? 1);
    for (let p = 0; p < passes; p++) {
      const ang = (opts.angle ?? r.range(-0.6, 0.6)) + p * r.range(0.5, 1.2);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rot = poly.map(([x, y]) => [x * ca + y * sa, -x * sa + y * ca]);
      const ys = rot.map((q) => q[1]);
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const gap = w * (opts.density ?? 0.75);
      let cur = [];
      let side = 0;
      const flush = () => {
        if (cur.length > 1) {
          const pts = cur.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);
          stroke(S, pts, tool, { ...opts, amp: opts.amp ?? 1.6, wave: 40, pressure: (opts.pressure ?? 0.8) * r.range(0.8, 1.1) });
        }
        cur = [];
      };
      for (let y = y0 + gap * r.range(0.2, 0.8); y < y1; y += gap * r.range(0.8, 1.25)) {
        const sp = spans(rot, y);
        if (!sp.length) { flush(); continue; }
        if (r() < (opts.skip ?? 0.04)) { flush(); continue; }
        // the widest span (kids carry on across little gaps)
        const [a, b] = sp.reduce((m, s) => (s[1] - s[0] > m[1] - m[0] ? s : m), sp[0]);
        const out = opts.outside ?? 0.55;
        const ea = a - w * r.range(-0.3, out * 2.2), eb = b + w * r.range(-0.3, out * 2.2);
        if (side === 0) cur.push([ea, y], [eb, y + gap * 0.5]);
        else cur.push([eb, y], [ea, y + gap * 0.5]);
        side ^= 1;
        if (cur.length > r.int(14, 40)) flush();
      }
      flush();
    }
    deposit(S, tool, colour, opts.amount ?? 1, opts);
  }

  /** A painted wash (watercolour) inside a wobbly shape: filled soft, with a few brush marks. */
  function wash(S, poly, colour, opts = {}) {
    const r = S.r;
    begin(S);
    const c = S.ctx;
    const polys = Array.isArray(poly[0][0]) ? poly : [poly];
    const ga = Math.round((opts.alpha ?? 0.75) * 255);
    c.fillStyle = `rgb(${ga},${ga},${ga})`;
    let wp = [];
    for (const pg of polys) {
      const w1 = wobble(S, pg.concat([pg[0]]), opts.amp ?? 6, 70);
      wp = wp.concat(w1);
      c.beginPath();
      c.moveTo(w1[0][0], w1[0][1]);
      for (const q of w1) c.lineTo(q[0], q[1]);
      c.closePath();
      c.fill();
    }
    // brush marks: a few broad strokes in the wash, slightly stronger
    for (let k = 0; k < (opts.marks ?? 4); k++) {
      const a = wp[r.int(0, wp.length - 1)], b = wp[r.int(0, wp.length - 1)];
      const gb = Math.round(Math.min(1, (opts.alpha ?? 0.75) + r.range(0.1, 0.25)) * 255);
      c.strokeStyle = `rgb(${gb},${gb},${gb})`;
      c.lineWidth = r.range(12, 30);
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      c.stroke();
    }
    deposit(S, "paint", colour, opts.amount ?? 1);
  }

  // ------------------------------------------------------------------------------------------- Hangul by hand (jamo) --
  // Strokes of each jamo in a unit box (x right, y down), in a child's stroke order.
  const C = (cx, cy, r, n = 18) => P.circle(cx, cy, r, r * 1.05, -Math.PI / 2 - 0.3, Math.PI * 2 + 0.5, n);
  const J = {
    "ㄱ": [[[0.1, 0.15], [0.86, 0.15], [0.8, 0.92]]],
    "ㄴ": [[[0.16, 0.08], [0.16, 0.86], [0.92, 0.86]]],
    "ㄷ": [[[0.14, 0.14], [0.86, 0.14]], [[0.14, 0.14], [0.14, 0.86], [0.9, 0.86]]],
    "ㄹ": [[[0.14, 0.1], [0.84, 0.1], [0.84, 0.47], [0.16, 0.47], [0.16, 0.88], [0.9, 0.88]]],
    "ㅁ": [[[0.16, 0.14], [0.16, 0.88]], [[0.16, 0.14], [0.86, 0.14], [0.86, 0.88]], [[0.16, 0.88], [0.86, 0.88]]],
    "ㅂ": [[[0.2, 0.08], [0.2, 0.9]], [[0.8, 0.08], [0.8, 0.9]], [[0.2, 0.48], [0.8, 0.48]], [[0.2, 0.9], [0.8, 0.9]]],
    "ㅅ": [[[0.52, 0.08], [0.12, 0.9]], [[0.46, 0.44], [0.92, 0.9]]],
    "ㅇ": [C(0.5, 0.5, 0.37)],
    "ㅈ": [[[0.14, 0.14], [0.86, 0.14], [0.14, 0.92]], [[0.48, 0.5], [0.92, 0.92]]],
    "ㅊ": [[[0.42, 0.0], [0.6, 0.1]], [[0.14, 0.27], [0.86, 0.27], [0.14, 0.95]], [[0.48, 0.58], [0.92, 0.95]]],
    "ㅋ": [[[0.1, 0.15], [0.86, 0.15], [0.8, 0.92]], [[0.16, 0.5], [0.82, 0.5]]],
    "ㅌ": [[[0.14, 0.12], [0.86, 0.12]], [[0.14, 0.12], [0.14, 0.88], [0.9, 0.88]], [[0.14, 0.5], [0.8, 0.5]]],
    "ㅍ": [[[0.08, 0.14], [0.92, 0.14]], [[0.34, 0.14], [0.3, 0.86]], [[0.66, 0.14], [0.7, 0.86]], [[0.06, 0.86], [0.94, 0.86]]],
    "ㅎ": [[[0.38, 0.0], [0.62, 0.06]], [[0.12, 0.24], [0.88, 0.24]], C(0.5, 0.64, 0.25)],
    // vowels (their own box)
    "ㅏ": [[[0.42, 0.02], [0.42, 0.98]], [[0.42, 0.5], [0.9, 0.5]]],
    "ㅑ": [[[0.38, 0.02], [0.38, 0.98]], [[0.38, 0.36], [0.88, 0.36]], [[0.38, 0.64], [0.88, 0.64]]],
    "ㅓ": [[[0.1, 0.5], [0.6, 0.5]], [[0.6, 0.02], [0.6, 0.98]]],
    "ㅕ": [[[0.1, 0.36], [0.62, 0.36]], [[0.1, 0.64], [0.62, 0.64]], [[0.62, 0.02], [0.62, 0.98]]],
    "ㅣ": [[[0.5, 0.02], [0.5, 0.98]]],
    "ㅐ": [[[0.3, 0.06], [0.3, 0.92]], [[0.3, 0.5], [0.72, 0.5]], [[0.72, 0.0], [0.72, 1.0]]],
    "ㅔ": [[[0.06, 0.5], [0.36, 0.5]], [[0.36, 0.06], [0.36, 0.92]], [[0.78, 0.0], [0.78, 1.0]]],
    "ㅒ": [[[0.3, 0.06], [0.3, 0.92]], [[0.3, 0.38], [0.72, 0.38]], [[0.3, 0.62], [0.72, 0.62]], [[0.72, 0.0], [0.72, 1.0]]],
    "ㅖ": [[[0.06, 0.38], [0.36, 0.38]], [[0.06, 0.62], [0.36, 0.62]], [[0.36, 0.06], [0.36, 0.92]], [[0.78, 0.0], [0.78, 1.0]]],
    "ㅗ": [[[0.5, 0.12], [0.5, 0.5]], [[0.04, 0.55], [0.96, 0.55]]],
    "ㅛ": [[[0.34, 0.12], [0.34, 0.5]], [[0.66, 0.12], [0.66, 0.5]], [[0.04, 0.55], [0.96, 0.55]]],
    "ㅜ": [[[0.04, 0.4], [0.96, 0.4]], [[0.52, 0.4], [0.52, 0.9]]],
    "ㅠ": [[[0.04, 0.4], [0.96, 0.4]], [[0.34, 0.4], [0.32, 0.88]], [[0.66, 0.4], [0.68, 0.88]]],
    "ㅡ": [[[0.04, 0.5], [0.96, 0.5]]],
  };
  const doubled = (j) => [...J[j].map((s) => s.map(([x, y]) => [x * 0.5, y])), ...J[j].map((s) => s.map(([x, y]) => [0.5 + x * 0.5, y]))];
  for (const [d, s] of [["ㄲ", "ㄱ"], ["ㄸ", "ㄷ"], ["ㅃ", "ㅂ"], ["ㅆ", "ㅅ"], ["ㅉ", "ㅈ"]]) J[d] = doubled(s);
  const pair = (a, b) => [...J[a].map((s) => s.map(([x, y]) => [x * 0.5, y])), ...J[b].map((s) => s.map(([x, y]) => [0.5 + x * 0.5, y]))];
  for (const cl of ["ㄳ:ㄱㅅ", "ㄵ:ㄴㅈ", "ㄶ:ㄴㅎ", "ㄺ:ㄹㄱ", "ㄻ:ㄹㅁ", "ㄼ:ㄹㅂ", "ㄽ:ㄹㅅ", "ㄾ:ㄹㅌ", "ㄿ:ㄹㅍ", "ㅀ:ㄹㅎ", "ㅄ:ㅂㅅ"]) J[cl[0]] = pair(cl[2], cl[3]);
  // digits and marks (a box 0.6 wide)
  const D = {
    "0": [C(0.3, 0.5, 0.28, 16).map(([x, y]) => [x, 0.5 + (y - 0.5) * 1.6])],
    "1": [[[0.18, 0.22], [0.34, 0.08], [0.34, 0.95]]],
    "2": [[[0.08, 0.25], [0.2, 0.08], [0.4, 0.08], [0.5, 0.25], [0.45, 0.45], [0.06, 0.94], [0.56, 0.94]]],
    "3": [[[0.08, 0.15], [0.3, 0.06], [0.5, 0.2], [0.42, 0.42], [0.22, 0.48], [0.46, 0.56], [0.52, 0.8], [0.3, 0.95], [0.06, 0.86]]],
    "4": [[[0.4, 0.95], [0.4, 0.06], [0.04, 0.68], [0.58, 0.68]]],
    "5": [[[0.5, 0.08], [0.12, 0.08], [0.1, 0.45], [0.36, 0.42], [0.52, 0.62], [0.44, 0.88], [0.2, 0.95], [0.06, 0.86]]],
    "6": [[[0.46, 0.08], [0.16, 0.36], [0.08, 0.7], [0.2, 0.93], [0.42, 0.92], [0.5, 0.7], [0.36, 0.52], [0.12, 0.6]]],
    "7": [[[0.06, 0.1], [0.54, 0.1], [0.24, 0.95]]],
    "8": [[[0.46, 0.18], [0.3, 0.06], [0.12, 0.18], [0.2, 0.4], [0.44, 0.6], [0.5, 0.84], [0.3, 0.95], [0.1, 0.84], [0.16, 0.6], [0.4, 0.4], [0.46, 0.18]]],
    "9": [[[0.46, 0.3], [0.28, 0.08], [0.1, 0.26], [0.24, 0.46], [0.46, 0.34], [0.44, 0.95]]],
    "+": [[[0.06, 0.52], [0.54, 0.52]], [[0.3, 0.28], [0.3, 0.76]]],
    "=": [[[0.06, 0.42], [0.54, 0.42]], [[0.06, 0.64], [0.54, 0.64]]],
    "-": [[[0.08, 0.52], [0.5, 0.52]]],
    ":": [[[0.27, 0.27], [0.33, 0.33]], [[0.27, 0.71], [0.33, 0.77]]],
    ".": [[[0.17, 0.85], [0.25, 0.93]]],
    "!": [[[0.3, 0.06], [0.28, 0.66]], [[0.28, 0.86], [0.29, 0.9]]],
    "?": [[[0.08, 0.2], [0.28, 0.05], [0.5, 0.2], [0.3, 0.5], [0.3, 0.66]], [[0.3, 0.86], [0.31, 0.9]]],
    "♡": [[[0.4, 0.92], [0.06, 0.45], [0.12, 0.18], [0.4, 0.3], [0.68, 0.16], [0.74, 0.45], [0.4, 0.92]]],
    "~": [[[0.04, 0.55], [0.2, 0.42], [0.4, 0.6], [0.56, 0.46]]],
    ",": [[[0.26, 0.82], [0.18, 1.0]]],
  };
  const DW = { "0": 0.62, "1": 0.5, "+": 0.62, "=": 0.62, ":": 0.4, ".": 0.4, "!": 0.45, "?": 0.6, "♡": 0.82, "~": 0.62, ",": 0.4, "-": 0.6 };
  const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
  const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
  const COMPOUND = { "ㅘ": ["ㅗ", "ㅏ"], "ㅙ": ["ㅗ", "ㅐ"], "ㅚ": ["ㅗ", "ㅣ"], "ㅝ": ["ㅜ", "ㅓ"], "ㅞ": ["ㅜ", "ㅔ"], "ㅟ": ["ㅜ", "ㅣ"], "ㅢ": ["ㅡ", "ㅣ"] };
  const HORIZ = new Set(["ㅗ", "ㅛ", "ㅜ", "ㅠ", "ㅡ"]);

  /** A syllable as strokes in its unit box: [[x, y]...] lists, with a child's (or teacher's) irregularity. */
  function syllable(ch, r, mess) {
    const code = ch.charCodeAt(0) - 0xac00;
    const boxes = [];
    const put = (j, x0, y0, x1, y1) => {
      const s = 1 + r.gauss() * 0.08 * mess;
      const dx = r.gauss() * 0.03 * mess, dy = r.gauss() * 0.03 * mess;
      const rot = r.gauss() * 0.06 * mess;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      for (const st of J[j] || []) {
        boxes.push(st.map(([u, v]) => {
          let x = (u - 0.5) * (x1 - x0) * s, y = (v - 0.5) * (y1 - y0) * s;
          const xr = x * Math.cos(rot) - y * Math.sin(rot), yr = x * Math.sin(rot) + y * Math.cos(rot);
          return [cx + xr + dx, cy + yr + dy];
        }));
      }
    };
    if (code < 0 || code > 11171) {
      const jamo = J[ch] ? ch : null;
      if (jamo) put(jamo, 0.1, 0.1, 0.9, 0.9);
      return boxes;
    }
    const cho = CHO[Math.floor(code / 588)];
    const jung = JUNG[Math.floor((code % 588) / 28)];
    const jong = JONG[code % 28];
    const fin = !!jong;
    const comp = COMPOUND[jung];
    const bottom = fin ? 0.58 : 1.0;
    if (comp) {
      put(cho, 0.06, 0.02, 0.56, fin ? 0.3 : 0.44);
      put(comp[0], 0.0, fin ? 0.2 : 0.3, 0.66, fin ? 0.56 : 0.86);
      put(comp[1], 0.6, 0.0, 0.98, bottom);
    } else if (HORIZ.has(jung)) {
      put(cho, 0.18, 0.02, 0.82, fin ? 0.3 : 0.48);
      put(jung, 0.02, fin ? 0.24 : 0.4, 0.98, fin ? 0.56 : 0.92);
    } else {
      put(cho, 0.02, fin ? 0.06 : 0.16, 0.56, fin ? 0.52 : 0.84);
      put(jung, 0.54, 0.0, 0.98, bottom);
    }
    if (fin) put(jong, 0.14, 0.6, 0.86, 0.98);
    return boxes;
  }

  /**
   * Write a line of text by hand at (x, y) (the top-left of the first letter), letters `size` px; mess 1 = a 6-year-old,
   * 0.3 = the teacher. Letters wander up and down, grow and shrink; spaces are uneven.
   */
  function write(S, text, x, y, size, tool, colour, opts = {}) {
    const r = S.r;
    const mess = opts.mess ?? 1;
    const strokes = [];
    let cx = x;
    let base = y;
    const slope = (opts.slope ?? r.gauss() * 0.04) * mess;
    for (const ch of text) {
      if (ch === " ") { cx += size * r.range(0.35, 0.6); continue; }
      const sz = size * (1 + r.gauss() * 0.1 * mess);
      const yy = base + r.gauss() * size * 0.05 * mess + (cx - x) * slope;
      let st, w;
      if (D[ch]) { st = D[ch]; w = DW[ch] ?? 0.6; }
      else { st = syllable(ch, r, mess); w = 1; }
      for (const s of st) strokes.push(s.map(([u, v]) => [cx + u * sz * (D[ch] ? 1 : 0.92), yy + v * sz]));
      cx += sz * w * (D[ch] ? 1 : 0.92) + size * r.range(0.04, 0.16) * (mess > 0.5 ? 1 : 0.6);
    }
    begin(S);
    for (const s of strokes) stroke(S, s, tool, { width: opts.width, pressure: opts.pressure ?? 0.85, amp: (opts.amp ?? 1.6) * mess + 0.4, wave: size * 0.8 });
    deposit(S, tool, colour, opts.amount ?? 1);
    return cx;
  }

  // ------------------------------------------------------------------------------------------- children's subjects --
  const COL = {
    red: "#D8423A", orange: "#EE8A2F", yellow: "#F4CB2C", lemon: "#F6DF4A", green: "#4F9E45", lime: "#8CC63E", dkgreen: "#2F7A3A",
    sky: "#58A9E0", blue: "#2E63C2", navy: "#24357A", purple: "#7E55A8", pink: "#EC7FB0", brown: "#8A5A33", black: "#2A2626",
    peach: "#F4B58A", tan: "#D9A066", grey: "#8C8C8C", white: "#FFFFFF", magenta: "#C8378A", teal: "#2B9C9A",
  };

  function sun(S, cx, cy, R, tool = "crayon", face = true, rays = 12) {
    const r = S.r;
    scribble(S, P.circle(cx, cy, R, R, 0, Math.PI * 2, 24), tool, COL.yellow, { passes: 2, outside: 0.4 });
    outline(S, P.circle(cx, cy, R, R * r.range(0.95, 1.05), r() * 6, Math.PI * 2, 30), tool, COL.orange, { pressure: 0.9 });
    const L = [];
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2 + r.range(-0.12, 0.12);
      const r0 = R * r.range(1.12, 1.25), r1 = R * r.range(1.5, 1.95);
      L.push([[cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)], [cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)]]);
    }
    lines(S, L, tool, r() < 0.5 ? COL.orange : COL.yellow, { pressure: 0.95 });
    if (face) {
      lines(S, [[[cx - R * 0.35, cy - R * 0.2], [cx - R * 0.33, cy - R * 0.12]], [[cx + R * 0.3, cy - R * 0.2], [cx + R * 0.32, cy - R * 0.12]], P.circle(cx, cy + R * 0.05, R * 0.42, R * 0.32, 0.4, 2.3, 10)], "crayonThin", COL.orange, { pressure: 1 });
    }
  }

  function grassStrip(S, y, tool = "crayon", colour = COL.green, blades = true) {
    const { W, H } = S;
    const r = S.r;
    scribble(S, [[-10, y + r.range(-6, 6)], [W * 0.3, y + r.range(-10, 10)], [W * 0.7, y + r.range(-10, 10)], [W + 10, y + r.range(-6, 6)], [W + 10, H + 10], [-10, H + 10]], tool, colour, { passes: 1, angle: r.range(-0.2, 0.2), density: 0.85, skip: 0.06 });
    if (blades) {
      const L = [];
      for (let x = r.range(4, 20); x < W; x += r.range(10, 26)) L.push([[x, y + 8], [x + r.range(-6, 6), y - r.range(10, 26)]]);
      lines(S, L, "crayonThin", r() < 0.5 ? COL.dkgreen : COL.green, { pressure: 0.9 });
    }
  }

  function skyStrip(S, depth, tool = "crayon", colour = COL.sky) {
    const { W } = S;
    const r = S.r;
    scribble(S, [[-10, -10], [W + 10, -10], [W + 10, depth + r.range(-8, 8)], [W * 0.6, depth + r.range(-12, 12)], [W * 0.25, depth + r.range(-12, 12)], [-10, depth]], tool, colour, { passes: 1, angle: r.range(-0.3, 0.3), density: 0.9, skip: 0.08, pressure: 0.7 });
  }

  function cloud(S, cx, cy, s, tool = "crayon", colour = COL.sky) {
    const r = S.r;
    const pts = [];
    const bumps = r.int(4, 6);
    for (let k = 0; k <= bumps; k++) {
      const a0 = Math.PI + (k / bumps) * Math.PI;
      const bx = cx + Math.cos(a0) * s, by = cy + Math.sin(a0) * s * 0.5;
      pts.push(...P.circle(bx, by, s * 0.32, s * 0.3, a0 - 1.6, 2.6, 6));
    }
    pts.push([cx + s, cy + s * 0.2], [cx - s, cy + s * 0.2]);
    outline(S, pts, tool, colour, { pressure: 0.8 });
  }

  /** A stick person (a child's 'tadpole' style): big head, eyes, smile, hair, triangle dress or body line, stick limbs. */
  function person(S, x, foot, h, o = {}) {
    const r = S.r;
    const head = h * (o.headRatio ?? r.range(0.15, 0.18));
    const hy = foot - h + head;
    const tool = o.tool ?? "crayon";
    // body
    const bodyTop = hy + head * 0.95, hip = foot - h * 0.36;
    if (o.dress) {
      const dw = h * r.range(0.2, 0.28);
      const tri = [[x, bodyTop], [x + dw, hip + h * 0.04], [x - dw, hip + h * 0.04]];
      scribble(S, tri, tool, o.dress, { passes: 1, outside: 0.5 });
      outline(S, tri, tool, o.dress, { pressure: 0.95 });
    } else if (o.shirt) {
      const bw = h * r.range(0.1, 0.15);
      const box = P.rect(x - bw, bodyTop, x + bw, hip);
      scribble(S, box, tool, o.shirt, { passes: 1, outside: 0.5 });
      outline(S, box, tool, o.shirt);
    } else lines(S, [[[x, bodyTop], [x + r.range(-3, 3), hip]]], tool, o.line ?? COL.black);
    // legs, arms (fingers as little spikes on some)
    const legs = [[[x - 4, hip], [x - h * 0.12, foot]], [[x + 4, hip], [x + h * 0.12, foot]]];
    const sh = bodyTop + h * 0.06;
    const armL = o.armL ?? [x - h * 0.32, sh + h * r.range(-0.12, 0.08)];
    const armR = o.armR ?? [x + h * 0.32, sh + h * r.range(-0.12, 0.08)];
    const arms = [[[x - 4, sh], armL], [[x + 4, sh], armR]];
    const fingers = [];
    if (o.fingers !== false)
      for (const [hx, hy2, dir] of [[armL[0], armL[1], -1], [armR[0], armR[1], 1]]) {
        for (let k = -1; k <= 1; k++) fingers.push([[hx, hy2], [hx + dir * h * 0.05, hy2 + k * h * 0.045]]);
      }
    lines(S, [...legs, ...arms, ...fingers], tool, o.line ?? COL.black, { pressure: 0.9 });
    // feet
    lines(S, [[[x - h * 0.12, foot], [x - h * 0.19, foot + 2]], [[x + h * 0.12, foot], [x + h * 0.19, foot + 2]]], tool, o.shoes ?? COL.brown, { pressure: 1, wscale: 1.4 });
    // head
    if (o.skin) scribble(S, P.circle(x, hy, head * 0.92, head, 0, Math.PI * 2, 18), "crayon", o.skin, { passes: 1, pressure: 0.55, outside: 0.2 });
    outline(S, P.circle(x, hy, head * r.range(0.9, 1), head, r() * 6, Math.PI * 2, 26), tool, o.line ?? COL.black, { pressure: 0.9 });
    // face
    const eye = head * 0.16;
    lines(S, [
      [[x - head * 0.38, hy - head * 0.18], [x - head * 0.36, hy - head * 0.18 + eye]],
      [[x + head * 0.34, hy - head * 0.18], [x + head * 0.36, hy - head * 0.18 + eye]],
      P.circle(x, hy + head * 0.12, head * 0.42, head * 0.3, 0.35, 2.4, 10),
    ], "crayonThin", o.line ?? COL.black, { pressure: 1 });
    if (o.cheeks) lines(S, [P.circle(x - head * 0.55, hy + head * 0.15, 4, 3), P.circle(x + head * 0.55, hy + head * 0.15, 4, 3)], "crayonThin", COL.pink, { pressure: 0.8 });
    // hair
    if (o.hair) {
      const L = [];
      const n = o.long ? 11 : 9;
      for (let k = 0; k < n; k++) {
        const a = Math.PI + 0.25 + (k / (n - 1)) * (Math.PI - 0.5);
        const p0 = [x + head * Math.cos(a), hy + head * Math.sin(a)];
        const len = o.long && (k < 3 || k > n - 4) ? head * r.range(1.2, 1.8) : head * r.range(0.2, 0.45);
        const dir = o.long && (k < 3 || k > n - 4) ? [Math.cos(a) * 0.3, 1] : [Math.cos(a), Math.sin(a)];
        L.push([p0, [p0[0] + dir[0] * len, p0[1] + dir[1] * len]]);
      }
      lines(S, L, tool, o.hair, { pressure: 0.95 });
    }
    return { hy, head, armL, armR };
  }

  function house(S, x0, y0, x1, y1, o = {}) {
    const r = S.r;
    const tool = o.tool ?? "crayon";
    const body = P.rect(x0, y0, x1, y1);
    if (o.wall) scribble(S, body, tool, o.wall, { passes: 1, outside: 0.45, pressure: 0.75 });
    outline(S, body, tool, o.line ?? COL.black);
    const peak = [(x0 + x1) / 2 + r.range(-20, 20), y0 - (y1 - y0) * r.range(0.55, 0.8)];
    const roof = [[x0 - r.range(10, 30), y0 + 4], peak, [x1 + r.range(10, 30), y0 + 4]];
    scribble(S, roof, tool, o.roof ?? COL.red, { passes: 2, outside: 0.5 });
    outline(S, roof, tool, o.roofLine ?? o.roof ?? COL.red);
    if (o.chimney) {
      const cx = x1 - (x1 - x0) * 0.25;
      const top = peak[1] + (y0 - peak[1]) * 0.35;
      lines(S, [[[cx, top + 20], [cx, top - 30], [cx + 26, top - 30], [cx + 26, top + 34]]], tool, COL.brown);
      lines(S, [P.circle(cx + 20, top - 50, 10, 8, 0, 5, 8).concat(P.circle(cx + 40, top - 80, 14, 10, 3, 5, 8))], "crayonThin", COL.grey, { pressure: 0.6 });
    }
    // door
    const dw = (x1 - x0) * 0.2;
    const dx = x0 + (x1 - x0) * r.range(0.35, 0.55);
    const door = P.rect(dx, y1 - (y1 - y0) * 0.5, dx + dw, y1);
    scribble(S, door, tool, o.door ?? COL.brown, { passes: 1, outside: 0.3 });
    outline(S, door, tool, COL.black, { closeMiss: -0.2 });
    lines(S, [[[dx + dw * 0.75, y1 - (y1 - y0) * 0.24], [dx + dw * 0.78, y1 - (y1 - y0) * 0.22]]], "crayonThin", COL.yellow, { pressure: 1, wscale: 1.5 });
    // windows (mismatched)
    const wins = [[x0 + (x1 - x0) * 0.1, y0 + (y1 - y0) * 0.18, (x1 - x0) * r.range(0.18, 0.24)], [x0 + (x1 - x0) * 0.66, y0 + (y1 - y0) * r.range(0.14, 0.24), (x1 - x0) * r.range(0.16, 0.24)]];
    for (const [wx, wy, ws] of wins) {
      const wr = P.rect(wx, wy, wx + ws, wy + ws * r.range(0.85, 1.15));
      scribble(S, wr, tool, o.glass ?? COL.sky, { passes: 1, outside: 0.25, pressure: 0.6 });
      outline(S, wr, tool, COL.black);
      lines(S, [[[wx + ws / 2, wy], [wx + ws / 2, wy + ws]], [[wx, wy + ws / 2], [wx + ws, wy + ws / 2]]], "crayonThin", COL.black);
    }
  }

  function tree(S, x, foot, h, o = {}) {
    const r = S.r;
    const tool = o.tool ?? "crayon";
    const tw = h * 0.07;
    const trunk = [[x - tw, foot], [x - tw * 0.8, foot - h * 0.5], [x + tw * 0.8, foot - h * 0.5], [x + tw, foot]];
    scribble(S, trunk, tool, COL.brown, { passes: 2, angle: 1.4, outside: 0.3 });
    outline(S, trunk, tool, COL.brown);
    const cy = foot - h * 0.68, R = h * 0.36;
    const crown = [];
    const lobes = r.int(6, 9);
    for (let k = 0; k < lobes; k++) {
      const a = (k / lobes) * Math.PI * 2;
      crown.push(...P.circle(x + Math.cos(a) * R * 0.75, cy + Math.sin(a) * R * 0.62, R * 0.38, R * 0.34, a - 1.4, 2.8, 6));
    }
    scribble(S, crown, tool, o.leaf ?? COL.green, { passes: 2, outside: 0.5 });
    outline(S, crown, tool, o.leafLine ?? COL.dkgreen);
    if (o.apples) {
      for (let k = 0; k < o.apples; k++) {
        const ax = x + r.range(-R * 0.8, R * 0.8), ay = cy + r.range(-R * 0.5, R * 0.5);
        scribble(S, P.circle(ax, ay, 11, 11, 0, 6.3, 10), tool, COL.red, { passes: 2, outside: 0.1, width: 9 });
      }
    }
    return { cy, R };
  }

  function flower(S, x, foot, h, petal, o = {}) {
    const r = S.r;
    const tool = o.tool ?? "crayon";
    const cy = foot - h;
    lines(S, [[[x, foot], [x + r.range(-8, 8), cy]]], tool, COL.green, { pressure: 0.95 });
    const leaf = [[x, foot - h * 0.35], [x + h * 0.22, foot - h * 0.5], [x + h * 0.3, foot - h * 0.42], [x, foot - h * 0.3]];
    scribble(S, leaf, tool, COL.green, { passes: 1, outside: 0.2 });
    const pr = h * (o.petalSize ?? 0.16);
    const n = o.petals ?? r.int(5, 7);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * pr * 1.25, py = cy + Math.sin(a) * pr * 1.25;
      const pp = P.circle(px, py, pr, pr * 0.8, a, Math.PI * 2, 12);
      scribble(S, pp, tool, petal, { passes: 1, outside: 0.3, pressure: 0.85 });
      outline(S, pp, "crayonThin", petal, { pressure: 0.9 });
    }
    scribble(S, P.circle(x, cy, pr * 0.8, pr * 0.8, 0, 6.3, 12), tool, o.centre ?? COL.yellow, { passes: 2, outside: 0.1 });
  }

  function heart(S, x, y, s, colour, tool = "crayon") {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      pts.push([x + s * 0.06 * 16 * Math.pow(Math.sin(t), 3), y - s * 0.06 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
    }
    scribble(S, pts, tool, colour, { passes: 2, outside: 0.3 });
  }

  // --------------------------------------------------------------------------------------------------- the drawings --
  const NAME_TOOLS = ["pencil", "crayonThin", "marker", "pencil"];
  function signature(S, name, corner = "br", tool = null, colour = null) {
    const r = S.r;
    const size = r.range(44, 62);
    const len = [...name].length * size * 0.98;
    const x = corner.includes("r") ? S.W - len - r.range(34, 70) : r.range(30, 60);
    const y = corner.includes("b") ? S.H - size - r.range(26, 46) : r.range(24, 40);
    const t = tool ?? r.pick(NAME_TOOLS);
    write(S, name, x, y, size, t, colour ?? (t === "pencil" ? "#4A4A52" : r.pick([COL.blue, COL.black, COL.purple, COL.red])), { mess: 1.1, width: t === "pencil" ? 4.2 : undefined });
  }

  const DRAW = {
    family(S) {
      const { W, H } = S, r = S.r;
      skyStrip(S, 60);
      sun(S, W - 30, 20, 95);
      grassStrip(S, H - 110);
      house(S, 70, 330, 330, H - 112, { wall: COL.lemon, roof: COL.red, chimney: true });
      const foot = H - 120;
      const fam = [
        { x: 430, h: 330, o: { hair: COL.black, shirt: COL.blue, skin: COL.peach } },
        { x: 560, h: 310, o: { hair: COL.brown, long: true, dress: COL.pink, skin: COL.peach, cheeks: true } },
        { x: 680, h: 210, o: { hair: COL.brown, dress: COL.purple, long: true, skin: COL.peach } },
        { x: 790, h: 190, o: { hair: COL.black, shirt: COL.green, skin: COL.peach } },
      ];
      // holding hands: each right hand meets the next one's left
      for (let i = 0; i < fam.length; i++) {
        const f = fam[i];
        const hy = foot - f.h * 0.55;
        f.o.armL = i > 0 ? [f.x - (f.x - fam[i - 1].x) / 2, foot - Math.min(f.h, fam[i - 1].h) * 0.5] : [f.x - f.h * 0.3, hy - 30];
        f.o.armR = i < fam.length - 1 ? [f.x + (fam[i + 1].x - f.x) / 2, foot - Math.min(f.h, fam[i + 1].h) * 0.5] : [f.x + f.h * 0.3, hy - 40];
        f.o.fingers = i === 0 || i === fam.length - 1;
        person(S, f.x, foot, f.h, f.o);
      }
      heart(S, 900, 210, 40, COL.red);
      heart(S, 960, 290, 26, COL.pink);
      write(S, "우리 가족", 380, 92, 70, "crayon", COL.purple, { mess: 1 });
      signature(S, "하늘", "br", "pencil");
    },
    rainbow(S) {
      const { W, H } = S, r = S.r;
      const cx = W / 2, cy = H - 120;
      const cols = [COL.red, COL.orange, COL.yellow, COL.green, COL.blue, COL.purple];
      for (let k = 0; k < cols.length; k++) {
        const R0 = 460 - k * 48, R1 = R0 - 44;
        const band = [...P.circle(cx, cy, R0, R0 * 0.92, Math.PI, Math.PI, 30), ...P.circle(cx, cy, R1, R1 * 0.92, 0, -Math.PI, 30)];
        scribble(S, band, "crayon", cols[k], { passes: 2, angle: r.range(-1, 1), density: 0.7, outside: 0.35 });
      }
      cloud(S, 150, H - 170, 120);
      cloud(S, W - 160, H - 170, 120);
      scribble(S, P.circle(150, H - 190, 110, 50, 0, 6.3, 20), "crayon", "#EAF2FA", { passes: 1, amount: 0.6 });
      grassStrip(S, H - 80, "crayon", COL.lime);
      for (let k = 0; k < 5; k++) flower(S, 280 + k * 120 + r.range(-20, 20), H - 50, r.range(60, 90), r.pick([COL.red, COL.pink, COL.purple, COL.yellow]), { petalSize: 0.22 });
      write(S, "무지개", 70, 40, 74, "marker", COL.blue);
      signature(S, "서윤", "tr", "crayonThin", COL.red);
    },
    cat(S) {
      const { W, H } = S, r = S.r;
      // a big orange cat with stripes, whiskers, a ball of yarn; floor line
      const cx = 470, cy = 430;
      const body = P.circle(cx, cy, 230, 150, 0, Math.PI * 2, 30);
      scribble(S, body, "crayon", COL.orange, { passes: 2, outside: 0.6 });
      outline(S, body, "marker", COL.black, { pressure: 0.95 });
      const hx = cx - 210, hy = cy - 150;
      const head = P.circle(hx, hy, 130, 115, 0, Math.PI * 2, 28);
      const earL = [[hx - 110, hy - 50], [hx - 95, hy - 175], [hx - 30, hy - 105]], earR = [[hx + 30, hy - 105], [hx + 95, hy - 175], [hx + 110, hy - 50]];
      for (const e of [earL, earR]) { scribble(S, e, "crayon", COL.orange, { passes: 1 }); outline(S, e, "marker", COL.black); }
      scribble(S, head, "crayon", COL.orange, { passes: 2, outside: 0.5 });
      outline(S, head, "marker", COL.black);
      scribble(S, [[hx - 88, hy - 70], [hx - 92, hy - 140], [hx - 52, hy - 100]], "crayonThin", COL.pink, { passes: 1 });
      // stripes
      const st = [];
      for (let k = 0; k < 6; k++) { const x = cx - 120 + k * 55; st.push([[x, cy - 140], [x + 12, cy - 70]]); }
      st.push([[hx - 30, hy - 110], [hx - 25, hy - 70]], [[hx, hy - 112], [hx, hy - 72]], [[hx + 30, hy - 108], [hx + 25, hy - 70]]);
      lines(S, st, "crayon", "#B34A1A", { pressure: 1 });
      // face
      for (const ex of [hx - 50, hx + 45]) {
        scribble(S, P.circle(ex, hy - 10, 20, 26, 0, 6.3, 12), "crayon", COL.green, { passes: 1 });
        lines(S, [[[ex, hy - 30], [ex, hy + 10]]], "marker", COL.black, { pressure: 1 });
      }
      scribble(S, [[hx - 12, hy + 30], [hx + 12, hy + 30], [hx, hy + 45]], "crayonThin", COL.pink, { passes: 1 });
      lines(S, [P.circle(hx - 15, hy + 50, 15, 12, 0, 3, 8), P.circle(hx + 15, hy + 50, 15, 12, 0, 3, 8)], "marker", COL.black);
      lines(S, [[[hx - 40, hy + 35], [hx - 150, hy + 15]], [[hx - 40, hy + 45], [hx - 150, hy + 55]], [[hx + 40, hy + 35], [hx + 150, hy + 15]], [[hx + 40, hy + 45], [hx + 150, hy + 58]]], "pencil", COL.black, { pressure: 0.9 });
      // tail and legs
      lines(S, [[[cx + 220, cy - 20], [cx + 300, cy - 120], [cx + 290, cy - 230], [cx + 240, cy - 260]]], "crayon", COL.orange, { wscale: 2.2, pressure: 1 });
      for (const lx of [cx - 150, cx - 60, cx + 60, cx + 150]) {
        const leg = P.rect(lx - 22, cy + 100, lx + 22, cy + 200);
        scribble(S, leg, "crayon", COL.orange, { passes: 1 });
        outline(S, leg, "marker", COL.black, { closeMiss: -0.25 });
      }
      // yarn ball
      const yx = 830, yy = 560;
      const yarn = P.circle(yx, yy, 75, 70, 0, 6.3, 24);
      scribble(S, yarn, "crayon", COL.sky, { passes: 1 });
      const yl = [];
      for (let k = 0; k < 7; k++) yl.push(P.circle(yx + r.range(-20, 20), yy + r.range(-20, 20), r.range(30, 70), r.range(20, 60), r() * 6, r.range(2, 4), 10));
      yl.push([[yx - 60, yy + 40], [yx - 180, yy + 120], [yx - 260, yy + 90]]);
      lines(S, yl, "crayonThin", COL.blue);
      lines(S, [[[-10, H - 60], [W + 10, H - 70]]], "crayon", COL.brown, { pressure: 0.8 });
      write(S, "우리 나비", 650, 70, 64, "marker", COL.black);
      signature(S, "지우", "bl", "pencil");
    },
    dog(S) {
      const { W, H } = S, r = S.r;
      // coloured pencil: a spotted dog in a garden with a doghouse and a bone; lighter, hatched
      skyStrip(S, 46, "pencil", COL.sky);
      grassStrip(S, H - 150, "pencil", COL.lime, true);
      const cx = 430, cy = 440;
      const body = P.circle(cx, cy, 190, 105, 0, 6.3, 28);
      scribble(S, body, "pencil", "#E8D3B0", { passes: 2, density: 0.9 });
      outline(S, body, "pencil", COL.brown, { double: true, pressure: 1 });
      const head = P.circle(cx - 190, cy - 110, 95, 90, 0, 6.3, 24);
      scribble(S, head, "pencil", "#E8D3B0", { passes: 2 });
      outline(S, head, "pencil", COL.brown, { double: true });
      const ear = [[cx - 260, cy - 170], [cx - 300, cy - 70], [cx - 250, cy - 90]];
      scribble(S, ear, "pencil", COL.brown, { passes: 3 });
      for (const [sx, sy, sr] of [[cx - 40, cy - 30, 40], [cx + 80, cy + 20, 32], [cx - 150, cy - 140, 24]]) scribble(S, P.circle(sx, sy, sr, sr * 0.8, 0, 6.3, 14), "pencil", COL.brown, { passes: 3 });
      lines(S, [[[cx - 225, cy - 125], [cx - 222, cy - 115]], [[cx - 170, cy - 128], [cx - 168, cy - 118]]], "pencil", COL.black, { wscale: 3 });
      scribble(S, P.circle(cx - 270, cy - 85, 16, 12, 0, 6.3, 10), "pencil", COL.black, { passes: 3 });
      lines(S, [P.circle(cx - 220, cy - 70, 30, 18, 0.3, 2.4, 8)], "pencil", COL.black);
      scribble(S, [[cx - 215, cy - 55], [cx - 195, cy - 55], [cx - 200, cy - 20], [cx - 212, cy - 22]], "pencil", COL.red, { passes: 2 });
      for (const lx of [cx - 130, cx - 50, cx + 70, cx + 140]) lines(S, [[[lx, cy + 80], [lx + r.range(-6, 6), cy + 175], [lx + 25, cy + 178]]], "pencil", COL.brown, { wscale: 2.2 });
      lines(S, [[[cx + 185, cy - 20], [cx + 250, cy - 110], [cx + 270, cy - 100]]], "pencil", COL.brown, { wscale: 2.2 });
      // motion marks of a wagging tail
      lines(S, [[[cx + 290, cy - 140], [cx + 310, cy - 160]], [[cx + 300, cy - 110], [cx + 330, cy - 118]]], "pencil", COL.grey);
      // doghouse
      house(S, 760, 360, 960, H - 150, { tool: "pencil", wall: COL.red, roof: COL.blue, door: COL.black });
      // bone
      const bx = 700, by = H - 80;
      lines(S, [[[bx - 40, by], [bx + 40, by - 8]]], "pencil", COL.grey, { wscale: 4 });
      scribble(S, P.circle(bx + 60, by - 20, 50, 30, 0, 6.3, 12), "pencil", COL.yellow, { passes: 2 });
      write(S, "뭉치", 90, 90, 80, "pencil", COL.brown, { width: 5 });
      signature(S, "민준", "br", "pencil");
    },
    flowers(S) {
      const { W, H } = S, r = S.r;
      // watercolour wash sky and ground, crayon flowers bigger than the house (wax resist would leave the paint out)
      wash(S, [[0, 0], [W, 0], [W, 240], [W * 0.5, 270], [0, 230]], "#9CCBEE", { alpha: 0.6 });
      wash(S, [[0, H - 210], [W * 0.4, H - 240], [W, H - 200], [W, H], [0, H]], "#9ED27A", { alpha: 0.7 });
      house(S, 720, 420, 900, H - 190, { wall: COL.peach, roof: COL.brown, tool: "crayon" });
      const cols = [COL.red, COL.yellow, COL.pink, COL.purple, COL.orange, COL.magenta];
      for (let k = 0; k < 6; k++) flower(S, 90 + k * 112 + r.range(-15, 15), H - 80 + r.range(-20, 20), r.range(260, 420), cols[k], { petalSize: r.range(0.13, 0.18), centre: k % 2 ? COL.orange : COL.yellow });
      sun(S, 70, 60, 80, "crayon", false);
      lines(S, [[[640, 120], [660, 100], [680, 120]], [[700, 90], [715, 75], [730, 92]]], "crayonThin", COL.black);
      signature(S, "하은", "br", "marker", COL.purple);
    },
    fountain(S) {
      const { W, H } = S, r = S.r;
      // the village fountain in the plaza: round basin, the column, water arcs, pigeons, children, houses behind
      skyStrip(S, 70, "crayon", COL.sky);
      sun(S, 40, 40, 80, "crayon", true, 10);
      // houses behind
      house(S, 40, 250, 210, 470, { wall: COL.peach, roof: COL.red, tool: "crayonThin" });
      house(S, 800, 240, 990, 470, { wall: COL.lemon, roof: COL.blue, tool: "crayonThin" });
      // plaza
      scribble(S, [[-10, 470], [W + 10, 470], [W + 10, H + 10], [-10, H + 10]], "crayon", "#D9C7A8", { passes: 1, pressure: 0.55, density: 1 });
      const grid = [];
      for (let k = 0; k < 9; k++) grid.push([[k * 120 + r.range(-10, 10), 475], [k * 140 - 80, H]]);
      lines(S, grid, "pencil", "#9E8A70");
      // basin
      const bx = 520, by = 560;
      const basin = [...P.circle(bx, by, 260, 70, Math.PI, Math.PI, 20), [bx + 260, by + 70], ...P.circle(bx, by + 70, 260, 60, 0, Math.PI, 20)];
      scribble(S, basin, "crayon", COL.grey, { passes: 1, pressure: 0.7 });
      outline(S, basin, "crayon", COL.black);
      scribble(S, P.circle(bx, by, 230, 50, 0, 6.3, 24), "crayon", COL.sky, { passes: 2 });
      // column and top bowl
      const col = P.rect(bx - 30, by - 230, bx + 30, by);
      scribble(S, col, "crayon", COL.grey, { passes: 1 });
      outline(S, col, "crayon", COL.black);
      const bowl = [...P.circle(bx, by - 230, 110, 26, Math.PI, Math.PI, 12), [bx + 70, by - 190], [bx - 70, by - 190]];
      scribble(S, bowl, "crayon", COL.grey, { passes: 1 });
      outline(S, bowl, "crayon", COL.black);
      // water arcs and drops
      const arcs = [];
      for (let k = 0; k < 7; k++) {
        const s = (k - 3) / 3;
        arcs.push([[bx, by - 250], [bx + s * 80, by - 330], [bx + s * 190, by - 260], [bx + s * 230, by - 90]]);
      }
      lines(S, arcs, "crayon", COL.blue, { pressure: 0.85 });
      const drops = [];
      for (let k = 0; k < 24; k++) { const x = bx + r.range(-260, 260), y = by + r.range(-200, -60); drops.push([[x, y], [x + 2, y + 10]]); }
      lines(S, drops, "crayonThin", COL.sky);
      // pigeons
      for (const [px, py] of [[180, 600], [840, 620], [900, 560]]) {
        const pg = P.circle(px, py, 34, 22, 0, 6.3, 14);
        scribble(S, pg, "crayon", COL.grey, { passes: 1 });
        outline(S, pg, "crayonThin", COL.black);
        scribble(S, P.circle(px - 34, py - 18, 15, 14, 0, 6.3, 10), "crayon", COL.grey, { passes: 1 });
        lines(S, [[[px - 50, py - 18], [px - 62, py - 14]], [[px - 5, py + 20], [px - 8, py + 34]], [[px + 8, py + 20], [px + 10, py + 34]]], "crayonThin", COL.orange);
      }
      person(S, 140, 700, 170, { hair: COL.black, shirt: COL.red, skin: COL.peach, tool: "crayonThin" });
      person(S, 930, 705, 160, { hair: COL.brown, dress: COL.yellow, long: true, skin: COL.peach, tool: "crayonThin" });
      write(S, "우리 마을 분수", 300, 40, 62, "marker", COL.navy);
      signature(S, "도윤", "bl", "pencil");
    },
    bus(S) {
      const { W, H } = S, r = S.r;
      // the village bus (cream and green) on the road with people in the windows; felt-tip markers
      skyStrip(S, 54, "marker", COL.sky);
      scribble(S, [[-10, H - 170], [W + 10, H - 175], [W + 10, H + 10], [-10, H + 10]], "marker", COL.grey, { passes: 1, density: 0.9 });
      const dash = [];
      for (let x = 20; x < W; x += 120) dash.push([[x, H - 80], [x + 60, H - 82]]);
      lines(S, dash, "markerFat", COL.white);
      lines(S, dash, "marker", COL.yellow);
      const x0 = 130, x1 = 860, y0 = 230, y1 = H - 150;
      const body = [[x0, y1], [x0, y0 + 40], [x0 + 40, y0], [x1 - 70, y0], [x1, y0 + 80], [x1, y1]];
      scribble(S, [[x0, y0 + 40], [x0 + 40, y0], [x1 - 70, y0], [x1, y0 + 80], [x1, y0 + 170], [x0, y0 + 170]], "marker", "#F2E7B8", { passes: 1, density: 0.8 });
      scribble(S, [[x0, y0 + 170], [x1, y0 + 170], [x1, y1], [x0, y1]], "marker", "#3F9A5B", { passes: 1, density: 0.8 });
      outline(S, body, "markerFat", COL.black);
      // windows with faces
      for (let k = 0; k < 5; k++) {
        const wx = x0 + 40 + k * 130, wy = y0 + 40;
        const wr = P.rect(wx, wy, wx + 100, wy + 100);
        scribble(S, wr, "marker", COL.sky, { passes: 1, density: 0.9 });
        outline(S, wr, "marker", COL.black);
        if (k !== 2) {
          const fx = wx + 50, fy = wy + 60;
          outline(S, P.circle(fx, fy, 26, 28, 0, 6.3, 16), "marker", COL.black);
          lines(S, [[[fx - 9, fy - 6], [fx - 9, fy - 2]], [[fx + 9, fy - 6], [fx + 9, fy - 2]], P.circle(fx, fy + 6, 10, 7, 0.3, 2.5, 6)], "marker", COL.black);
          lines(S, [P.circle(fx, fy - 6, 28, 26, Math.PI + 0.2, Math.PI - 0.4, 10)], "markerFat", r.pick([COL.brown, COL.black, COL.orange]));
        }
      }
      // door, lights, wheels
      outline(S, P.rect(x1 - 110, y0 + 70, x1 - 30, y1 - 10), "marker", COL.black);
      scribble(S, P.circle(x1 - 10, y1 - 60, 18, 18, 0, 6.3, 10), "marker", COL.yellow, { passes: 2 });
      for (const wx of [x0 + 150, x1 - 180]) {
        scribble(S, P.circle(wx, y1, 70, 70, 0, 6.3, 22), "markerFat", COL.black, { passes: 2 });
        scribble(S, P.circle(wx, y1, 26, 26, 0, 6.3, 12), "marker", COL.grey, { passes: 2 });
      }
      write(S, "케이슨 마을 버스", x0 + 160, y0 + 186, 48, "marker", "#F7F3E4", { mess: 0.9 });
      cloud(S, 830, 120, 90, "marker", COL.blue);
      write(S, "버스 타고 가요", 60, 90, 60, "marker", COL.red);
      signature(S, "예린", "br", "pencil");
    },
    coaster(S) {
      const { W, H } = S, r = S.r;
      // the roller coaster with a loop, cars with people arms up, "꺄~!"
      skyStrip(S, 50, "crayon", COL.sky);
      const track = [];
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        let x = 40 + t * 950, y = H - 120 - Math.sin(t * Math.PI * 1.15) * 360;
        track.push([x, y]);
      }
      // a loop in the middle
      const loop = P.circle(560, 330, 120, 130, Math.PI / 2, Math.PI * 2, 30);
      lines(S, [track.slice(0, 55), loop, track.slice(55)], "crayon", COL.red, { wscale: 1.3, pressure: 1 });
      lines(S, [track.slice(0, 55).map(([x, y]) => [x, y + 24]), track.slice(55).map(([x, y]) => [x, y + 24])], "crayonThin", COL.red);
      // supports
      const sup = [];
      for (let k = 0; k < 10; k++) { const p = track[k * 12]; sup.push([[p[0], p[1] + 24], [p[0] + r.range(-4, 4), H - 70]]); }
      lines(S, sup, "crayonThin", COL.grey);
      // cars
      for (let k = 0; k < 3; k++) {
        const p = track[22 + k * 9];
        const car = P.rect(p[0] - 40, p[1] - 55, p[0] + 34, p[1] - 4);
        scribble(S, car, "crayon", [COL.yellow, COL.blue, COL.green][k], { passes: 2 });
        outline(S, car, "crayon", COL.black);
        const fx = p[0] - 4, fy = p[1] - 84;
        outline(S, P.circle(fx, fy, 20, 22, 0, 6.3, 14), "crayonThin", COL.black);
        lines(S, [[[fx - 14, fy + 18], [fx - 36, fy - 36]], [[fx + 14, fy + 18], [fx + 36, fy - 36]], P.circle(fx, fy + 6, 8, 8, 0, 6.3, 8)], "crayonThin", COL.black);
      }
      grassStrip(S, H - 70);
      sun(S, W - 40, 30, 70);
      write(S, "꺄~!", 140, 180, 70, "crayon", COL.magenta);
      write(S, "롤러코스터", 600, 70, 64, "crayon", COL.blue);
      signature(S, "준서", "bl", "pencil");
    },
    appletree(S) {
      const { W, H } = S, r = S.r;
      skyStrip(S, 70);
      grassStrip(S, H - 120, "crayon", COL.green);
      const t = tree(S, 380, H - 110, 560, { apples: 9 });
      // a swing on the branch
      lines(S, [[[380 + 120, H - 380], [380 + 125, H - 230]], [[380 + 230, H - 380], [380 + 232, H - 230]]], "crayonThin", COL.brown);
      const seat = P.rect(380 + 100, H - 232, 380 + 255, H - 212);
      scribble(S, seat, "crayon", COL.red, { passes: 2 });
      person(S, 560, H - 228, 150, { hair: COL.orange, dress: COL.lime, long: true, skin: COL.peach, armL: [520, H - 380], armR: [610, H - 380], fingers: false });
      tree(S, 860, H - 115, 300, { leaf: COL.lime });
      for (const [bx, by] of [[700, 160], [760, 120], [820, 190]]) lines(S, [[[bx - 18, by], [bx, by - 12], [bx + 18, by]]], "crayonThin", COL.black);
      sun(S, 40, 30, 90);
      write(S, "사과나무", 640, 290, 60, "crayon", COL.red);
      signature(S, "수아", "br", "crayonThin", COL.purple);
    },
    lake(S) {
      const { W, H } = S, r = S.r;
      // watercolour: the lake with a boat and a fisherman above, fish below the water line
      wash(S, [[0, 0], [W, 0], [W, 260], [0, 280]], "#B7DBF2", { alpha: 0.5 });
      wash(S, [[0, 300], [W, 280], [W, H], [0, H]], "#4C9BD6", { alpha: 0.8, marks: 8 });
      wash(S, [[0, 290], [W * 0.4, 250], [W * 0.7, 270], [W, 250], [W, 300], [0, 320]], "#7FB76A", { alpha: 0.6 });
      // boat with fisherman
      const boat = [[330, 300], [610, 300], [570, 360], [370, 360]];
      wash(S, boat, "#B5713B", { alpha: 0.95, marks: 2 });
      outline(S, boat, "crayon", COL.brown);
      person(S, 470, 305, 180, { hair: COL.black, shirt: COL.yellow, skin: COL.peach, tool: "crayon", armR: [560, 190] });
      lines(S, [[[555, 195], [720, 110]], [[720, 110], [740, 300], [735, 470]]], "pencil", COL.black, { pressure: 1 });
      // fish
      const fishCols = [COL.orange, COL.yellow, COL.red, COL.pink, COL.green];
      for (let k = 0; k < 6; k++) {
        const fx = r.range(120, 900), fy = r.range(430, 660), s = r.range(36, 64), d = r() < 0.5 ? 1 : -1;
        const fish = [[fx - s * d, fy], [fx, fy - s * 0.55], [fx + s * d, fy], [fx + s * 1.4 * d, fy - s * 0.45], [fx + s * 1.4 * d, fy + s * 0.45], [fx + s * d, fy], [fx, fy + s * 0.55]];
        scribble(S, fish, "crayon", fishCols[k % 5], { passes: 2, outside: 0.2 });
        outline(S, fish, "crayonThin", COL.black);
        lines(S, [[[fx - s * 0.6 * d, fy - 6], [fx - s * 0.58 * d, fy - 2]]], "crayonThin", COL.black);
        lines(S, [P.circle(fx - s * 1.3 * d, fy - 40, 8, 8), P.circle(fx - s * 1.5 * d, fy - 70, 6, 6)], "crayonThin", COL.white);
      }
      // weeds
      const weed = [];
      for (let k = 0; k < 8; k++) { const x = r.range(40, 980); weed.push([[x, H], [x + 10, H - 40], [x - 6, H - 80], [x + 8, H - 120]]); }
      lines(S, weed, "crayon", COL.dkgreen);
      sun(S, W - 30, 30, 80, "crayon", false);
      write(S, "호수에서 낚시", 70, 60, 58, "pencil", COL.navy, { width: 5 });
      signature(S, "시우", "br", "crayonThin", COL.navy);
    },
    me(S) {
      const { W, H } = S, r = S.r;
      // a big self-portrait: one large person filling the sheet, "나"
      const p = person(S, W / 2, H - 50, 620, { hair: COL.black, long: false, shirt: COL.red, skin: COL.peach, cheeks: true, headRatio: 0.2, armL: [W / 2 - 320, 330], armR: [W / 2 + 320, 300] });
      // a ribbon and a star
      heart(S, W / 2 + 120, 120, 30, COL.pink);
      for (const [sx, sy] of [[120, 120], [880, 520], [180, 520]]) {
        const st = [];
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2; const R = k % 2 ? 22 : 52; st.push([sx + R * Math.cos(a), sy + R * Math.sin(a)]); }
        scribble(S, st, "crayon", COL.yellow, { passes: 2 });
        outline(S, st, "crayonThin", COL.orange);
      }
      write(S, "나", 120, 300, 130, "crayon", COL.blue, { mess: 1.2 });
      write(S, "1학년 2반", 680, 60, 50, "pencil", "#4A4A52", { width: 4.5 });
      signature(S, "유나", "br", "pencil");
    },
    butterfly(S) {
      const { W, H } = S, r = S.r;
      // felt-tip: a big symmetrical butterfly, a ladybug, flowers, dotted flight path
      const cx = W / 2 - 40, cy = H / 2 - 10;
      const wings = [
        [[cx, cy - 20], [cx - 140, cy - 260], [cx - 330, cy - 210], [cx - 300, cy - 30], [cx, cy]],
        [[cx, cy], [cx - 260, cy + 40], [cx - 250, cy + 220], [cx - 70, cy + 200], [cx, cy + 40]],
      ];
      const mirror = (w) => w.map(([x, y]) => [2 * cx - x, y]);
      const wc = [COL.purple, COL.pink];
      for (let k = 0; k < 2; k++) {
        for (const w of [wings[k], mirror(wings[k])]) {
          scribble(S, w, "marker", wc[k], { passes: 1, density: 0.7 });
          outline(S, w, "markerFat", COL.black);
        }
      }
      for (const [dx, dy, rr] of [[-200, -150, 40], [-160, 100, 34], [-90, -60, 22]]) for (const s of [-1, 1]) scribble(S, P.circle(cx + s * -dx, cy + dy, rr, rr, 0, 6.3, 14), "marker", COL.yellow, { passes: 2 });
      scribble(S, P.circle(cx, cy + 20, 26, 130, 0, 6.3, 20), "markerFat", COL.black, { passes: 2 });
      lines(S, [[[cx - 8, cy - 100], [cx - 60, cy - 200], [cx - 70, cy - 210]], [[cx + 8, cy - 100], [cx + 60, cy - 200], [cx + 70, cy - 210]]], "marker", COL.black);
      // dotted flight
      const dots = [];
      for (let k = 0; k < 14; k++) { const x = 60 + k * 26, y = 640 - Math.sin(k / 2) * 40 - k * 8; dots.push([[x, y], [x + 8, y]]); }
      lines(S, dots, "marker", COL.grey);
      // ladybug
      const lx = 860, ly = 620;
      scribble(S, P.circle(lx, ly, 60, 46, 0, 6.3, 18), "markerFat", COL.red, { passes: 1 });
      lines(S, [[[lx, ly - 46], [lx, ly + 46]]], "marker", COL.black);
      for (const [dx, dy] of [[-30, -10], [28, 14], [-20, 26], [30, -18]]) scribble(S, P.circle(lx + dx, ly + dy, 9, 9, 0, 6.3, 8), "marker", COL.black, { passes: 2 });
      scribble(S, P.circle(lx - 64, ly - 10, 22, 20, 0, 6.3, 10), "markerFat", COL.black, { passes: 1 });
      flower(S, 900, 330, 220, COL.orange, { tool: "marker", petalSize: 0.2 });
      write(S, "나비야", 70, 40, 72, "marker", COL.purple);
      signature(S, "건우", "bl", "marker", COL.blue);
    },
    night(S) {
      const { W, H } = S, r = S.r;
      // dark blue crayon pressed hard over the sky, coloured around the stars and the moon; houses with lit windows
      const stars = [];
      for (let k = 0; k < 14; k++) stars.push([r.range(60, W - 60), r.range(40, 360), r.range(18, 32)]);
      const starPoly = ([sx, sy, R], g = 1) => {
        const st = [];
        for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2; const rr = (k % 2 ? R * 0.45 : R) * g; st.push([sx + rr * Math.cos(a), sy + rr * Math.sin(a)]); }
        return st;
      };
      const mx = 820, my = 150;
      const moon = [...P.circle(mx, my, 90, 90, -1.2, 4.2, 24), ...P.circle(mx + 40, my - 20, 70, 72, 2.4, -3.6, 20)];
      scribble(S, [[-10, -10], [W + 10, -10], [W + 10, 450], [-10, 470]], "crayon", COL.navy, { passes: 3, density: 0.6, pressure: 0.95, skip: 0.01, holes: [...stars.map((s2) => starPoly(s2, 1.25)), P.circle(mx + 6, my - 4, 104, 104, 0, 6.3, 24)] });
      for (const s2 of stars) {
        scribble(S, starPoly(s2), "crayon", COL.lemon, { passes: 2, outside: 0.15 });
        outline(S, starPoly(s2), "crayonThin", COL.orange, { pressure: 0.7 });
      }
      scribble(S, moon, "crayon", COL.lemon, { passes: 3, outside: 0.15 });
      outline(S, moon, "crayon", COL.orange, { pressure: 0.8 });
      const hs = [[60, 470, 260], [300, 430, 480], [540, 480, 700], [740, 450, 960]];
      for (const [x0, y0, x1] of hs) house(S, x0, y0, x1, H - 60, { wall: COL.brown, roof: COL.red, glass: COL.yellow, tool: "crayon" });
      grassStrip(S, H - 60, "crayon", COL.dkgreen, false);
      write(S, "밤하늘", 70, 330, 60, "crayon", COL.white);
      signature(S, "소율", "br", "pencil");
    },
    handprints(S) {
      const { W, H } = S, r = S.r;
      // paint handprints in a ring (a flower), fingers splayed, a painted stem; brush strokes
      const hand = (cx, cy, s, ang, col) => {
        // local: palm centre (0, 0.25), fingers up (-y); a capsule per finger from the palm's top edge
        const tr = ([x, y]) => [cx + (x * Math.cos(ang) - y * Math.sin(ang)) * s, cy + (x * Math.sin(ang) + y * Math.cos(ang)) * s];
        const shapes = [P.circle(0, 0.28, 0.4, 0.46, 0, 6.3, 20)];
        const fingers = [[-158, 0.42, 0.12, -0.36, 0.3], [-112, 0.6, 0.105, -0.26, -0.06], [-93, 0.68, 0.11, -0.08, -0.14], [-76, 0.64, 0.105, 0.1, -0.12], [-58, 0.5, 0.095, 0.27, -0.02]];
        for (const [deg, L, w, bx, by] of fingers) {
          const a = (deg * Math.PI) / 180 + r.range(-0.08, 0.08);
          const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
          const f = [[bx + nx * w, by + ny * w], [bx + dx * L + nx * w, by + dy * L + ny * w]];
          for (let i = 1; i < 8; i++) { const t = (i / 8) * Math.PI; f.push([bx + dx * L + (nx * Math.cos(t) + dx * Math.sin(t)) * w, by + dy * L + (ny * Math.cos(t) + dy * Math.sin(t)) * w]); }
          f.push([bx + dx * L - nx * w, by + dy * L - ny * w], [bx - nx * w, by - ny * w]);
          shapes.push(f);
        }
        wash(S, shapes.map((pg) => pg.map(tr)), col, { alpha: 0.95, amp: 2.5, marks: 1 });
      };
      const cx = W / 2 - 60, cy = 300;
      wash(S, [[cx - 14, cy], [cx + 14, cy], [cx + 24, H - 40], [cx - 6, H - 40]], "#3E9A43", { alpha: 0.9, marks: 2 });
      wash(S, [[cx, H - 200], [cx + 170, H - 300], [cx + 210, H - 250], [cx + 10, H - 160]], "#55B04A", { alpha: 0.9 });
      const cols = ["#E5483F", "#F29B2E", "#F2CF2C", "#3E8FD8", "#8D5BC2", "#EC73AE"];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        hand(cx + Math.cos(a) * 190, cy + Math.sin(a) * 175, 130, a + Math.PI / 2, cols[k]);
      }
      wash(S, P.circle(cx, cy, 80, 80, 0, 6.3, 20), "#F6D33A", { alpha: 1 });
      write(S, "엄마 사랑해요", 620, 120, 52, "crayon", COL.red);
      heart(S, 830, 260, 40, COL.red);
      signature(S, "은호", "br", "crayonThin", COL.blue);
    },
    dino(S) {
      const { W, H } = S, r = S.r;
      // a green dinosaur with plates, a volcano, a palm tree, an egg; crayon pressed hard
      skyStrip(S, 60, "crayon", "#F2A04A");
      const vol = [[620, H - 120], [770, 230], [850, 230], [1000, H - 120]];
      scribble(S, vol, "crayon", COL.brown, { passes: 2 });
      outline(S, vol, "crayon", COL.black);
      lines(S, [[[790, 225], [760, 110]], [[810, 225], [815, 90]], [[830, 225], [870, 120]]], "crayon", COL.red, { wscale: 1.4 });
      scribble(S, P.circle(810, 200, 60, 26, 0, 6.3, 14), "crayon", COL.orange, { passes: 2 });
      grassStrip(S, H - 120, "crayon", COL.lime);
      const body = [[160, 470], [240, 330], [420, 300], [560, 380], [640, 470], [740, 520], [560, 520], [520, 600], [470, 600], [460, 530], [300, 530], [290, 610], [240, 610], [230, 520], [160, 500]];
      const neck = [[240, 340], [200, 190], [160, 150], [80, 150], [60, 190], [120, 210], [170, 230], [210, 360]];
      scribble(S, body, "crayon", COL.green, { passes: 2, outside: 0.6 });
      scribble(S, neck, "crayon", COL.green, { passes: 2, outside: 0.6 });
      outline(S, body, "crayon", COL.dkgreen);
      outline(S, neck, "crayon", COL.dkgreen);
      const plates = [];
      for (let k = 0; k < 6; k++) { const x = 270 + k * 52, y = 300 - Math.sin(k / 5 * Math.PI) * 20; plates.push([[x - 22, y + 10], [x, y - 50], [x + 22, y + 10]]); }
      for (const pl of plates) { scribble(S, pl, "crayon", COL.orange, { passes: 1 }); outline(S, pl, "crayonThin", COL.red); }
      lines(S, [[[118, 172], [120, 180]], P.circle(90, 190, 26, 10, 0.2, 2.4, 8)], "crayon", COL.black, { wscale: 1.2 });
      for (let k = 0; k < 5; k++) lines(S, [P.circle(300 + k * 60, 420 + (k % 2) * 30, 14, 12)], "crayonThin", COL.dkgreen);
      // palm and an egg
      lines(S, [[[90, H - 120], [110, 380], [100, 330]]], "crayon", COL.brown, { wscale: 2 });
      const fr = [];
      for (let k = 0; k < 6; k++) { const a = -Math.PI + (k / 5) * Math.PI; fr.push([[100, 330], [100 + Math.cos(a) * 110, 330 + Math.sin(a) * 60 + 40]]); }
      lines(S, fr, "crayon", COL.dkgreen, { wscale: 1.6 });
      scribble(S, P.circle(560, H - 90, 40, 52, 0, 6.3, 16), "crayon", "#F4EBD2", { passes: 2 });
      outline(S, P.circle(560, H - 90, 40, 52, 0, 6.3, 16), "crayonThin", COL.brown);
      lines(S, [[[525, H - 95], [545, H - 80], [560, H - 100], [580, H - 82], [598, H - 96]]], "crayonThin", COL.brown);
      write(S, "공룡", 380, 120, 96, "crayon", COL.dkgreen, { mess: 1.25 });
      write(S, "크앙!", 30, 60, 56, "marker", COL.red);
      signature(S, "태오", "br", "pencil");
    },
    spring(S) {
      const { W, H } = S, r = S.r;
      // graphite pencil drawing, only partly coloured (an unfinished picture): a house, a path, a girl with an umbrella, rain
      const g = "#55555C";
      house(S, 520, 300, 860, H - 140, { tool: "graphite", line: g, roof: "#E4E4E4", roofLine: g, door: "#E8E8E8", glass: "#EFEFEF" });
      lines(S, [[[640, H - 140], [560, H - 20]], [[720, H - 140], [790, H - 20]]], "graphite", g);
      // only the roof and some of the path coloured, the rest left
      scribble(S, [[500, 304], [690, 110], [880, 304]], "pencil", COL.red, { passes: 1, density: 1.1, outside: 0.3, pressure: 0.7 });
      scribble(S, [[640, H - 140], [720, H - 140], [760, H - 70], [600, H - 70]], "pencil", COL.tan, { passes: 1, pressure: 0.6 });
      const pp = person(S, 260, H - 110, 300, { tool: "graphite", line: g, hair: g, long: true, dress: null, armR: [360, 320], fingers: false });
      // umbrella
      const um = [...P.circle(380, 260, 150, 110, Math.PI, Math.PI, 20)];
      scribble(S, um, "pencil", COL.yellow, { passes: 1, pressure: 0.65 });
      lines(S, [um.concat([[530, 260], [480, 280], [430, 260], [380, 285], [330, 260], [280, 282], [230, 260]]), [[380, 150], [380, 330], [365, 345]]], "graphite", g);
      // rain
      const rain = [];
      for (let k = 0; k < 40; k++) { const x = r.range(20, W - 20), y = r.range(20, H - 160); if (x > 220 && x < 540 && y < 280) continue; rain.push([[x, y], [x - 8, y + 26]]); }
      lines(S, rain, "pencil", COL.sky, { pressure: 0.8 });
      // erased lines (lighter ghost of a first try)
      lines(S, [[[560, 280], [700, 160], [840, 290]], P.circle(240, 300, 40, 40)], "graphite", "#B8B8BC", { pressure: 0.35 });
      write(S, "비 오는 날", 600, 40, 62, "graphite", g, { width: 4 });
      signature(S, "다인", "bl", "graphite", g);
    },
  };

  // ------------------------------------------------------------------------------------ printed / teacher's sheets --
  function printText(ctx, text, x, y, size, colour, weight = "bold", align = "left", font = "'Malgun Gothic'") {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, x, y);
  }
  /** Paint a canvas (printed sheet) onto the sheet's colour, multiplied like ink on paper. */
  function inkCanvas(S, cv, mode = "multiply") {
    const d = cv.getContext("2d").getImageData(0, 0, S.W, S.H).data;
    for (let i = 0; i < S.W * S.H; i++) {
      const a = d[i * 4 + 3] / 255;
      if (a <= 0) continue;
      for (let ch = 0; ch < 3; ch++) {
        const c = d[i * 4 + ch];
        S.col[i * 3 + ch] = mode === "multiply" ? S.col[i * 3 + ch] * lerp(1, c / 255, a) : lerp(S.col[i * 3 + ch], c, a);
      }
    }
  }
  function blank(W, H) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    return cv;
  }

  function chalkboard(S) {
    const { W, H } = S, r = S.r;
    // slate green, faint eraser haze (brand new: just one wipe), the teacher's chalk: date, weather, today's work, a sum, a drawing
    const n = noise2(S.seed + 5);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const haze = Math.max(0, n.fbm(x / 300, y / 90, 3)) * 0.12 + Math.max(0, n.fbm(x / 60 + 40, y / 200, 2)) * 0.05;
        const g = 1 + (S.tooth[i] - 0.5) * 0.08;
        S.col[i * 3] = (0x2F + haze * 120) * g;
        S.col[i * 3 + 1] = (0x55 + haze * 110) * g;
        S.col[i * 3 + 2] = (0x45 + haze * 100) * g;
        S.rough[i] = 0.9;
      }
    const chalk = "#F2F0E6";
    const write2 = (t, x, y, s, col = chalk, o = {}) => write(S, t, x, y, s, "chalk", col, { mess: 0.35, width: s * 0.07, amp: 0.8, ...o });
    write2("11월 20일 금요일", 70, 50, 64);
    write2("날씨: 맑음", 70, 140, 56);
    sun(S, 420, 165, 26, "chalk", false, 9);
    write2("오늘 할 일", 760, 50, 72, "#F6E08A");
    write2("1. 받아쓰기", 780, 150, 56);
    write2("2. 그림 그리기", 780, 230, 56);
    write2("3. 줄넘기", 780, 310, 56);
    write2("3 + 4 = 7", 1460, 70, 70);
    write2("5 + 2 = 7", 1460, 160, 70);
    write2("8 - 3 = ?", 1460, 250, 70, "#F7B8C8");
    // a chalk flower and a house drawn by the class
    flower(S, 1640, 640, 210, "#F7B8C8", { tool: "chalk", petalSize: 0.18, centre: "#F6E08A" });
    outline(S, P.rect(1260, 470, 1460, 640), "chalk", chalk);
    outline(S, [[1240, 474], [1360, 370], [1480, 474]], "chalk", "#F7B8C8");
    write2("주번: 하늘, 도윤", 70, 560, 50, "#B8E0F6");
    write2("참 잘했어요!", 360, 400, 62, "#F6E08A");
    // a little chalk dust along the bottom edge
    begin(S);
    for (let k = 0; k < 200; k++) { const x = r.range(0, W), y = H - r.range(2, 40); const gq = Math.round(r.range(0.05, 0.2) * 255); S.ctx.fillStyle = `rgb(${gq},${gq},${gq})`; S.ctx.fillRect(x, y, r.range(2, 12), r.range(1, 3)); }
    deposit(S, "chalk", chalk, 0.5);
  }

  function hangulCards(S) {
    const { W, H } = S;
    // 14 cards (ㄱ..ㅎ), each a coloured rounded card with the letter and its name
    const cv = blank(W, H), c = cv.getContext("2d");
    const names = [["ㄱ", "기역"], ["ㄴ", "니은"], ["ㄷ", "디귿"], ["ㄹ", "리을"], ["ㅁ", "미음"], ["ㅂ", "비읍"], ["ㅅ", "시옷"], ["ㅇ", "이응"], ["ㅈ", "지읒"], ["ㅊ", "치읓"], ["ㅋ", "키읔"], ["ㅌ", "티읕"], ["ㅍ", "피읖"], ["ㅎ", "히읗"]];
    const cols = ["#F08A80", "#F5B45E", "#F2D25E", "#9FD27C", "#6FC3B8", "#7FB2E6", "#A894DC", "#F39AC4"];
    const cw = W / 14;
    names.forEach(([j, nm], k) => {
      const x = k * cw;
      c.fillStyle = cols[k % cols.length];
      c.beginPath();
      c.roundRect(x + 6, 6, cw - 12, H - 12, 18);
      c.fill();
      c.fillStyle = "#FFFDF6";
      c.beginPath();
      c.roundRect(x + 16, 16, cw - 32, H * 0.66, 12);
      c.fill();
      printText(c, j, x + cw / 2, H * 0.56, H * 0.48, "#2B2B33", "bold", "center");
      printText(c, nm, x + cw / 2, H - 22, H * 0.16, "#FFFFFF", "bold", "center");
    });
    inkCanvas(S, cv, "over");
  }

  function labels(S) {
    const { W, H } = S;
    const items = [["크레파스", "#E5483F"], ["색연필", "#F29B2E"], ["가위", "#3E8FD8"], ["풀", "#4FA34A"], ["색종이", "#EC73AE"], ["물감", "#8D5BC2"], ["블록", "#E0B53A"], ["공책", "#2B9C9A"]];
    const cv = blank(W, H), c = cv.getContext("2d");
    const lw = W / items.length;
    items.forEach(([t, col], k) => {
      const x = k * lw;
      c.fillStyle = "#FFFFFF";
      c.fillRect(x + 4, 4, lw - 8, H - 8);
      c.fillStyle = col;
      c.fillRect(x + 4, 4, 34, H - 8);
      c.strokeStyle = "#CFCAC0";
      c.lineWidth = 2;
      c.strokeRect(x + 4, 4, lw - 8, H - 8);
      printText(c, t, x + 38 + (lw - 46) / 2, H * 0.64, Math.min(H * 0.42, (lw - 60) / (t.length * 0.95)), "#26262C", "bold", "center");
    });
    inkCanvas(S, cv, "over");
    for (let i = 0; i < S.W * S.H; i++) S.rough[i] = 0.35;
  }

  function clockFace(S) {
    const { W, H } = S;
    const cv = blank(W, H), c = cv.getContext("2d");
    const cx = W / 2, cy = H / 2, R = W * 0.47;
    c.fillStyle = "#FFFFFF";
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#1E1E24";
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      const big = k % 5 === 0;
      c.lineWidth = big ? 9 : 3;
      c.beginPath();
      c.moveTo(cx + Math.sin(a) * R * (big ? 0.84 : 0.9), cy - Math.cos(a) * R * (big ? 0.84 : 0.9));
      c.lineTo(cx + Math.sin(a) * R * 0.96, cy - Math.cos(a) * R * 0.96);
      c.stroke();
    }
    for (let h = 1; h <= 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      printText(c, String(h), cx + Math.sin(a) * R * 0.68, cy - Math.cos(a) * R * 0.68 + R * 0.075, R * 0.2, "#1E1E24", "bold", "center", "Arial");
    }
    inkCanvas(S, cv, "over");
    for (let i = 0; i < S.W * S.H; i++) S.rough[i] = 0.5;
  }

  function timetable(S) {
    const { W, H } = S;
    const cv = blank(W, H), c = cv.getContext("2d");
    printText(c, "우리 반 시간표", W / 2, 70, 46, "#2E4E8E", "bold", "center");
    const days = ["", "월", "화", "수", "목", "금"];
    const subj = [["국어", "수학", "국어", "통합", "수학"], ["수학", "국어", "통합", "국어", "체육"], ["통합", "통합", "음악", "수학", "국어"], ["체육", "미술", "", "통합", "창체"], ["창체", "", "", "안전", ""]];
    const sc = { 국어: "#F7C9C4", 수학: "#C8DDF4", 통합: "#D5EBC6", 체육: "#F8E2B0", 미술: "#E6D3F2", 음악: "#F6D0E4", 창체: "#D8EFEA", 안전: "#F4E3C8" };
    const gx = 26, gy = 100, cw = (W - 52) / 6, rh = (H - 130) / 6;
    for (let rI = 0; rI < 6; rI++)
      for (let cI = 0; cI < 6; cI++) {
        const x = gx + cI * cw, y = gy + rI * rh;
        let label = "", fill = "#FFFFFF";
        if (rI === 0) { label = days[cI]; fill = "#2E4E8E"; }
        else if (cI === 0) { label = `${rI}교시`; fill = "#EEF2F8"; }
        else { label = subj[rI - 1][cI - 1]; fill = label ? sc[label] : "#FFFFFF"; }
        c.fillStyle = fill;
        c.fillRect(x, y, cw, rh);
        c.strokeStyle = "#7C8AA6";
        c.lineWidth = 2;
        c.strokeRect(x, y, cw, rh);
        if (label) printText(c, label, x + cw / 2, y + rh * 0.66, rI === 0 ? 30 : cI === 0 ? 22 : 28, rI === 0 ? "#FFFFFF" : "#2A2A32", "bold", "center");
      }
    inkCanvas(S, cv, "over");
    for (let i = 0; i < S.W * S.H; i++) S.rough[i] = 0.4;
  }

  function cork(S) {
    const { W, H } = S, r = S.r;
    // granulated cork: grains 1–3 mm (2–6 px at ~2 px/mm), light and dark crumbs, a fine binder between
    const n = noise2(S.seed + 3);
    const base = hex("#BE9161");
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const v = n(x / 2.7, y / 2.7) * 0.6 + n(x / 6, y / 6) * 0.4 + (S.tooth[i] - 0.5) * 0.6;
        const t = 0.86 + v * 0.42;
        S.col[i * 3] = base[0] * t;
        S.col[i * 3 + 1] = base[1] * t * 0.98;
        S.col[i * 3 + 2] = base[2] * t * 0.94;
        S.hgt[i] = 0.5 + v * 0.12;
        S.rough[i] = 0.95;
      }
    for (let k = 0; k < W * H * 0.004; k++) {
      const x = r.int(0, W - 1), y = r.int(0, H - 1), dark = r() < 0.55;
      const rr = r.int(1, 3);
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          if (dx * dx + dy * dy > rr * rr || x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H) continue;
          const i = (y + dy) * W + x + dx;
          const f = dark ? 0.7 : 1.15;
          S.col[i * 3] *= f; S.col[i * 3 + 1] *= f; S.col[i * 3 + 2] *= f;
          S.hgt[i] += dark ? -0.04 : 0.04;
        }
    }
  }

  function exercise(S) {
    const { W, H } = S;
    // an open 공책 (two pages): blue rules, a red margin, a child's 받아쓰기 in pencil with a teacher's red circle
    const cv = blank(W, H), c = cv.getContext("2d");
    c.strokeStyle = "#9CB8DC";
    c.lineWidth = 2;
    for (let y = 70; y < H - 10; y += 46) { c.beginPath(); c.moveTo(14, y); c.lineTo(W - 14, y); c.stroke(); }
    c.strokeStyle = "#E39A9A";
    for (const x of [60, W / 2 + 46]) { c.beginPath(); c.moveTo(x, 10); c.lineTo(x, H - 10); c.stroke(); }
    c.fillStyle = "rgba(120,110,90,0.25)";
    c.fillRect(W / 2 - 3, 0, 6, H);
    inkCanvas(S, cv);
    const lines2 = ["1. 나무", "2. 바다", "3. 하늘", "4. 친구", "5. 학교"];
    lines2.forEach((t, k) => write(S, t, 72, 30 + k * 46, 36, "graphite", "#4A4A52", { mess: 0.9, width: 3 }));
    ["6. 마을", "7. 고양이", "8. 사과"].forEach((t, k) => write(S, t, W / 2 + 56, 30 + k * 46, 36, "graphite", "#4A4A52", { mess: 0.9, width: 3 }));
    outline(S, P.circle(W - 110, H - 90, 70, 60), "crayonThin", COL.red, { pressure: 0.9 });
    write(S, "100", W - 170, H - 120, 50, "crayonThin", COL.red, { mess: 0.4 });
  }

  function paperBack(S) {
    // the back of a drawing: the paper, a ghost of crayon showing through (mirrored, very faint), a name in pencil
    const { W, H } = S, r = S.r;
    begin(S);
    S.ctx.filter = "blur(10px)";
    for (let k = 0; k < 20; k++) { const x = r.range(0, W), y = r.range(0, H); const gq = Math.round(r.range(0.15, 0.4) * 255); S.ctx.fillStyle = `rgb(${gq},${gq},${gq})`; S.ctx.beginPath(); S.ctx.ellipse(x, y, r.range(30, 120), r.range(20, 80), r() * 3, 0, 6.3); S.ctx.fill(); }
    deposit(S, "paint", "#EFE9DE", 0.5);
  }

  function tape(S) {
    // masking tape: crepe paper with fine creases across, slightly translucent cream
    const { W, H } = S;
    const n = noise2(S.seed + 9);
    const base = hex("#EEE2BE");
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const crepe = n(x / 1.6, y / 30) * 0.5 + n(x / 4, y / 60) * 0.3;
        const t = 0.95 + crepe * 0.08;
        S.col[i * 3] = base[0] * t; S.col[i * 3 + 1] = base[1] * t; S.col[i * 3 + 2] = base[2] * t;
        S.hgt[i] = 0.5 + crepe * 0.05;
        S.rough[i] = 0.75;
      }
  }

  function pageEdges(S) {
    // a book's page block seen from above/the fore-edge: fine cream lines
    const { W, H } = S;
    const n = noise2(S.seed + 2);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const l = 0.92 + 0.08 * Math.sin(y * 2.4 + n(x / 40, y / 3) * 3);
        S.col[i * 3] = 246 * l; S.col[i * 3 + 1] = 240 * l; S.col[i * 3 + 2] = 224 * l;
        S.hgt[i] = 0.5 + (l - 0.92) * 0.5;
        S.rough[i] = 0.9;
      }
  }

  /** Children's picture-book spines (vertical Korean titles), coloured covers with a darker band, a small publisher block. */
  const SPINES = [
    ["토끼의 소풍", "#E9594B"], ["꿈꾸는 나무", "#3F9A5B"], ["작은 등대", "#2E63C2"], ["빨간 우산", "#D8423A"], ["하늘을 나는 버스", "#F2C230"],
    ["곰돌이 요리사", "#8A5A33"], ["비 오는 날", "#58A9E0"], ["씨앗 하나", "#8CC63E"], ["케이슨 마을 이야기", "#7E55A8"], ["수학 놀이", "#EE8A2F"],
    ["과학 탐구", "#2B9C9A"], ["동시 모음", "#EC7FB0"], ["그림 사전", "#F6DF4A"], ["한글 놀이", "#4F9E45"], ["1학년 국어", "#2E4E8E"],
    ["바다 친구들", "#3E8FD8"], ["공룡 탐험", "#5C8F3A"], ["별을 세는 아이", "#24357A"], ["달팽이 학교", "#C8378A"], ["숲속 음악회", "#9B6B3D"],
    ["우리 동네 지도", "#E0B53A"], ["눈사람 친구", "#9CC8E8"], ["노래하는 고래", "#2C6E9E"], ["색깔 놀이", "#F08A80"],
  ];
  function spines(S, w, h) {
    const { W, H } = S;
    const cv = blank(W, H), c = cv.getContext("2d");
    SPINES.forEach(([t, col], k) => {
      const x = k * w;
      c.fillStyle = col;
      c.fillRect(x, 0, w, h);
      const light = parseInt(col.slice(1, 3), 16) * 0.299 + parseInt(col.slice(3, 5), 16) * 0.587 + parseInt(col.slice(5, 7), 16) * 0.114 > 160;
      c.fillStyle = "rgba(0,0,0,0.12)";
      c.fillRect(x, h * 0.06, w, h * 0.035);
      c.fillRect(x, h * 0.86, w, h * 0.035);
      c.fillStyle = light ? "rgba(255,255,255,0.0)" : "rgba(255,255,255,0.06)";
      c.fillRect(x + w * 0.1, 0, w * 0.15, h);
      // vertical title, one syllable under the other
      const chars = [...t].filter((ch) => ch !== " ");
      const fs = Math.min(w * 0.62, (h * 0.66) / chars.length);
      chars.forEach((ch, i) => printText(c, ch, x + w / 2, h * 0.14 + fs * (i + 0.9), fs, light ? "#26262C" : "#FFFDF4", "bold", "center"));
      c.fillStyle = light ? "#26262C" : "#FFFDF4";
      c.beginPath(); c.arc(x + w / 2, h * 0.94, w * 0.18, 0, Math.PI * 2); c.fill();
    });
    inkCanvas(S, cv, "over");
    for (let i = 0; i < W * H; i++) S.rough[i] = 0.45;
  }

  // ------------------------------------------------------------------------------------------------- the cells --
  const PAPERS = ["#FCFAF3", "#FBF8EF", "#FAF7F0", "#FDFBF6", "#F9F5EA"];
  window.KIDART = Object.keys(DRAW);
  window.SPINE_COUNT = SPINES.length;

  /**
   * The picture books' front covers (one per spine, the spine's colour): a printed cover — a flat colour field, a framed
   * picture panel with a simple illustration in clean print shapes (a sun over hills, a tree, a house, a flower, a fish, a moon
   * and stars, a cat, a bus), the title in bold, a small publisher's mark.
   */
  function covers(S, cw, ch) {
    const { W, H } = S;
    const cv = blank(W, H), c = cv.getContext("2d");
    const cols = Math.floor(W / cw);
    const shapes = [
      (x, y, w, h) => { c.fillStyle = "#F6C83A"; c.beginPath(); c.arc(x + w * 0.72, y + h * 0.3, w * 0.14, 0, 7); c.fill(); c.fillStyle = "#6DB55A"; c.beginPath(); c.ellipse(x + w * 0.3, y + h, w * 0.55, h * 0.45, 0, Math.PI, 0); c.fill(); c.fillStyle = "#4C9A47"; c.beginPath(); c.ellipse(x + w * 0.85, y + h, w * 0.45, h * 0.32, 0, Math.PI, 0); c.fill(); },
      (x, y, w, h) => { c.fillStyle = "#8A5A33"; c.fillRect(x + w * 0.46, y + h * 0.5, w * 0.08, h * 0.45); c.fillStyle = "#4FA34A"; c.beginPath(); c.arc(x + w * 0.5, y + h * 0.4, w * 0.3, 0, 7); c.fill(); c.fillStyle = "#E2453C"; for (const [a, b] of [[0.4, 0.35], [0.6, 0.45], [0.52, 0.28]]) { c.beginPath(); c.arc(x + w * a, y + h * b, w * 0.04, 0, 7); c.fill(); } },
      (x, y, w, h) => { c.fillStyle = "#F3DE9A"; c.fillRect(x + w * 0.25, y + h * 0.45, w * 0.5, h * 0.45); c.fillStyle = "#D9574A"; c.beginPath(); c.moveTo(x + w * 0.18, y + h * 0.47); c.lineTo(x + w * 0.5, y + h * 0.15); c.lineTo(x + w * 0.82, y + h * 0.47); c.fill(); c.fillStyle = "#7A4E2E"; c.fillRect(x + w * 0.44, y + h * 0.65, w * 0.12, h * 0.25); },
      (x, y, w, h) => { c.fillStyle = "#3FA35A"; c.fillRect(x + w * 0.48, y + h * 0.45, w * 0.04, h * 0.5); c.fillStyle = "#EC7FB0"; for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.283; c.beginPath(); c.arc(x + w * 0.5 + Math.cos(a) * w * 0.13, y + h * 0.38 + Math.sin(a) * w * 0.13, w * 0.1, 0, 7); c.fill(); } c.fillStyle = "#F6C83A"; c.beginPath(); c.arc(x + w * 0.5, y + h * 0.38, w * 0.08, 0, 7); c.fill(); },
      (x, y, w, h) => { c.fillStyle = "#F08A2F"; c.beginPath(); c.ellipse(x + w * 0.45, y + h * 0.55, w * 0.25, h * 0.16, 0, 0, 7); c.fill(); c.beginPath(); c.moveTo(x + w * 0.68, y + h * 0.55); c.lineTo(x + w * 0.88, y + h * 0.4); c.lineTo(x + w * 0.88, y + h * 0.7); c.fill(); c.fillStyle = "#222"; c.beginPath(); c.arc(x + w * 0.32, y + h * 0.52, w * 0.025, 0, 7); c.fill(); },
      (x, y, w, h) => { c.fillStyle = "#F6DF4A"; c.beginPath(); c.arc(x + w * 0.5, y + h * 0.45, w * 0.22, 0, 7); c.fill(); c.fillStyle = c.__bg; c.beginPath(); c.arc(x + w * 0.6, y + h * 0.4, w * 0.2, 0, 7); c.fill(); c.fillStyle = "#F6DF4A"; for (const [a, b] of [[0.2, 0.2], [0.8, 0.75], [0.25, 0.8]]) { c.beginPath(); c.arc(x + w * a, y + h * b, w * 0.03, 0, 7); c.fill(); } },
      (x, y, w, h) => { c.fillStyle = "#F08A2F"; c.beginPath(); c.arc(x + w * 0.5, y + h * 0.55, w * 0.26, 0, 7); c.fill(); for (const sg of [-1, 1]) { c.beginPath(); c.moveTo(x + w * (0.5 + sg * 0.24), y + h * 0.45); c.lineTo(x + w * (0.5 + sg * 0.22), y + h * 0.18); c.lineTo(x + w * (0.5 + sg * 0.06), y + h * 0.33); c.fill(); } c.fillStyle = "#222"; for (const sg of [-1, 1]) { c.beginPath(); c.arc(x + w * (0.5 + sg * 0.1), y + h * 0.52, w * 0.03, 0, 7); c.fill(); } },
      (x, y, w, h) => { c.fillStyle = "#3F9A5B"; c.fillRect(x + w * 0.12, y + h * 0.35, w * 0.76, h * 0.35); c.fillStyle = "#F2E7B8"; c.fillRect(x + w * 0.12, y + h * 0.35, w * 0.76, h * 0.14); c.fillStyle = "#9CC8E8"; for (let k = 0; k < 4; k++) c.fillRect(x + w * (0.16 + k * 0.17), y + h * 0.37, w * 0.12, h * 0.1); c.fillStyle = "#222"; for (const a of [0.3, 0.72]) { c.beginPath(); c.arc(x + w * a, y + h * 0.72, w * 0.07, 0, 7); c.fill(); } },
    ];
    SPINES.forEach(([t, col], k) => {
      const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
      c.__bg = col;
      c.fillStyle = col;
      c.fillRect(x, y, cw, ch);
      const words0 = t.split(" ");
      const two = words0.length > 2 || (words0.length === 2 && t.length > 5);
      const px = x + cw * 0.12, py = y + ch * (two ? 0.37 : 0.3), pw = cw * 0.76, ph = ch * (two ? 0.45 : 0.5);
      c.fillStyle = "#FFFDF4";
      c.fillRect(px - 3, py - 3, pw + 6, ph + 6);
      c.fillStyle = "#DDEFF8";
      c.fillRect(px, py, pw, ph);
      c.save();
      c.beginPath(); c.rect(px, py, pw, ph); c.clip();
      c.__bg = "#DDEFF8";
      shapes[k % shapes.length](px, py, pw, ph);
      c.restore();
      const light = parseInt(col.slice(1, 3), 16) * 0.299 + parseInt(col.slice(3, 5), 16) * 0.587 + parseInt(col.slice(5, 7), 16) * 0.114 > 160;
      const ink = light ? "#26262C" : "#FFFDF4";
      const words = t.split(" ");
      const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : words.length === 2 && t.length > 5 ? words : [t];
      const fs = Math.min(lines.length > 1 ? cw * 0.135 : cw * 0.17, (cw * 0.9) / Math.max(...lines.map((l) => l.length)) * 1.05);
      lines.forEach((l, i) => printText(c, l, x + cw / 2, y + ch * 0.05 + fs * (i + 1) * 1.12, fs, ink, "bold", "center"));
      printText(c, "케이슨 그림책", x + cw / 2, y + ch * 0.94, cw * 0.075, ink, "normal", "center");
    });
    inkCanvas(S, cv, "over");
    for (let i = 0; i < W * H; i++) S.rough[i] = 0.4;
  }
  window.drawCell = (name, W, H, seed) => {
    let S;
    const t0 = performance.now();
    if (DRAW[name]) {
      S = Sheet(W, H, seed, { colour: name === "night" ? "#FBF9F2" : PAPERS[seed % PAPERS.length], cockle: name === "flowers" || name === "lake" || name === "handprints" ? 0.12 : 0.035 });
      DRAW[name](S);
    } else if (name === "chalkboard") { S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.6 }); chalkboard(S); }
    else if (name === "hangul") { S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.4, rough: 0.35 }); hangulCards(S); }
    else if (name === "labels") { S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.3 }); labels(S); }
    else if (name === "clock") { S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.2 }); clockFace(S); }
    else if (name === "timetable") { S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.5, colour: "#FFFFFF" }); timetable(S); }
    else if (name === "cork") { S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 1.2 }); cork(S); }
    else if (name === "exercise") { S = Sheet(W, H, seed, { creases: 0, cockle: 0.02 }); exercise(S); }
    else if (name === "paperback") { S = Sheet(W, H, seed, { creases: 2, cockle: 0.04 }); paperBack(S); }
    else if (name === "tape") { S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.5 }); tape(S); }
    else if (name === "pages") { S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.3 }); pageEdges(S); }
    else if (name.startsWith("covers:")) { const [, cw, ch] = name.split(":").map(Number); S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.3 }); covers(S, cw, ch); }
    else if (name.startsWith("spines:")) { const [, sw, sh] = name.split(":").map(Number); S = Sheet(W, H, seed, { creases: 0, cockle: 0, grain: 0.3 }); spines(S, sw, sh); }
    else throw new Error("unknown cell " + name);
    // pack: colour RGBA (sRGB bytes), height (grey), roughness (grey)
    const N = W * H;
    const rgba = new Uint8ClampedArray(N * 4), hg = new Uint8ClampedArray(N * 4), ro = new Uint8ClampedArray(N * 4);
    for (let i = 0; i < N; i++) {
      rgba[i * 4] = S.col[i * 3]; rgba[i * 4 + 1] = S.col[i * 3 + 1]; rgba[i * 4 + 2] = S.col[i * 3 + 2]; rgba[i * 4 + 3] = 255;
      const h = clamp(S.hgt[i]) * 255;
      hg[i * 4] = hg[i * 4 + 1] = hg[i * 4 + 2] = h; hg[i * 4 + 3] = 255;
      const g = clamp(S.rough[i]) * 255;
      ro[i * 4] = ro[i * 4 + 1] = ro[i * 4 + 2] = g; ro[i * 4 + 3] = 255;
    }
    const toUrl = (arr) => {
      const cv = blank(W, H);
      cv.getContext("2d").putImageData(new ImageData(arr, W, H), 0, 0);
      return cv.toDataURL("image/png");
    };
    return { colour: toUrl(rgba), height: toUrl(hg), rough: toUrl(ro), ms: Math.round(performance.now() - t0) };
  };
})();
