/**
 * e2e/village-daynight.mjs — 케이슨 마을의 낮·밤 밝기 사진 (케이슨 마을 1단계 Task 7A).
 *
 *   npm run dev   (다른 창에서)
 *   node e2e/village-daynight.mjs [high|low ...] [--date=2026-11-03] [--phases=noon,night] [--out=<폴더>]
 *
 * 시각은 DEV 주소 `?time=<한국 시각>`(client/src/village/villageClock.ts)으로 고정한다. 단계(phase)마다 한 번 입장해서
 * 세 곳을 찍는다: 광장(plaza, 시작 위치), 추모관 가는 길(lane), 추모관 앞(memorial). 파일 이름은 `<tier>-<phase>-<view>`:
 *   *-frame.png   HUD를 숨긴 3D 화면 (밝기를 재는 사진)
 *   *.png         같은 순간의 HUD 포함 화면
 *   *-walk.png    걸을 수 있는 바닥 마스크 (흰색 = 화면에 보이는 걷는 바닥)
 * 판정은 e2e/luma-check.mjs의 함수 그대로다: 낮(noon, golden)은 낮 기준(평균 ≥ 0.45, p5 ≥ 0.10), 밤(night)은 밤 기준(평균
 * ≥ 0.18, 걷는 바닥 p50 ≥ 0.15), 해 질 녘·새벽(dusk, dawn)은 밤 기준의 평균만. 찍은 뒤에 다시 재려면
 *   node e2e/luma-check.mjs --night "<폴더>/*-night-*-frame.png"
 *
 * 마스크 만드는 법: 사진을 찍은 직후 같은 카메라로 장면을 한 번 더 그린다. 바닥 재질(LM_grass, LM_lawn, LM_plaza,
 * LM_concrete, LM_stone)은 흰색, 나머지는 모두 검은색(하늘, 물, 건물, 나무, 아바타가 바닥을 가린다; 바닥 위 그림자·발판
 * 같은 데칼과 별은 숨긴다; 바닥 층의 polygon offset은 그대로 둔다). 흰 픽셀 가운데 시선이 y = 0 바닥과 120 m 안, 걷기
 * 범위(±95 m) 안에서 만나는 것만 남긴다.
 */

import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import zlib from "node:zlib";
import {
  CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, turnCameraTo, walkAndWait,
} from "./lib/escape.mjs";
import { MEAN_MIN, NIGHT_MEAN_MIN, NIGHT_WALK_P50_MIN, P5_MIN, decodePng, nightStats, passes, passesNight } from "./luma-check.mjs";

const run = createRun("village-daynight");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const tierArgs = args.filter((a) => a === "high" || a === "low");
const TIERS = tierArgs.length ? tierArgs : ["high", "low"];
const DATE = opt("date", "2026-11-03");

/** Phases of the day, KST on DATE (2026-11-03: sunrise about 07:03, sunset about 17:23). */
const PHASES = { noon: "12:30", golden: "17:06", dusk: "17:37", night: "21:00", dawn: "06:49" };
const WANT = opt("phases", "noon,night").split(",").filter((p) => p in PHASES);

