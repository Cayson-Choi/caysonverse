/**
 * e2e/menu-audit.mjs — the 메뉴 panel audit (owner 2026-11-20: "이 메뉴는 전부 동작하는거 맞어?"). Every control is changed through the real
 * panel and the REAL effect is asserted, not just the stored setting:
 *
 *   소리 켜기 / 배경음악 / 음악 크기  the Web Audio graph (gain levels + an analyser tapped on every connection to a destination)
 *   시점 감도                       the same drag turns the camera yaw 0.5x / 1x / 2x as far
 *   이름표 보기 / 내 이름표 보기      the name tags the NametagSystem really selects with a crowd of remotes near and far
 *   1인칭으로 보기 (V)               the view mode, the V key, the switch
 *   그래픽 / 밝기                    renderer pixel ratio, shadow map, post chain, sun shadow, tier mark; exposure + screenshots
 *   조작 안내 다시 보기 / 닫기        the guide card opens; the menu closes
 *   persistence                     all of it survives a reload; panel fits the phone screen; labels are not cut off
 *
 *   CV_CLIENT_URL=http://localhost:5973 node e2e/menu-audit.mjs --device pc|phone
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, cdp, createRun, launchBrowser, openPlayer, press, sleep, touchDown, touchMoveTo, touchUp, walkAndWait } from "./lib/common.mjs";
import { enterHall, joinVillage } from "./lib/village.mjs";

const { values: args } = parseArgs({ options: { device: { type: "string", default: "pc" }, out: { type: "string", default: "D:/ClaudeCode/tmpshots/menu-audit" } } });
const PHONE_DEV = args.device === "phone";
const OUT = args.out;
mkdirSync(OUT, { recursive: true });

const run = createRun("menu-audit-" + args.device);
const check = run.check;
// A phone-only GL notice that main already has (12 lines of "glGetProgramiv: Program object expected" while the village streams in; see
// docs/designs/village-lots-v2/contract.md 12.1/12.2). It is not the menu's: village-mobile shows it too.
if (args.device === "phone") run.allow("known phone GL program notice", /glGetProgramiv: Program object expected/);
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "M", device: PHONE_DEV ? PHONE : DESKTOP });
const page = p.page;
// Web Audio taps, installed before the page's own scripts: every node connected to a context's destination is also fed to an analyser,
// so "what is really coming out" is measurable; every GainNode is listed.
await p.ctx.addInitScript(() => {
  const taps = (window.__aud = { ctxs: [], gains: [] });
  const origConnect = AudioNode.prototype.connect;
  const analysers = new Map();
  AudioNode.prototype.connect = function (dest, ...rest) {
    try {
      if (dest && dest === this.context.destination) {
        let an = analysers.get(this.context);
        if (!an) {
          an = this.context.createAnalyser();
          an.fftSize = 2048;
          analysers.set(this.context, an);
          taps.ctxs.push(this.context);
        }
        origConnect.call(this, an);
      }
    } catch {}
    return origConnect.call(this, dest, ...rest);
  };
  const origGain = BaseAudioContext.prototype.createGain;
  BaseAudioContext.prototype.createGain = function () {
    const g = origGain.call(this);
    taps.gains.push(g);
    return g;
  };
  window.__audRms = () => {
    let sum = 0;
    const buf = new Float32Array(2048);
    for (const c of taps.ctxs) {
      const an = analysers.get(c);
      an.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      sum = Math.max(sum, Math.sqrt(s / buf.length));
    }
    return sum;
  };
});

const MENU_BTN = '[aria-label="메뉴 열기"]';
const openMenu = async () => {
  if (await page.locator(".cv-menu").count()) return;
  await press(p, page.locator(MENU_BTN).first());
  await page.locator(".cv-menu").waitFor({ state: "visible", timeout: 5000 });
  await sleep(350);
};
const closeMenu = async () => {
  if (!(await page.locator(".cv-menu").count())) return;
  await press(p, page.locator(".cv-menu-close"));
  await page.waitForFunction(() => !document.querySelector(".cv-menu"), null, { timeout: 3000 }).catch(() => {});
  await sleep(200);
};
const sw = (id) => page.locator(`[role=switch][aria-labelledby=${id}]`);
const seg = (id, label) => page.locator(`[role=group][aria-labelledby=${id}] button`, { hasText: label }).first();
const setRange = async (id, v) => {
  await page.locator("#" + id).evaluate((el, val) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, String(val));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
  await sleep(150);
};
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("cv-settings-v1") || "{}"));
const rms = async (ms = 1200) => {
  await sleep(ms);
  let best = 0;
  for (let i = 0; i < 6; i++) {
    best = Math.max(best, await page.evaluate(() => window.__audRms?.() ?? -1));
    await sleep(80);
  }
  return best;
};
const bgm = () => page.evaluate(() => {
  const b = window.__cvBgm;
  const a = b?.element();
  return b && a ? { paused: a.paused, level: Math.round(b.level() * 1000) / 1000, routed: b.isRouted(), t: a.currentTime } : null;
});
const view = () => page.evaluate(() => window.__cv.getView());
const yaw = () => page.evaluate(() => window.__cv.getOrbit().yaw);
const tagCount = () =>
  page.evaluate(() => window.__cv.getNametags().filter((t) => t.selected && t.opacity > 0.4 && !t.occluded).length);
const ownTag = () =>
  page.evaluate(() => {
    const me = window.__cv.getSessionId();
    const t = window.__cv.getNametags().find((x) => x.id === me);
    return t ? { selected: t.selected, opacity: Math.round(t.opacity * 100) / 100 } : null;
  });
const gfx = () =>
  page.evaluate(async () => {
    const { gl } = window.__cvThree();
    const q = await window.__imp("/src/game/QualityEffects.tsx");
    let sunShadow = null;
    window.__cvThree().scene.traverse((o) => {
      if (o.isDirectionalLight && sunShadow === null) sunShadow = !!o.castShadow;
    });
    return {
      dpr: gl.getPixelRatio(),
      shadowMap: gl.shadowMap.enabled,
      sunCastShadow: sunShadow,
      post: !!q.activePostChain(),
      mark: document.documentElement.dataset.gfx ?? null,
      exposure: gl.toneMappingExposure,
    };
  });

await run.step("join the village", async () => {
  await joinVillage(p, "Mn");
  await walkAndWait(p, 0, 14, 25000, 1.5);
  await sleep(1500);
  check("in the village", (await page.evaluate(() => window.__cv.getScreen())) === "village");
});

// ───────────────────────────────── the panel: opens, fits, labels whole ─────────────────────────────────
await run.step("panel layout", async () => {
  await openMenu();
  const m = await page.evaluate(() => {
    const card = document.querySelector(".cv-menu");
    const r = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const cut = [];
    for (const el of card.querySelectorAll("span, label, button, h2, h3, p")) {
      const c = getComputedStyle(el);
      if (c.display === "none") continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1 && c.overflow !== "visible") cut.push("h-overflow:" + el.textContent.trim().slice(0, 20));
      // a label that sticks out of the card sideways
      if (b.right > r.right + 1 || b.left < r.left - 1) cut.push("outside:" + el.textContent.trim().slice(0, 20));
    }
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, scrollH: card.scrollHeight, clientH: card.clientHeight, overflowY: cs.overflowY, cut };
  });
  const fits = m.top >= -0.5 && m.bottom <= m.vh + 0.5 && m.left >= -0.5 && m.right <= m.vw + 0.5;
  check("card inside the viewport", fits, m);
  check("card scrolls when taller than its box", m.scrollH <= m.clientH + 1 || /auto|scroll/.test(m.overflowY), m);
  check("no label cut off or sticking out", m.cut.length === 0, m.cut);
  // last control (닫기) reachable: scroll it into view and it is inside the viewport
  await page.locator(".cv-menu-close").scrollIntoViewIfNeeded();
  const cb = await page.locator(".cv-menu-close").boundingBox();
  check("닫기 reachable inside the viewport", cb && cb.y >= 0 && cb.y + cb.height <= (PHONE_DEV ? 812 : 800) + 0.5, cb);
  await page.screenshot({ path: join(OUT, `panel-${args.device}.png`) });
  await page.locator(".cv-menu").evaluate((el) => (el.scrollTop = 0));
  const rows = await page.evaluate(() => [...document.querySelectorAll(".cv-menu-label")].map((e) => e.textContent.trim()));
  console.log("   rows:", rows.join(" | "));
  const need = PHONE_DEV ? ["소리 켜기", "배경음악", "소리 크기", "버튼 크기", "왼손잡이 모드", "시점 감도", "이름표 보기", "내 이름표 보기", "1인칭으로 보기", "그래픽", "밝기"] : ["소리 켜기", "배경음악", "소리 크기", "시점 감도", "이름표 보기", "내 이름표 보기", "1인칭으로 보기 (V)", "그래픽", "밝기"];
  check("every documented row is there", need.every((r) => rows.includes(r)), rows);
  await closeMenu();
});

// ───────────────────────────────── 소리 켜기 / 배경음악 / 음악 크기 ─────────────────────────────────
await run.step("sound", async () => {
  // a user gesture starts the music (the first tap/click anywhere)
  if (PHONE_DEV) await page.touchscreen.tap(300, 300);
  else await page.mouse.click(640, 400);
  await sleep(3500);
  let s = await bgm();
  const base = await rms(500);
  check("music is playing at the start", s && !s.paused && s.level > 0.3 && s.routed, { s, base });
  check("real output (analyser) is audible while the music plays", base > 0.0005, base);

  await openMenu();
  // master off
  await sw("cv-menu-sound").click();
  await sleep(500);
  s = await bgm();
  const mutedRms = await rms(1500);
  check("소리 끄기: music gain 0 and element paused", s && s.level === 0 && s.paused, s);
  check("소리 끄기: real output is silent", mutedRms < 0.0002, mutedRms);
  check("소리 끄기: 배경음악 switch and slider disabled", (await sw("cv-menu-music").isDisabled()) && (await page.locator("#cv-menu-music-volume").isDisabled()));
  // every other WebAudio source obeys the master (star chime, bus horn, falls, lake fight, the Caysonland rides)
  // (the fountain's water fades to 0 at once and frees its nodes FOUNTAIN_IDLE_STOP_S = 3 s later: wait for that)
  await page.waitForFunction(() => !(window.__cvSfx?.fountainRunning?.() ?? false), null, { timeout: 8000 }).catch(() => {});
  const gainsMuted = await page.evaluate(() => window.__aud.gains.filter((g) => g.gain.value > 0.0005).length);
  check("소리 끄기: no GainNode is left above 0 (every sound source obeys the master)", gainsMuted === 0, { gainsMuted });
  await sw("cv-menu-sound").click();
  await sleep(3000);
  s = await bgm();
  const backRms = await rms(800);
  check("소리 켜기: music plays again at its level", s && !s.paused && s.level > 0.3, s);
  check("소리 켜기: real output is audible again", backRms > 0.0005, backRms);

  // 배경음악 off / on
  await sw("cv-menu-music").click();
  await sleep(600);
  s = await bgm();
  // the plaza fountain is a sound effect, not music: it keeps playing with 배경음악 off (it follows 소리 and 소리 크기), so the
  // silence is measured with the 소리 크기 slider at 0 (owner 2026-11-27: the fountain follows the slider)
  await page.locator("#cv-menu-music-volume").fill("0");
  await sleep(800);
  const offRms = await rms(1500);
  check("배경음악 끄기: music paused and silent", s && s.paused && offRms < 0.0002, { s, offRms });
  check("배경음악 끄기: the 소리 크기 slider stays on (it also sets the fountain, falls and rides)", !(await page.locator("#cv-menu-music-volume").isDisabled()));
  await page.locator("#cv-menu-music-volume").fill("1");
  await sw("cv-menu-music").click();
  await sleep(3000);
  s = await bgm();
  check("배경음악 켜기: playing again", s && !s.paused, s);

  // volume slider scales the music gain
  const levels = {};
  for (const v of [1, 0.5, 0.2, 0]) {
    await setRange("cv-menu-music-volume", v);
    await sleep(900);
    levels[v] = (await bgm()).level;
  }
  const ratio = levels[0.5] / levels[1];
  check("음악 크기: gain scales with the slider (0.5 -> half, 0.2 -> a fifth, 0 -> silent)", Math.abs(ratio - 0.5) < 0.06 && Math.abs(levels[0.2] / levels[1] - 0.2) < 0.05 && levels[0] === 0, levels);
  await setRange("cv-menu-music-volume", 0.5);
  await sleep(900);
  const half = await rms(500);
  await setRange("cv-menu-music-volume", 1);
  await sleep(900);
  const full = await rms(500);
  check("음악 크기: real output is louder at 100% than at 50%", full > half * 1.3, { half, full });
  const keep = await page.evaluate(() => localStorage.getItem("cv-music-volume"));
  await setRange("cv-menu-music-volume", 0.5);
  await closeMenu();
  check("음악 크기: saved", keep === "1" && (await page.evaluate(() => localStorage.getItem("cv-music-volume"))) === "0.5", keep);
});

// ───────────────────────────────── 시점 감도 ─────────────────────────────────
const dragYaw = async () => {
  const y0 = await yaw();
  const y = PHONE_DEV ? 500 : 300;
  const x0 = PHONE_DEV ? 220 : 400;
  if (PHONE_DEV) {
    await touchDown(p, x0, y);
    for (let i = 1; i <= 10; i++) {
      await touchMoveTo(p, x0 + i * 10, y);
      await sleep(16);
    }
    await touchUp(p);
  } else {
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x0 + i * 10, y);
      await sleep(16);
    }
    await page.mouse.up();
  }
  await sleep(250);
  let d = (await yaw()) - y0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
await run.step("sensitivity", async () => {
  const res = {};
  for (const v of [0.5, 1, 2]) {
    await openMenu();
    await setRange("cv-menu-sensitivity", v);
    await closeMenu();
    res[v] = await dragYaw();
  }
  console.log("   yaw deltas for a 100 px drag:", JSON.stringify(res));
  const r1 = res[0.5] / res[1];
  const r2 = res[2] / res[1];
  check("시점 감도: 0.5x turns half, 2x turns double of 1x", Math.abs(res[1]) > 0.1 && Math.abs(r1 - 0.5) < 0.06 && Math.abs(r2 - 2) < 0.15, { res, r1, r2 });
  check("시점 감도: saved", (await stored()).lookSensitivity === 2);
  // the same in first person (the drag turns the separate fp yaw)
  await openMenu();
  await sw("cv-menu-first-person").click();
  await closeMenu();
  await sleep(700);
  const fpRes = {};
  for (const v of [0.5, 1, 2]) {
    await openMenu();
    await setRange("cv-menu-sensitivity", v);
    await closeMenu();
    const y0 = (await view()).fpYaw;
    await dragYaw();
    let d = (await view()).fpYaw - y0;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    fpRes[v] = d;
  }
  console.log("   first-person yaw deltas:", JSON.stringify(fpRes));
  check("시점 감도 (1인칭): 0.5x half, 2x double", Math.abs(fpRes[1]) > 0.1 && Math.abs(fpRes[0.5] / fpRes[1] - 0.5) < 0.06 && Math.abs(fpRes[2] / fpRes[1] - 2) < 0.15, fpRes);
  await openMenu();
  await sw("cv-menu-first-person").click();
  await closeMenu();
  await sleep(500);
  await openMenu();
  await setRange("cv-menu-sensitivity", 1);
  await closeMenu();
});

// ───────────────────────────────── 이름표 ─────────────────────────────────
await run.step("name tags", async () => {
  // 24 remotes within 6..26 m in front of the camera (on screen), 8 more 45..60 m away (past the fade-out distance)
  await page.evaluate(async () => {
    const store = await window.__imp("/src/game/remoteStore.ts");
    const playout = await window.__imp("/src/game/playout.ts");
    const t = window.__cvThree();
    const f = new t.camera.position.constructor();
    t.camera.getWorldDirection(f);
    const base = Math.atan2(f.x, f.z);
    const cx = t.camera.position.x;
    const cz = t.camera.position.z;
    let seed = 777;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const mk = (id, dist, ang) => {
      store.addRemote({ sessionId: id, nickname: id, appearance: undefined, connected: true, seatIndex: -1, busSeat: -1, rideSeat: -1, rideId: 0, snapshots: [], playout: playout.createPlayout(0) });
      store.receiveRemotePose(id, performance.now(), 0, cx + Math.sin(ang) * dist, cz + Math.cos(ang) * dist, 0);
    };
    for (let i = 0; i < 24; i++) mk(`near${i}`, 6 + rand() * 18, base + (rand() - 0.5) * 0.5);
    for (let i = 0; i < 8; i++) mk(`far${i}`, 45 + rand() * 15, base + (rand() - 0.5) * 0.3);
  });
  await sleep(3000);
  const counts = {};
  for (const [mode, label] of [["all", "모두"], ["nearby", "가까운 사람만"], ["off", "끄기"]]) {
    await openMenu();
    await seg("cv-menu-nametags", label).click();
    await closeMenu();
    await sleep(2500);
    const tags = await page.evaluate(() => window.__cv.getNametags().filter((t) => t.selected && t.opacity > 0.4).map((t) => t.id));
    counts[mode] = { n: tags.length, far: tags.filter((i) => i.startsWith("far")).length, own: tags.some((i) => !i.startsWith("near") && !i.startsWith("far")), mode: await page.evaluate(() => window.__cv.getNametagMode()) };
    await page.screenshot({ path: join(OUT, `nametags-${mode}-${args.device}.png`) });
  }
  console.log("   name tags:", JSON.stringify(counts));
  check("이름표 모두: every near tag is drawn (more than the nearby cap), no far one", counts.all.n > 15 && counts.all.far === 0, counts.all);
  check("이름표 가까운 사람만: capped to the nearest ones (fewer than 모두)", counts.nearby.n > 0 && counts.nearby.n < counts.all.n && counts.nearby.far === 0, counts.nearby);
  check("이름표 끄기: none drawn, own tag included", counts.off.n === 0 && !counts.off.own, counts.off);
  // own tag: with 모두 on, switch 내 이름표 off and on
  await openMenu();
  await seg("cv-menu-nametags", "모두").click();
  await closeMenu();
  await sleep(2000);
  const own1 = await ownTag();
  await openMenu();
  await sw("cv-menu-own-nametag").click();
  await closeMenu();
  await sleep(2000);
  const own2 = await ownTag();
  await openMenu();
  await sw("cv-menu-own-nametag").click();
  await closeMenu();
  await sleep(2500);
  const own3 = await ownTag();
  check("내 이름표 보기: shown, then hidden, then shown again", own1?.selected && own1.opacity > 0.4 && (!own2 || (!own2.selected && own2.opacity < 0.1)) && own3?.selected && own3.opacity > 0.4, { own1, own2, own3 });
  await openMenu();
  await seg("cv-menu-nametags", "가까운 사람만").click();
  await closeMenu();
});

// ───────────────────────────────── 1인칭 ─────────────────────────────────
await run.step("first person", async () => {
  const m0 = (await view()).mode;
  await openMenu();
  await sw("cv-menu-first-person").click();
  await sleep(300);
  const on = await sw("cv-menu-first-person").getAttribute("aria-checked");
  await closeMenu();
  await sleep(700);
  const m1 = (await view()).mode;
  const selfVisible = await page.evaluate(() => window.__cv.getSelfVisible());
  await page.screenshot({ path: join(OUT, `fp-on-${args.device}.png`) });
  check("1인칭으로 보기: switch changes the camera to first person", m0 === "tp" && m1 === "fp" && on === "true", { m0, m1, on, selfVisible });
  if (!PHONE_DEV) {
    await page.keyboard.press("KeyV");
    await sleep(700);
    const m2 = (await view()).mode;
    await openMenu();
    const sw2 = await sw("cv-menu-first-person").getAttribute("aria-checked");
    await closeMenu();
    check("V key toggles back to third person and the switch follows", m2 === "tp" && sw2 === "false", { m2, sw2 });
    await page.keyboard.press("KeyV");
    await sleep(600);
    check("V key toggles to first person", (await view()).mode === "fp");
  }
  await openMenu();
  const sw3 = await sw("cv-menu-first-person").getAttribute("aria-checked");
  await sw("cv-menu-first-person").click();
  await closeMenu();
  await sleep(700);
  check("switch off returns to third person", (await view()).mode === "tp" && sw3 === "true", { mode: (await view()).mode, sw3 });
});

// ───────────────────────────────── 그래픽 / 밝기 ─────────────────────────────────
await run.step("graphics", async () => {
  const setG = async (label) => {
    await openMenu();
    await seg("cv-menu-graphics", label).click();
    await closeMenu();
    await sleep(2500);
    return gfx();
  };
  const auto0 = await setG("자동");
  const high = await setG("화려하게");
  await page.screenshot({ path: join(OUT, `gfx-high-${args.device}.png`) });
  const low = await setG("가볍게");
  await page.screenshot({ path: join(OUT, `gfx-low-${args.device}.png`) });
  const auto1 = await setG("자동");
  console.log("   graphics:", JSON.stringify({ auto0, high, low, auto1 }));
  check("화려하게: post chain on, shadow map on, sun casts, pixel ratio above 1 where the screen has a ratio of 2 (phone; the PC is measured in its own pass below)", high.post && high.shadowMap && high.sunCastShadow && high.mark === "high" && (!PHONE_DEV || high.dpr > 1), high);
  check("가볍게: no post chain, shadow map off, blob shadows, dpr 1", !low.post && !low.shadowMap && !low.sunCastShadow && low.mark === "low" && low.dpr === 1, low);
  check("화려하게 and 가볍게 really differ", JSON.stringify([high.post, high.shadowMap, high.mark]) !== JSON.stringify([low.post, low.shadowMap, low.mark]));
  const expectAuto = PHONE_DEV ? "low" : null;
  check("자동: " + (PHONE_DEV ? "a phone gets the light tier" : "a PC gets the rich tier (or light where WebGL is software)"), PHONE_DEV ? auto1.mark === "low" && !auto1.post : auto1.mark === "high" || auto1.mark === "low", auto1);
  check("자동 equals the tier of its device (same as the explicit choice)", auto1.post === (auto1.mark === "high") && auto1.shadowMap === (auto1.mark === "high"), { auto1, expectAuto });
  // pick the rich tier for the brightness shots on PC; the phone stays on its tier
  if (!PHONE_DEV) await setG("화려하게");
});
const brightRef = { v: null };
await run.step("brightness", async () => {
  const lum = async (file) => {
    const png = await page.screenshot({ path: join(OUT, file) });
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = Math.round((160 * img.height) / img.width);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (d.length / 4);
    }, png.toString("base64"));
  };
  const res = {};
  brightRef.v = null;
  for (const v of [0.8, 1.0, 1.4]) {
    await openMenu();
    await setRange("cv-menu-brightness", v);
    await closeMenu();
    await sleep(1500);
    const g = await gfx();
    res[v] = { exposure: g.exposure, luma: Math.round((await lum(`brightness-${v}-${args.device}.png`)) * 10) / 10 };
  }
  console.log("   brightness:", JSON.stringify(res));
  check("밝기: exposure follows the slider", res[0.8].exposure < res[1].exposure && res[1].exposure < res[1.4].exposure, res);
  check("밝기: the picture really gets brighter (screenshot luma)", res[0.8].luma < res[1].luma && res[1].luma < res[1.4].luma && res[1.4].luma - res[0.8].luma > 5, res);
  brightRef.v = res[1].exposure;
  await openMenu();
  await setRange("cv-menu-brightness", 1.2);
  await closeMenu();
});

// ───────────────────────────────── 조작 안내 다시 보기 / 닫기 ─────────────────────────────────
await run.step("guide + close", async () => {
  check("guide card is not up before", (await page.locator(".cv-coach").count()) === 0);
  await openMenu();
  await press(p, page.locator(".cv-menu-link"));
  await sleep(700);
  const menuGone = (await page.locator(".cv-menu").count()) === 0;
  const card = await page.locator(".cv-coach").first().textContent().catch(() => null);
  await page.screenshot({ path: join(OUT, `guide-${args.device}.png`) });
  check("조작 안내 다시 보기: the menu closes and the guide's first card opens", menuGone && !!card && (await page.locator('.cv-coach[data-step="move"]').count()) === 1, card);
  await page.locator(".cv-coach-skip").click().catch(() => {});
  await sleep(300);
  await openMenu();
  await press(p, page.locator(".cv-menu-close"));
  await sleep(400);
  check("닫기: the menu closes", (await page.locator(".cv-menu").count()) === 0);
  // Esc closes too (PC)
  if (!PHONE_DEV) {
    await openMenu();
    await page.keyboard.press("Escape");
    await sleep(400);
    check("Esc closes the menu", (await page.locator(".cv-menu").count()) === 0);
  }
  // the dimmed backdrop closes
  await openMenu();
  const bd = await page.locator(".cv-menu-backdrop").boundingBox();
  if (PHONE_DEV) await page.touchscreen.tap(bd.x + 4, bd.y + 4);
  else await page.mouse.click(bd.x + 4, bd.y + 4);
  await sleep(400);
  check("tap on the dimmed backdrop closes the menu", (await page.locator(".cv-menu").count()) === 0);
});

// ───────────────────────────────── inside the memorial hall: the same controls reach the hall's renderer ─────────────────────────────────
await run.step("hall", async () => {
  await enterHall(p);
  check("in the hall", (await page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea())) === "hall");
  const ex = {};
  for (const v of [0.8, 1.4]) {
    await openMenu();
    await setRange("cv-menu-brightness", v);
    await closeMenu();
    await sleep(1500);
    ex[v] = (await gfx()).exposure;
  }
  check("밝기 in the hall: exposure follows the slider", ex[0.8] > 0 && ex[1.4] / ex[0.8] > 1.5 && ex[1.4] / ex[0.8] < 1.85, ex);
  await page.screenshot({ path: join(OUT, `hall-bright-${args.device}.png`) });
  const tiers = {};
  for (const [k, label] of [["high", "화려하게"], ["low", "가볍게"]]) {
    await openMenu();
    await seg("cv-menu-graphics", label).click();
    await closeMenu();
    await sleep(2500);
    tiers[k] = await gfx();
  }
  check("그래픽 in the hall: 화려하게 has the post chain + shadows, 가볍게 has neither", tiers.high.post && tiers.high.shadowMap && !tiers.low.post && !tiers.low.shadowMap, tiers);
  await page.screenshot({ path: join(OUT, `hall-gfx-low-${args.device}.png`) });
  const s = await bgm();
  check("the music's hall level is 0.15 x the slider", !s || s.paused || s.level <= 0.16, s);
  await openMenu();
  await setRange("cv-menu-brightness", 1.3);
  await closeMenu();
});

// ───────────────────────────────── PC at devicePixelRatio 2: the tiers' pixel ratios ─────────────────────────────────
if (!PHONE_DEV) {
  await run.step("pixel ratio on a 2x PC screen", async () => {
    const q = await openPlayer(browser, run, { tag: "Q", device: { ...DESKTOP, deviceScaleFactor: 2 }, settings: { graphics: "high" } });
    await joinVillage(q, "Mq");
    await sleep(2500);
    const dprOf = () => q.page.evaluate(() => window.__cvThree().gl.getPixelRatio());
    const hi = await dprOf();
    await q.page.locator(MENU_BTN).first().click();
    await q.page.locator(".cv-menu").waitFor({ state: "visible" });
    await sleep(300);
    await q.page.locator("[role=group][aria-labelledby=cv-menu-graphics] button", { hasText: "가볍게" }).click();
    await sleep(2500);
    const lo = await dprOf();
    check("화려하게 draws at the screen's pixel ratio (> 1), 가볍게 at 1", hi > 1 && lo === 1, { hi, lo });
    await q.ctx.close();
  });
}

// ───────────────────────────────── persistence ─────────────────────────────────
await run.step("persistence", async () => {
  await openMenu();
  await sw("cv-menu-sound").click();
  await seg("cv-menu-nametags", "끄기").click();
  await setRange("cv-menu-sensitivity", 1.5);
  await setRange("cv-menu-brightness", 1.3);
  await seg("cv-menu-graphics", "가볍게").click();
  await setRange("cv-menu-music-volume", 0.3);
  await closeMenu();
  await sleep(500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 40000 });
  await sleep(500);
  await page.locator("input.cv-input").first().fill("Mn" + Math.floor(Math.random() * 900 + 100));
  await press(p, page.locator(".cv-submit"));
  await page.waitForFunction(() => window.__cv?.getScreen?.() === "village" && !!window.__cvBgm, null, { timeout: 60000 });
  await sleep(2500);
  await openMenu();
  const state = {
    soundOn: await sw("cv-menu-sound").getAttribute("aria-checked"),
    nametags: await page.evaluate(() => document.querySelector("[aria-labelledby=cv-menu-nametags] .is-on")?.textContent),
    sens: await page.locator("#cv-menu-sensitivity").inputValue(),
    bright: await page.locator("#cv-menu-brightness").inputValue(),
    gfx: await page.evaluate(() => document.querySelector("[aria-labelledby=cv-menu-graphics] .is-on")?.textContent),
    vol: await page.locator("#cv-menu-music-volume").inputValue().catch(() => null),
  };
  check("after a reload: every setting is still what it was", state.soundOn === "false" && state.nametags === "끄기" && state.sens === "1.5" && state.bright === "1.3" && state.gfx === "가볍게" && state.vol === "0.3", state);
  const real = await gfx();
  check("after a reload: the renderer really runs the saved choices", !real.post && Math.abs(real.exposure - 1.3 * brightRef.v) < 0.03 && real.mark === "low", real);
  const s = await bgm();
  check("after a reload: the music is silent (소리 끄기 persisted)", !s || s.level === 0, s);
  await closeMenu();
});

await browser.close();
process.exit(run.finish());
