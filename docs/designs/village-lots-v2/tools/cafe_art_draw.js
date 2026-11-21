/*
 * 케이슨 카페 — the café's own atlas, drawn in headless Chromium (cafe_art.mjs loads this file into a blank page). Each cell is painted
 * three times on its own canvases: colour (sRGB albedo), height (grey, 128 = flat: the normal map's source) and roughness (grey 0..255).
 * Everything procedural and seeded (the same every run): no photos, no fonts beyond the system's serif/sans and a hand-drawn chalk.
 *
 *   window.drawCell(name, w, h, seed) -> { colour, height, rough, ms }   (PNG data URLs)
 */
(function () {
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }
  function cv(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return [c, c.getContext("2d")];
  }
  // value noise (tileable not needed): a few octaves for marble veins, crumb and grain
  function noise2(seed) {
    const r = rng(seed);
    const P = new Float32Array(256 * 256);
    for (let i = 0; i < P.length; i++) P[i] = r();
    const at = (x, y) => P[((y & 255) << 8) | (x & 255)];
    const sm = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = sm(x - xi), fy = sm(y - yi);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
  }
  function fbm(n, x, y, oct) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
      v += a * n(x * f, y * f);
      a *= 0.5;
      f *= 2.03;
    }
    return v;
  }
  const grey = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------------------------------------------------------------------------------------- marble
  function marble(w, h, seed, tone) {
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const n = noise2(seed), n2 = noise2(seed + 7);
    const img = g.createImageData(w, h), him = hg.createImageData(w, h), rim = rg.createImageData(w, h);
    const sc = 1 / 90;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const u = x * sc, v = y * sc;
        const warp = fbm(n, u * 0.5, v * 0.5, 5) * 2.6;
        // the veins: thin where a sine of the warped coordinate crosses zero; a second, finer net
        const s1 = Math.abs(Math.sin((u * 0.55 + v * 0.22) * 2.2 + warp * 1.8));
        const s2 = Math.abs(Math.sin((u * 1.4 - v * 0.6) + fbm(n2, u * 0.9, v * 0.9, 4) * 3.2));
        const vein = Math.pow(1 - s1, 14) * 0.75 + Math.pow(1 - s2, 34) * 0.4 + Math.pow(1 - s1, 3) * 0.12;
        const cloud = fbm(n2, u * 0.25, v * 0.25, 4);
        const i = (y * w + x) * 4;
        const base = tone.base, vc = tone.vein;
        const k = clamp(vein, 0, 1);
        const cl = (cloud - 0.5) * tone.cloud;
        img.data[i] = clamp(base[0] + cl * 255 - (base[0] - vc[0]) * k, 0, 255);
        img.data[i + 1] = clamp(base[1] + cl * 255 - (base[1] - vc[1]) * k, 0, 255);
        img.data[i + 2] = clamp(base[2] + cl * 250 - (base[2] - vc[2]) * k, 0, 255);
        img.data[i + 3] = 255;
        const hv = 128 - k * 3; // honed: the veins barely sink
        him.data[i] = him.data[i + 1] = him.data[i + 2] = hv;
        him.data[i + 3] = 255;
        const rv = 40 + k * 30 + (cloud - 0.5) * 20; // polished (~0.18), the veins a little duller
        rim.data[i] = rim.data[i + 1] = rim.data[i + 2] = rv;
        rim.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    hg.putImageData(him, 0, 0);
    rg.putImageData(rim, 0, 0);
    return [c, hc, rc];
  }

  // ---------------------------------------------------------------------------------------------- chalkboard
  function chalkText(g, text, x, y, size, r, opts = {}) {
    g.save();
    g.font = `${opts.italic ? "italic " : ""}${opts.weight || 400} ${size}px ${opts.font || "'Segoe Script','Comic Sans MS','Malgun Gothic',cursive"}`;
    g.textAlign = opts.align || "left";
    g.textBaseline = "alphabetic";
    // chalk: the glyph drawn several times with a small jitter and a grainy alpha
    for (let k = 0; k < 4; k++) {
      g.globalAlpha = 0.28 + r() * 0.12;
      g.fillStyle = opts.color || "#F4F1E8";
      g.fillText(text, x + (r() - 0.5) * 1.6, y + (r() - 0.5) * 1.6);
    }
    g.restore();
  }
  function board(w, h, seed, kind) {
    const r = rng(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const n = noise2(seed);
    // slate-black board with old chalk haze, an oak frame drawn round it (the frame itself is geometry; 3 % margin)
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const hz = fbm(n, x / 70, y / 70, 4);
        const v = 34 + hz * 22 + r() * 6;
        img.data[i] = v * 0.92;
        img.data[i + 1] = v * 0.98;
        img.data[i + 2] = v * 0.98;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    rg.fillStyle = grey(225);
    rg.fillRect(0, 0, w, h);
    const S = h / 512;
    if (kind === "coffee") {
      chalkText(g, "Café", w / 2, 92 * S, 78 * S, r, { align: "center", weight: 700 });
      chalkText(g, "커피", w / 2, 132 * S, 30 * S, r, { align: "center", font: "'Malgun Gothic',sans-serif" });
      const items = [["Espresso  에스프레소", "3.5"], ["Americano  아메리카노", "4.0"], ["Café au lait  카페오레", "4.5"], ["Cappuccino  카푸치노", "4.8"], ["Chocolat chaud  핫초코", "5.0"], ["Thé  홍차", "4.0"]];
      items.forEach(([a, p], k) => {
        const y = (190 + k * 50) * S;
        chalkText(g, a, 70 * S, y, 30 * S, r, { font: "'Segoe Script','Malgun Gothic',cursive" });
        chalkText(g, p, w - 70 * S, y, 30 * S, r, { align: "right" });
        g.globalAlpha = 0.18;
        g.strokeStyle = "#EEE";
        g.setLineDash([3 * S, 7 * S]);
        g.beginPath();
        g.moveTo(w * 0.62, y - 8 * S);
        g.lineTo(w - 150 * S, y - 8 * S);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      });
      // a chalk cup with steam
      g.save();
      g.globalAlpha = 0.6;
      g.strokeStyle = "#F2EFE6";
      g.lineWidth = 4 * S;
      g.beginPath();
      g.arc(w - 120 * S, 95 * S, 30 * S, 0, Math.PI);
      g.stroke();
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(w - 140 * S + k * 20 * S, 55 * S);
        g.bezierCurveTo(w - 150 * S + k * 20 * S, 40 * S, w - 130 * S + k * 20 * S, 30 * S, w - 140 * S + k * 20 * S, 15 * S);
        g.stroke();
      }
      g.restore();
    } else {
      chalkText(g, "Pâtisserie", w / 2, 92 * S, 70 * S, r, { align: "center", weight: 700, color: "#F6E7C8" });
      chalkText(g, "오늘의 디저트", w / 2, 132 * S, 30 * S, r, { align: "center", font: "'Malgun Gothic',sans-serif" });
      const items = [["Croissant  크루아상", "3.2"], ["Pain au chocolat  뺑 오 쇼콜라", "3.6"], ["Tarte aux fraises  딸기 타르트", "6.5"], ["Tarte au citron  레몬 타르트", "6.0"], ["Opéra  오페라 케이크", "7.0"], ["Macarons  마카롱", "2.5"]];
      items.forEach(([a, p], k) => {
        const y = (190 + k * 50) * S;
        chalkText(g, a, 70 * S, y, 28 * S, r, { font: "'Segoe Script','Malgun Gothic',cursive" });
        chalkText(g, p, w - 70 * S, y, 30 * S, r, { align: "right" });
      });
      // pink and yellow chalk berries
      for (let k = 0; k < 5; k++) chalkText(g, "●", w - 210 * S + k * 26 * S, 470 * S, 20 * S, r, { color: k % 2 ? "#F4B9C8" : "#F6E08A" });
    }
    // the faint wipe arcs of yesterday's menu
    g.save();
    g.globalAlpha = 0.05;
    g.strokeStyle = "#fff";
    g.lineWidth = 60 * S;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.arc(r() * w, h + 100 * S, (200 + r() * 300) * S, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    g.restore();
    return [c, hc, rc];
  }

  // ---------------------------------------------------------------------------------------------- the enamel sign's ground
  function signBoard(w, h) {
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, "#1F5A45");
    gr.addColorStop(0.5, "#1A4F3D");
    gr.addColorStop(1, "#164534");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    // a gilt pinstripe inside the edge and small corner flourishes
    g.strokeStyle = "#D8B25E";
    g.lineWidth = Math.max(2, h * 0.03);
    const m = h * 0.12;
    g.strokeRect(m, m, w - 2 * m, h - 2 * m);
    g.lineWidth = Math.max(1, h * 0.012);
    g.strokeRect(m * 1.6, m * 1.6, w - 3.2 * m, h - 3.2 * m);
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    hg.strokeStyle = grey(150);
    hg.lineWidth = Math.max(2, h * 0.03);
    hg.strokeRect(m, m, w - 2 * m, h - 2 * m);
    rg.fillStyle = grey(55); // enamel: glossy
    rg.fillRect(0, 0, w, h);
    rg.strokeStyle = grey(90);
    rg.lineWidth = Math.max(2, h * 0.03);
    rg.strokeRect(m, m, w - 2 * m, h - 2 * m);
    return [c, hc, rc];
  }

  // ---------------------------------------------------------------------------------------------- food
  function bake(g, x, y, w, h, light, dark, r, n, scale) {
    // a baked surface: golden where it rose, deep brown in the folds, a few blisters
    const img = g.getImageData(x, y, w, h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 4;
        const t = clamp(fbm(n, (x + i) / scale, (y + j) / scale, 4) * 1.4 - 0.2, 0, 1);
        img.data[k] = light[0] + (dark[0] - light[0]) * t;
        img.data[k + 1] = light[1] + (dark[1] - light[1]) * t;
        img.data[k + 2] = light[2] + (dark[2] - light[2]) * t;
        img.data[k + 3] = 255;
      }
    g.putImageData(img, x, y);
  }
  function croissant(w, h, seed) {
    const r = rng(seed), n = noise2(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    // u runs round the roll, v along it: the laminated bands (the dough's turns) are bands across u, glossy egg wash on top
    bake(g, 0, 0, w, h, [226, 160, 70], [138, 72, 22], r, n, 14);
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    const bands = 7;
    for (let b = 0; b < bands; b++) {
      const x0 = (b / bands) * w;
      const bw = w / bands;
      // each band: lighter crest, dark groove between (where the layers part)
      const gr = g.createLinearGradient(x0, 0, x0 + bw, 0);
      gr.addColorStop(0, "rgba(90,40,8,0.85)");
      gr.addColorStop(0.15, "rgba(160,85,25,0.25)");
      gr.addColorStop(0.55, "rgba(250,200,120,0.28)");
      gr.addColorStop(0.92, "rgba(150,80,22,0.2)");
      gr.addColorStop(1, "rgba(90,40,8,0.85)");
      g.fillStyle = gr;
      g.fillRect(x0, 0, bw, h);
      const hgr = hg.createLinearGradient(x0, 0, x0 + bw, 0);
      hgr.addColorStop(0, grey(70));
      hgr.addColorStop(0.5, grey(190));
      hgr.addColorStop(1, grey(70));
      hg.fillStyle = hgr;
      hg.fillRect(x0, 0, bw, h);
      // flaky layer lines inside each band
      g.strokeStyle = "rgba(120,58,14,0.35)";
      g.lineWidth = 1;
      for (let k = 0; k < 5; k++) {
        const xx = x0 + bw * (0.2 + 0.15 * k) + (r() - 0.5) * 2;
        g.beginPath();
        g.moveTo(xx, 0);
        for (let y = 0; y <= h; y += 6) g.lineTo(xx + Math.sin(y * 0.15 + k) * 1.2, y);
        g.stroke();
      }
    }
    rg.fillStyle = grey(110); // egg wash sheen
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function tartFruit(w, h, seed) {
    const r = rng(seed), n = noise2(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    // crème pâtissière under the fruit
    g.fillStyle = "#F2D79A";
    g.fillRect(0, 0, w, h);
    hg.fillStyle = grey(110);
    hg.fillRect(0, 0, w, h);
    rg.fillStyle = grey(90);
    rg.fillRect(0, 0, w, h);
    // halved strawberries in rings from the rim inward, tips out, glazed
    const cx = w / 2, cy = h / 2, R = w / 2;
    for (let ring = 0; ring < 4; ring++) {
      const rr = R * (0.86 - ring * 0.25);
      const cnt = Math.max(1, Math.round((2 * Math.PI * rr) / (w * 0.13)));
      for (let k = 0; k < cnt; k++) {
        const a = (k / cnt) * Math.PI * 2 + ring * 0.3;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const s = w * (ring === 3 ? 0.09 : 0.075);
        g.save();
        g.translate(x, y);
        g.rotate(a + Math.PI / 2);
        // the cut face: red rim, pale core, seeds
        const gr = g.createRadialGradient(0, 0, s * 0.1, 0, 0, s);
        gr.addColorStop(0, "#F7C2B8");
        gr.addColorStop(0.45, "#E8584F");
        gr.addColorStop(1, "#B01A26");
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(0, -s * 1.15);
        g.bezierCurveTo(s * 1.0, -s * 0.6, s * 0.9, s * 0.8, 0, s);
        g.bezierCurveTo(-s * 0.9, s * 0.8, -s * 1.0, -s * 0.6, 0, -s * 1.15);
        g.fill();
        g.fillStyle = "rgba(255,240,180,0.85)";
        for (let q = 0; q < 6; q++) g.fillRect((r() - 0.5) * s * 1.2, (r() - 0.5) * s * 1.4, 1.5, 2);
        // the glaze's highlight
        g.fillStyle = "rgba(255,255,255,0.45)";
        g.beginPath();
        g.ellipse(-s * 0.3, -s * 0.35, s * 0.18, s * 0.32, -0.5, 0, Math.PI * 2);
        g.fill();
        g.restore();
        hg.save();
        hg.translate(x, y);
        const hgr = hg.createRadialGradient(0, 0, 0, 0, 0, s);
        hgr.addColorStop(0, grey(235));
        hgr.addColorStop(1, grey(130));
        hg.fillStyle = hgr;
        hg.beginPath();
        hg.arc(0, 0, s, 0, Math.PI * 2);
        hg.fill();
        hg.restore();
        rg.fillStyle = grey(30); // the apricot glaze
        rg.beginPath();
        rg.arc(x, y, s, 0, Math.PI * 2);
        rg.fill();
      }
    }
    // a few blueberries and a mint leaf
    for (let k = 0; k < 7; k++) {
      const a = r() * Math.PI * 2, rr = R * (0.2 + r() * 0.6);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      const gr = g.createRadialGradient(x - 2, y - 2, 1, x, y, w * 0.03);
      gr.addColorStop(0, "#7E86B8");
      gr.addColorStop(1, "#262A55");
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, w * 0.03, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = "#3E8B3A";
    g.beginPath();
    g.ellipse(cx, cy, w * 0.05, w * 0.02, 0.6, 0, Math.PI * 2);
    g.fill();
    return [c, hc, rc];
  }
  function tartCrust(w, h, seed) {
    const r = rng(seed), n = noise2(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    bake(g, 0, 0, w, h, [236, 190, 110], [178, 112, 46], r, n, 10);
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    // the fluted edge: vertical flutes (u round the tart)
    const fl = 24;
    for (let k = 0; k < fl; k++) {
      const x0 = (k / fl) * w, bw = w / fl;
      const gr = g.createLinearGradient(x0, 0, x0 + bw, 0);
      gr.addColorStop(0, "rgba(120,60,15,0.35)");
      gr.addColorStop(0.5, "rgba(255,220,150,0.25)");
      gr.addColorStop(1, "rgba(120,60,15,0.35)");
      g.fillStyle = gr;
      g.fillRect(x0, 0, bw, h);
      const hgr = hg.createLinearGradient(x0, 0, x0 + bw, 0);
      hgr.addColorStop(0, grey(80));
      hgr.addColorStop(0.5, grey(180));
      hgr.addColorStop(1, grey(80));
      hg.fillStyle = hgr;
      hg.fillRect(x0, 0, bw, h);
    }
    rg.fillStyle = grey(200);
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function cakeSide(w, h, seed) {
    const r = rng(seed), n = noise2(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    // an opéra / layer cake cut face: joconde sponge, coffee buttercream, ganache, glossy top (v up)
    const layers = [["#3A2216", 0.1, 60], ["#C89A5E", 0.16, 200], ["#6B4128", 0.08, 140], ["#C89A5E", 0.16, 200], ["#E9D2A8", 0.1, 150], ["#C89A5E", 0.16, 200], ["#4A2A18", 0.08, 120], ["#2A160D", 0.16, 30]];
    let y = h;
    for (const [col, fr, ro] of layers) {
      const lh = fr * h;
      y -= lh;
      g.fillStyle = col;
      g.fillRect(0, y, w, lh + 1);
      rg.fillStyle = grey(ro);
      rg.fillRect(0, y, w, lh + 1);
    }
    // the sponge's crumb: tiny pores
    const img = g.getImageData(0, 0, w, h), him = hg.createImageData(w, h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 4;
        const pore = fbm(n, i / 3, j / 3, 3);
        const d = pore < 0.36 ? -26 : 0;
        img.data[k] = clamp(img.data[k] + d, 0, 255);
        img.data[k + 1] = clamp(img.data[k + 1] + d, 0, 255);
        img.data[k + 2] = clamp(img.data[k + 2] + d * 0.8, 0, 255);
        him.data[k] = him.data[k + 1] = him.data[k + 2] = 128 + (pore - 0.5) * 60;
        him.data[k + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    hg.putImageData(him, 0, 0);
    return [c, hc, rc];
  }
  function cakeTop(w, h, seed, kind) {
    const r = rng(seed), n = noise2(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const cx = w / 2, cy = h / 2;
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    if (kind === "choc") {
      // mirror ganache with a gold leaf and chocolate curls
      const gr = g.createRadialGradient(cx * 0.8, cy * 0.7, 5, cx, cy, w * 0.7);
      gr.addColorStop(0, "#5A3320");
      gr.addColorStop(1, "#24130B");
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      rg.fillStyle = grey(18);
      rg.fillRect(0, 0, w, h);
      g.fillStyle = "#D8B25E";
      g.save();
      g.translate(cx + w * 0.12, cy - h * 0.1);
      g.rotate(0.4);
      g.fillRect(-w * 0.05, -h * 0.03, w * 0.1, h * 0.06);
      g.restore();
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = cx + Math.cos(a) * w * 0.38, y = cy + Math.sin(a) * h * 0.38;
        g.fillStyle = "#3B2013";
        g.beginPath();
        g.ellipse(x, y, w * 0.05, w * 0.018, a, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "rgba(255,230,200,0.25)";
        g.fillRect(x - 2, y - 2, 4, 2);
        hg.fillStyle = grey(200);
        hg.beginPath();
        hg.ellipse(x, y, w * 0.05, w * 0.018, a, 0, Math.PI * 2);
        hg.fill();
      }
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.beginPath();
      g.ellipse(cx - w * 0.18, cy - h * 0.18, w * 0.16, h * 0.05, -0.6, 0, Math.PI * 2);
      g.fill();
    } else if (kind === "berry") {
      // chantilly piped rosettes with raspberries
      g.fillStyle = "#FBF6EC";
      g.fillRect(0, 0, w, h);
      rg.fillStyle = grey(150);
      rg.fillRect(0, 0, w, h);
      const ros = 10;
      for (let k = 0; k < ros; k++) {
        const a = (k / ros) * Math.PI * 2;
        const x = cx + Math.cos(a) * w * 0.38, y = cy + Math.sin(a) * h * 0.38;
        for (let q = 0; q < 6; q++) {
          const b = (q / 6) * Math.PI * 2;
          hg.fillStyle = grey(150 + q * 10);
          hg.beginPath();
          hg.arc(x + Math.cos(b) * w * 0.02, y + Math.sin(b) * w * 0.02, w * 0.022, 0, Math.PI * 2);
          hg.fill();
          g.fillStyle = "rgba(230,220,205,0.5)";
          g.beginPath();
          g.arc(x + Math.cos(b) * w * 0.02 + 2, y + Math.sin(b) * w * 0.02 + 2, w * 0.012, 0, Math.PI * 2);
          g.fill();
        }
        // the raspberry: drupelets
        const rx = cx + Math.cos(a) * w * 0.25, ry = cy + Math.sin(a) * h * 0.25;
        for (let q = 0; q < 26; q++) {
          const dx = (r() - 0.5) * w * 0.09, dy = (r() - 0.5) * w * 0.09;
          const gr = g.createRadialGradient(rx + dx - 1, ry + dy - 1, 0.5, rx + dx, ry + dy, w * 0.014);
          gr.addColorStop(0, "#F26C7E"); /* drupelet */
          gr.addColorStop(1, "#A3132D");
          g.fillStyle = gr;
          g.beginPath();
          g.arc(rx + dx, ry + dy, w * 0.02, 0, Math.PI * 2);
          g.fill();
          hg.fillStyle = grey(200);
          hg.beginPath();
          hg.arc(rx + dx, ry + dy, w * 0.02, 0, Math.PI * 2);
          hg.fill();
        }
      }
      // icing sugar
      for (let k = 0; k < 400; k++) {
        g.fillStyle = "rgba(255,255,255,0.6)";
        g.fillRect(r() * w, r() * h, 1, 1);
      }
    } else {
      // lemon tart: torched Italian meringue peaks
      g.fillStyle = "#F7E7B0";
      g.fillRect(0, 0, w, h);
      rg.fillStyle = grey(120);
      rg.fillRect(0, 0, w, h);
      for (let k = 0; k < 60; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * w * 0.4;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const s = w * (0.03 + r() * 0.03);
        const gr = g.createRadialGradient(x - s * 0.3, y - s * 0.3, 1, x, y, s);
        gr.addColorStop(0, "#FFF9EA");
        gr.addColorStop(0.6, "#E8B46A");
        gr.addColorStop(1, "#9A5A22");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, s, 0, Math.PI * 2);
        g.fill();
        const hgr = hg.createRadialGradient(x, y, 0, x, y, s);
        hgr.addColorStop(0, grey(250));
        hgr.addColorStop(1, grey(128));
        hg.fillStyle = hgr;
        hg.beginPath();
        hg.arc(x, y, s, 0, Math.PI * 2);
        hg.fill();
      }
    }
    return [c, hc, rc];
  }
  function beans(w, h, seed) {
    const r = rng(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    g.fillStyle = "#2B170C";
    g.fillRect(0, 0, w, h);
    hg.fillStyle = grey(60);
    hg.fillRect(0, 0, w, h);
    rg.fillStyle = grey(110);
    rg.fillRect(0, 0, w, h);
    for (let k = 0; k < 520; k++) {
      const x = r() * w, y = r() * h, a = r() * Math.PI, s = w * 0.028;
      g.save();
      g.translate(x, y);
      g.rotate(a);
      const gr = g.createRadialGradient(-s * 0.3, -s * 0.3, 1, 0, 0, s * 1.2);
      gr.addColorStop(0, "#8A5530");
      gr.addColorStop(1, "#3A1F0F");
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(0, 0, s, s * 0.7, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#1E0F07";
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(-s * 0.8, 0);
      g.bezierCurveTo(-s * 0.3, s * 0.15, s * 0.3, -s * 0.15, s * 0.8, 0);
      g.stroke();
      g.restore();
      hg.fillStyle = grey(200);
      hg.beginPath();
      hg.ellipse(x, y, s, s * 0.7, a, 0, Math.PI * 2);
      hg.fill();
    }
    return [c, hc, rc];
  }
  function breadCrust(w, h, seed) {
    const r = rng(seed), n = noise2(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    bake(g, 0, 0, w, h, [222, 168, 92], [140, 78, 30], r, n, 18);
    hg.fillStyle = grey(140);
    hg.fillRect(0, 0, w, h);
    // the baker's scores, opened into ears (pale inside), and flour dust
    for (let k = 0; k < 4; k++) {
      const x = w * (0.15 + k * 0.22);
      g.fillStyle = "#EBCB8E";
      g.beginPath();
      g.ellipse(x, h / 2, w * 0.035, h * 0.38, 0.35, 0, Math.PI * 2);
      g.fill();
      hg.fillStyle = grey(70);
      hg.beginPath();
      hg.ellipse(x, h / 2, w * 0.035, h * 0.38, 0.35, 0, Math.PI * 2);
      hg.fill();
    }
    for (let k = 0; k < 900; k++) {
      g.fillStyle = "rgba(250,244,230,0.35)";
      g.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
    rg.fillStyle = grey(215);
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function latte(w, h, seed) {
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const cx = w / 2, cy = h / 2;
    g.fillStyle = "#7A4A26";
    g.fillRect(0, 0, w, h);
    const gr = g.createRadialGradient(cx, cy, 2, cx, cy, w / 2);
    gr.addColorStop(0, "#C88E58");
    gr.addColorStop(0.8, "#8B5528");
    gr.addColorStop(1, "#5A3216");
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    // a rosetta: stacked white hearts
    g.fillStyle = "#F7EFE2";
    for (let k = 0; k < 6; k++) {
      const y = cy + h * 0.25 - k * h * 0.08, s = w * (0.2 - k * 0.02);
      g.beginPath();
      g.ellipse(cx, y, s, s * 0.45, 0, Math.PI, 0);
      g.fill();
      g.fillStyle = k % 2 ? "#F7EFE2" : "#EADCC6";
    }
    g.fillRect(cx - 1.5, cy - h * 0.25, 3, h * 0.5);
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    rg.fillStyle = grey(60);
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function gauge(w, h) {
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const cx = w / 2, cy = h / 2, R = w * 0.46;
    g.fillStyle = "#C9CDD0";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#FBFAF6";
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#222";
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI * 0.75 + (k / 16) * Math.PI * 1.5;
      g.lineWidth = k % 4 ? 1 : 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
      g.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
      g.stroke();
    }
    // the green band (1.0–1.5 bar) and the red needle at 1.2
    g.strokeStyle = "#3A9A4A";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, R * 0.72, Math.PI * 1.25, Math.PI * 1.55);
    g.stroke();
    g.strokeStyle = "#C0262D";
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx, cy);
    const a = Math.PI * 1.38;
    g.lineTo(cx + Math.cos(a) * R * 0.85, cy + Math.sin(a) * R * 0.85);
    g.stroke();
    g.fillStyle = "#222";
    g.font = `${w * 0.09}px sans-serif`;
    g.textAlign = "center";
    g.fillText("BAR", cx, cy + R * 0.45);
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    rg.fillStyle = grey(20);
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function labels(w, h, seed) {
    const r = rng(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const names = [["Café", "#E9DCC0", "#5A3A22"], ["Thé vert", "#DDE7CF", "#2F5B3A"], ["Earl Grey", "#1F2E4A", "#E8D8A8"], ["Cacao", "#5A3322", "#F1E2C6"], ["Sucre", "#F6F2EA", "#7A5A3A"], ["Confiture", "#B83A3A", "#FFF2E0"]];
    const cw = w / names.length;
    names.forEach(([t, bg, fg], k) => {
      g.fillStyle = bg;
      g.fillRect(k * cw, 0, cw, h);
      g.strokeStyle = fg;
      g.lineWidth = 2;
      g.strokeRect(k * cw + 6, 6, cw - 12, h - 12);
      g.fillStyle = fg;
      g.font = `italic 600 ${h * 0.17}px Georgia, 'Times New Roman', serif`;
      g.textAlign = "center";
      g.fillText(t, k * cw + cw / 2, h * 0.58);
      g.font = `${h * 0.1}px Georgia, serif`;
      g.fillText("— maison —", k * cw + cw / 2, h * 0.8);
    });
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    rg.fillStyle = grey(170);
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function spines(w, h, seed) {
    const r = rng(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const cols = ["#7A2E2E", "#2E4A6B", "#3D5A3A", "#C9B48A", "#5A3A5E", "#1F1F24", "#A85A2E", "#E7DCC4", "#2F6B66", "#8A6A3A", "#6B2E45", "#3A3A5A", "#B89A5A", "#4A2A1E", "#D8CDB0", "#5E6B3A"];
    const n = cols.length, sw = w / n;
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    cols.forEach((col, k) => {
      const x = k * sw;
      const gr = g.createLinearGradient(x, 0, x + sw, 0);
      gr.addColorStop(0, "rgba(0,0,0,0.35)");
      gr.addColorStop(0.3, col);
      gr.addColorStop(0.75, col);
      gr.addColorStop(1, "rgba(0,0,0,0.4)");
      g.fillStyle = col;
      g.fillRect(x, 0, sw, h);
      g.fillStyle = gr;
      g.fillRect(x, 0, sw, h);
      g.fillStyle = "#D8B25E";
      for (const y of [0.08, 0.12, 0.86, 0.9]) g.fillRect(x + 2, y * h, sw - 4, 2);
      g.fillStyle = "rgba(216,178,94,0.9)";
      g.fillRect(x + sw * 0.3, h * 0.3, sw * 0.4, h * 0.3);
      hg.fillStyle = grey(150);
      for (const y of [0.08, 0.12, 0.86, 0.9]) hg.fillRect(x + 2, y * h, sw - 4, 2);
    });
    rg.fillStyle = grey(150);
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function clock(w, h) {
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    const cx = w / 2, cy = h / 2, R = w * 0.47;
    g.fillStyle = "#F8F3E6";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#1E1E1E";
    g.font = `500 ${w * 0.1}px Georgia, 'Times New Roman', serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const rn = ["XII", "I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
    rn.forEach((t, k) => {
      const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
      g.fillText(t, cx + Math.cos(a) * R * 0.78, cy + Math.sin(a) * R * 0.78);
    });
    for (let k = 0; k < 60; k++) {
      const a = (k / 60) * Math.PI * 2;
      g.fillRect(cx + Math.cos(a) * R * 0.92 - 1, cy + Math.sin(a) * R * 0.92 - 1, k % 5 ? 2 : 4, k % 5 ? 2 : 4);
    }
    g.font = `italic ${w * 0.06}px Georgia, serif`;
    g.fillText("Caysonne · Paris", cx, cy + R * 0.35);
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    rg.fillStyle = grey(70);
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function print(w, h, seed, kind) {
    const r = rng(seed), n = noise2(seed);
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    // cotton paper with a mat
    g.fillStyle = "#F7F1E3";
    g.fillRect(0, 0, w, h);
    const m = w * 0.08;
    const iw = w - 2 * m, ih = h - 2 * m;
    g.save();
    g.beginPath();
    g.rect(m, m, iw, ih);
    g.clip();
    if (kind === "street") {
      // watercolour: a Paris street with a café awning, soft washes
      const sky = g.createLinearGradient(0, m, 0, m + ih * 0.5);
      sky.addColorStop(0, "#9CC3DE");
      sky.addColorStop(1, "#EAF0EE");
      g.fillStyle = sky;
      g.fillRect(m, m, iw, ih);
      const wash = (x, y, ww, hh, col, a) => {
        g.globalAlpha = a;
        g.fillStyle = col;
        for (let k = 0; k < 3; k++) g.fillRect(x + (r() - 0.5) * 6, y + (r() - 0.5) * 6, ww, hh);
        g.globalAlpha = 1;
      };
      wash(m, m + ih * 0.2, iw * 0.45, ih * 0.6, "#E8D6B4", 0.6);
      wash(m + iw * 0.55, m + ih * 0.12, iw * 0.45, ih * 0.7, "#D8C2A0", 0.6);
      for (let k = 0; k < 6; k++) wash(m + iw * (0.06 + (k % 3) * 0.12), m + ih * (0.28 + Math.floor(k / 3) * 0.16), iw * 0.07, ih * 0.1, "#5A6E80", 0.55);
      for (let k = 0; k < 6; k++) wash(m + iw * (0.6 + (k % 3) * 0.12), m + ih * (0.2 + Math.floor(k / 3) * 0.16), iw * 0.07, ih * 0.1, "#5A6E80", 0.55);
      // the red awning, little tables, the cobbles
      wash(m + iw * 0.05, m + ih * 0.62, iw * 0.38, ih * 0.06, "#B8392E", 0.8);
      wash(m, m + ih * 0.8, iw, ih * 0.2, "#B9AA90", 0.6);
      for (let k = 0; k < 4; k++) wash(m + iw * (0.08 + k * 0.09), m + ih * 0.78, iw * 0.04, ih * 0.06, "#3A3A3A", 0.7);
      g.strokeStyle = "rgba(60,50,40,0.6)";
      g.lineWidth = 1.2;
      g.strokeRect(m + iw * 0.05, m + ih * 0.2, iw * 0.38, ih * 0.6);
      g.strokeRect(m + iw * 0.57, m + ih * 0.12, iw * 0.4, ih * 0.68);
    } else if (kind === "lemons") {
      // a botanical plate: a lemon branch with leaves and two fruit
      g.fillStyle = "#F3EBD8";
      g.fillRect(m, m, iw, ih);
      g.strokeStyle = "#6B4A2A";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(m + iw * 0.2, m + ih * 0.9);
      g.bezierCurveTo(m + iw * 0.4, m + ih * 0.6, m + iw * 0.5, m + ih * 0.4, m + iw * 0.75, m + ih * 0.15);
      g.stroke();
      for (let k = 0; k < 9; k++) {
        const t = k / 9;
        const x = m + iw * (0.22 + t * 0.52), y = m + ih * (0.88 - t * 0.72);
        g.save();
        g.translate(x, y);
        g.rotate((k % 2 ? 1 : -1) * 0.9 + t);
        const lg = g.createLinearGradient(0, -iw * 0.04, 0, iw * 0.04);
        lg.addColorStop(0, "#5E8A3A");
        lg.addColorStop(1, "#2F5A26");
        g.fillStyle = lg;
        g.beginPath();
        g.ellipse(iw * 0.09, 0, iw * 0.1, iw * 0.035, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      for (const [fx, fy] of [[0.42, 0.55], [0.62, 0.42]]) {
        const lg = g.createRadialGradient(m + iw * fx - 8, m + ih * fy - 8, 4, m + iw * fx, m + ih * fy, iw * 0.11);
        lg.addColorStop(0, "#FFF29A");
        lg.addColorStop(0.7, "#F2C928");
        lg.addColorStop(1, "#C8981A");
        g.fillStyle = lg;
        g.beginPath();
        g.ellipse(m + iw * fx, m + ih * fy, iw * 0.11, iw * 0.08, 0.3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = "#4A3A2A";
      g.font = `italic ${w * 0.04}px Georgia, serif`;
      g.textAlign = "center";
      g.fillText("Citrus limon", m + iw / 2, m + ih * 0.97);
    } else if (kind === "poster") {
      // a vintage café poster: a steaming cup on deep red, cream letters
      g.fillStyle = "#9E2B25";
      g.fillRect(m, m, iw, ih);
      g.fillStyle = "#F3E3C3";
      g.font = `700 ${iw * 0.16}px Georgia, 'Times New Roman', serif`;
      g.textAlign = "center";
      g.fillText("CAFÉ", m + iw / 2, m + ih * 0.2);
      g.font = `italic ${iw * 0.07}px Georgia, serif`;
      g.fillText("Caysonne", m + iw / 2, m + ih * 0.29);
      g.fillStyle = "#F3E3C3";
      g.beginPath();
      g.ellipse(m + iw / 2, m + ih * 0.66, iw * 0.25, ih * 0.05, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#1E1E22";
      g.beginPath();
      g.moveTo(m + iw * 0.32, m + ih * 0.45);
      g.lineTo(m + iw * 0.68, m + ih * 0.45);
      g.quadraticCurveTo(m + iw * 0.66, m + ih * 0.63, m + iw * 0.5, m + ih * 0.64);
      g.quadraticCurveTo(m + iw * 0.34, m + ih * 0.63, m + iw * 0.32, m + ih * 0.45);
      g.fill();
      g.strokeStyle = "#F3E3C3";
      g.lineWidth = iw * 0.015;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.moveTo(m + iw * (0.42 + k * 0.08), m + ih * 0.42);
        g.bezierCurveTo(m + iw * (0.38 + k * 0.08), m + ih * 0.36, m + iw * (0.46 + k * 0.08), m + ih * 0.33, m + iw * (0.42 + k * 0.08), m + ih * 0.27);
        g.stroke();
      }
      g.fillStyle = "#F3E3C3";
      g.font = `${iw * 0.05}px Georgia, serif`;
      g.fillText("Torréfié au village · depuis 1925", m + iw / 2, m + ih * 0.86);
    } else {
      // a pastel still life (upstairs): macarons on a plate
      g.fillStyle = "#EEE3D2";
      g.fillRect(m, m, iw, ih);
      g.fillStyle = "#FFFFFF";
      g.beginPath();
      g.ellipse(m + iw / 2, m + ih * 0.62, iw * 0.38, ih * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      const mc = ["#F4B9C8", "#C9E3B0", "#F6E08A", "#C8B8E8", "#F2C39A"];
      mc.forEach((col, k) => {
        const x = m + iw * (0.25 + k * 0.125), y = m + ih * (0.58 - (k % 2) * 0.05);
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(x, y - ih * 0.03, iw * 0.06, ih * 0.025, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#FFF6E8";
        g.fillRect(x - iw * 0.055, y - ih * 0.012, iw * 0.11, ih * 0.012);
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(x, y + ih * 0.01, iw * 0.06, ih * 0.025, 0, 0, Math.PI * 2);
        g.fill();
      });
    }
    g.restore();
    // paper tooth
    const img = g.getImageData(0, 0, w, h), him = hg.createImageData(w, h);
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = (j * w + i) * 4;
        const t = fbm(n, i / 2.5, j / 2.5, 2);
        const d = (t - 0.5) * 10;
        img.data[k] = clamp(img.data[k] + d, 0, 255);
        img.data[k + 1] = clamp(img.data[k + 1] + d, 0, 255);
        img.data[k + 2] = clamp(img.data[k + 2] + d, 0, 255);
        him.data[k] = him.data[k + 1] = him.data[k + 2] = 128 + (t - 0.5) * 40;
        him.data[k + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    hg.putImageData(him, 0, 0);
    rg.fillStyle = grey(220);
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function blank(w, h) {
    const [c, g] = cv(w, h), [hc, hg] = cv(w, h), [rc, rg] = cv(w, h);
    g.fillStyle = "#FFFFFF";
    g.fillRect(0, 0, w, h);
    hg.fillStyle = grey(128);
    hg.fillRect(0, 0, w, h);
    rg.fillStyle = grey(60); // a glaze: the cups, saucers, macarons (COLOR_0 tints it)
    rg.fillRect(0, 0, w, h);
    return [c, hc, rc];
  }
  function blankMatte(w, h) {
    const [c, hc, rc] = blank(w, h);
    rc.getContext("2d").fillStyle = grey(210);
    rc.getContext("2d").fillRect(0, 0, w, h);
    return [c, hc, rc];
  }

  const CELLS = {
    marble_long: (w, h, s) => marble(w, h, s, { base: [238, 235, 229], vein: [128, 128, 132], cloud: 0.08 }),
    marble_round: (w, h, s) => marble(w, h, s, { base: [242, 239, 233], vein: [120, 118, 122], cloud: 0.1 }),
    marble_green: (w, h, s) => marble(w, h, s, { base: [52, 82, 68], vein: [210, 220, 205], cloud: 0.12 }),
    chalk_coffee: (w, h, s) => board(w, h, s, "coffee"),
    chalk_pastry: (w, h, s) => board(w, h, s, "pastry"),
    sign: (w, h) => signBoard(w, h),
    gauge: (w, h) => gauge(w, h),
    croissant: (w, h, s) => croissant(w, h, s),
    latte: (w, h, s) => latte(w, h, s),
    tart_fruit: (w, h, s) => tartFruit(w, h, s),
    tart_crust: (w, h, s) => tartCrust(w, h, s),
    cake_side: (w, h, s) => cakeSide(w, h, s),
    cake_choc: (w, h, s) => cakeTop(w, h, s, "choc"),
    cake_berry: (w, h, s) => cakeTop(w, h, s, "berry"),
    cake_lemon: (w, h, s) => cakeTop(w, h, s, "lemon"),
    beans: (w, h, s) => beans(w, h, s),
    bread: (w, h, s) => breadCrust(w, h, s),
    labels: (w, h, s) => labels(w, h, s),
    spines: (w, h, s) => spines(w, h, s),
    clock: (w, h) => clock(w, h),
    print_street: (w, h, s) => print(w, h, s, "street"),
    print_lemons: (w, h, s) => print(w, h, s, "lemons"),
    print_poster: (w, h, s) => print(w, h, s, "poster"),
    print_macarons: (w, h, s) => print(w, h, s, "macarons"),
    glaze: (w, h) => blank(w, h),
    matte: (w, h) => blankMatte(w, h),
  };

  window.drawCell = (name, w, h, seed) => {
    const t0 = performance.now();
    const [c, hc, rc] = CELLS[name](w, h, seed);
    return { colour: c.toDataURL("image/png"), height: hc.toDataURL("image/png"), rough: rc.toDataURL("image/png"), ms: Math.round(performance.now() - t0) };
  };
})();