let nickSeq = 0;
/** Entry (the bare address + the pinned time) -> nickname -> 입장하기 -> the village scene and its model are up. */
async function joinVillage(p, time) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`${DATE}T${time}`)}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`마을${++nickSeq}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 20000 });
  await p.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 90000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(3000);
}

/** Zoom the follow camera (wheel) and raise its pitch (vertical drag) until the orbit is about there. */
async function setOrbit(p, distance, pitch) {
  const vp = p.page.viewportSize();
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  await p.page.mouse.move(cx, cy);
  for (let k = 0; k < 12; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    if (Math.abs(o.distance - distance) < 0.6) break;
    await p.page.mouse.wheel(0, (distance - o.distance) * 100);
    await sleep(250);
  }
  for (let k = 0; k < 10; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    const diff = pitch - o.pitch;
    if (Math.abs(diff) < 0.05) break;
    const dy = Math.max(-260, Math.min(260, diff * 220));
    await p.page.mouse.move(cx, cy);
    await p.page.mouse.down();
    for (let s = 1; s <= 8; s++) await p.page.mouse.move(cx, cy + (dy * s) / 8);
    await p.page.mouse.up();
    await sleep(300);
    const after = await p.page.evaluate(() => window.__cv.getOrbit());
    if (Math.sign(after.pitch - o.pitch) !== Math.sign(diff) && Math.abs(after.pitch - o.pitch) > 0.01) {
      await p.page.mouse.move(cx, cy);
      await p.page.mouse.down();
      for (let s = 1; s <= 8; s++) await p.page.mouse.move(cx, cy - (2 * dy * s) / 8);
      await p.page.mouse.up();
      await sleep(300);
    }
  }
  await sleep(1200);
}

const hideHud = (p) =>
  p.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    window.__hidden = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (keep.has(el) || canvas.contains(el)) continue;
      if (el.style.visibility !== "hidden") {
        window.__hidden.push(el);
        el.style.visibility = "hidden";
      }
    }
  });
const showHud = (p) =>
  p.page.evaluate(() => {
    for (const el of window.__hidden ?? []) el.style.visibility = "";
  });

/** The walkable-area mask of the view the camera has right now (see the file header): bytes 0/1 (base64), width, height. */
async function maskOf(p) {
  return p.page.evaluate(() => {
    const { gl, scene, camera } = window.__cvThree();
    const GROUND = new Set(["LM_grass", "LM_lawn", "LM_plaza", "LM_concrete", "LM_stone"]);
    // A MeshBasicMaterial from the village model's own class (no import in page code).
    let Basic = null;
    scene.traverse((o) => {
      if (!Basic && o.isMesh && o.material && !Array.isArray(o.material) && o.material.isMeshBasicMaterial) Basic = o.material.constructor;
    });
    // One flat copy per source material, keeping its polygon offset: the ground's 1-3 cm layers (plaza, lanes, lawns)
    // only win over the base grass because of it.
    const copies = new Map();
    const flat = (src) => {
      const key = src;
      let m = copies.get(key);
      if (!m) {
        m = new Basic();
        const c = GROUND.has(src.name) ? 1 : 0;
        m.color.setRGB(c, c, c);
        m.fog = false;
        m.toneMapped = false;
        m.side = 2;
        m.polygonOffset = !!src.polygonOffset;
        m.polygonOffsetFactor = src.polygonOffsetFactor;
        m.polygonOffsetUnits = src.polygonOffsetUnits;
        copies.set(key, m);
      }
      return m;
    };
    const saved = [];
    scene.traverse((o) => {
      if (o.isPoints) {
        saved.push([o, "visible", o.visible]);
        o.visible = false;
        return;
      }
      if (!(o.isMesh || o.isSkinnedMesh) || !o.visible) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      // Decals lie ON the ground (the avatars' shadow plane and blobs, the door pads): not part of the picture of it.
      if (list.some((m) => m.isShadowMaterial || (m.transparent && !m.depthWrite && m.name !== "M_water (runtime)"))) {
        saved.push([o, "visible", o.visible]);
        o.visible = false;
        return;
      }
      const mapped = list.map(flat);
      saved.push([o, "material", o.material]);
      o.material = Array.isArray(o.material) ? mapped : mapped[0];
    });
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    const prevColor = gl.getClearColor(new bg.constructor());
    const prevAlpha = gl.getClearAlpha();
    const prevTarget = gl.getRenderTarget();
    gl.setRenderTarget(null);
    gl.setClearColor(0x000000, 1);
    gl.render(scene, camera);
    const w = gl.domElement.width;
    const h = gl.domElement.height;
    const c2 = document.createElement("canvas");
    c2.width = w;
    c2.height = h;
    const ctx = c2.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(gl.domElement, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    // restore
    for (const [o, key, v] of saved) o[key] = v;
    scene.background = bg;
    scene.fog = fog;
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevColor, prevAlpha);
    for (const m of copies.values()) m.dispose();
    // the view rays
    camera.updateMatrixWorld(true);
    const inv = camera.projectionMatrixInverse.elements;
    const mw = camera.matrixWorld.elements;
    const ox = mw[12], oy = mw[13], oz = mw[14];
    const out = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) {
      const ny = 1 - ((j + 0.5) / h) * 2;
      for (let i = 0; i < w; i++) {
        if (px[(j * w + i) * 4] < 200) continue;
        const nx = ((i + 0.5) / w) * 2 - 1;
        // view-space point on the far plane, direction in world space
        const vx = inv[0] * nx + inv[4] * ny + inv[8] * 1 + inv[12];
        const vy = inv[1] * nx + inv[5] * ny + inv[9] * 1 + inv[13];
        const vz = inv[2] * nx + inv[6] * ny + inv[10] * 1 + inv[14];
        const vw = inv[3] * nx + inv[7] * ny + inv[11] * 1 + inv[15];
        const dx0 = vx / vw, dy0 = vy / vw, dz0 = vz / vw;
        const dx = mw[0] * dx0 + mw[4] * dy0 + mw[8] * dz0;
        const dy = mw[1] * dx0 + mw[5] * dy0 + mw[9] * dz0;
        const dz = mw[2] * dx0 + mw[6] * dy0 + mw[10] * dz0;
        if (dy >= -1e-6) continue;
        const t = -oy / dy;
        const len = Math.hypot(dx, dy, dz);
        if (t * len > 120) continue;
        const gx = ox + t * dx;
        const gz = oz + t * dz;
        if (gx < -95 || gx > 95 || gz < -95 || gz > 95) continue;
        out[j * w + i] = 1;
      }
    }
    let bin = "";
    for (let k = 0; k < out.length; k += 8192) bin += String.fromCharCode(...out.subarray(k, k + 8192));
    return { w, h, b64: btoa(bin) };
  });
}

/** A grayscale PNG writer (8-bit), for the mask evidence. */
function pngGray(w, h, data) {
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, body) => {
    const t = Buffer.concat([Buffer.from(type), body]);
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    t.copy(out, 4);
    out.writeUInt32BE(crc(t), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let j = 0; j < h; j++) {
    raw[j * (w + 1)] = 0;
    for (let i = 0; i < w; i++) raw[j * (w + 1) + 1 + i] = data[j * w + i] ? 255 : 0;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}


const round = (n) => (n === null ? null : Math.round(n * 1000) / 1000);
const stats = {};

/** One shot: the frame, the HUD version, the mask, and the bar for the phase. */
async function shoot(P, tier, phase, view) {
  const base = `${tier}-${phase}-${view}`;
  await hideHud(P);
  await sleep(300);
  await run.shot(P, `${base}-frame.png`);
  const mask = await maskOf(P);
  writeFileSync(join(OUT, `${base}-walk.png`), pngGray(mask.w, mask.h, Buffer.from(mask.b64, "base64")));
  const m = nightStats(decodePng(readFileSync(join(OUT, `${base}-frame.png`))), decodePng(readFileSync(join(OUT, `${base}-walk.png`))));
  await showHud(P);
  await run.shot(P, `${base}.png`);
  const row = { mean: round(m.mean), p5: round(m.p5), walkShare: round(m.walkShare), walkP50: round(m.walkP50) };
  stats[base] = row;
  console.log(`   ${base}: mean ${row.mean}, p5 ${row.p5}, walkable ${row.walkShare} of the frame, p50 ${row.walkP50}`);
  if (phase === "night") {
    run.check(`${base}: night bar: mean >= ${NIGHT_MEAN_MIN} and walkable p50 >= ${NIGHT_WALK_P50_MIN}`, passesNight(m), row);
  } else if (phase === "noon" || phase === "golden") {
    run.check(`${base}: day bar: mean >= ${MEAN_MIN} and p5 >= ${P5_MIN}`, passes(m), row);
  } else {
    run.check(`${base}: dusk/dawn: at least the night bar's mean (${NIGHT_MEAN_MIN})`, m.mean >= NIGHT_MEAN_MIN, row);
  }
}

const browser = await launchBrowser();
try {
  for (const tier of TIERS) {
    const P = await openPlayer(browser, run, { tag: tier, device: tier === "high" ? DESKTOP : PHONE, settings: { graphics: tier } });
    for (const phase of WANT) {
      await run.step(`${tier}: ${phase} (${DATE}T${PHASES[phase]} KST)`, async () => {
        await joinVillage(P, PHASES[phase]);
        await setOrbit(P, 6, 0.35);
        await sleep(600);
        await shoot(P, tier, phase, "plaza");
        // the lane to the memorial, between its lamps and houses, looking north
        for (const [x, z] of [[-20, 5], [-14, -20], [0, -33]]) await walkAndWait(P, x, z, 40000, 1.2);
        await turnCameraTo(P, 0, -58);
        await setOrbit(P, 5, 0.2);
        await sleep(1000);
        await shoot(P, tier, phase, "lane");
        // the memorial's front, on the path by the forecourt
        await walkAndWait(P, 0, -48.6, 40000, 1.0);
        await turnCameraTo(P, 0, -60);
        await setOrbit(P, 4.5, 0.3);
        await sleep(1500);
        await shoot(P, tier, phase, "memorial");
      });
    }
    await P.ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, "village-daynight.json"), JSON.stringify({ date: DATE, phases: PHASES, stats }, null, 2));
process.exit(run.finish({ stats }));
