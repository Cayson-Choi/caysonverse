/**
 * e2e/village-stars.mjs — 케이슨 마을 밤하늘 점검: 실제 별자리(예일 밝은 별 목록)와 "별자리 찾기".
 *
 *   npm run dev   (다른 창에서; 또는 CV_CLIENT_URL=http://localhost:<포트>)
 *   node e2e/village-stars.mjs [--out=<폴더>] [--only=sky,pc,phone,day,tiers]
 *
 * 시각은 DEV 주소 `?time=<한국 시각>`으로 고정한다(villageClock.ts).
 *  - sky:   봄·여름·가을·겨울 저녁 21:00의 1인칭 하늘. 북극성 고도(마을 위도 36.5° 근처)와 주요 별의 고도/방위를 USNO 값과
 *           비교하고, 북쪽(북극성과 북두칠성)·남쪽(겨울 오리온)·여름의 대삼각형·가을 페가수스를 찍는다(HUD 숨김).
 *  - pc:    가을 밤, 3인칭에서 🔭 → 1인칭으로 바뀜, 목표 카드·조준원, 다른 쪽을 보면 가장자리 화살표, 목표를 조준원에
 *           맞추면 1초 뒤 발견(선·이름·이야기·진행 1/6), 다음 별자리, 닫으면 3인칭으로 돌아감.
 *  - phone: 같은 흐름을 휴대폰 크기(터치)로: 🔭 탭, 화면 끌기로 둘러보기, 발견.
 *  - day:   낮(14:00)에는 별이 없고, 🔭은 "별은 밤에 보여요"와 오늘 저녁 시각.
 *  - tiers: 같은 하늘을 화려한/가벼운 화질로.
 * 브라우저는 하나만 띄우고(채널 chrome, D3D11), 끝나면 닫는다.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, openPlayer, press, sleep, touchDown, touchMoveTo, touchUp } from "./lib/common.mjs";

const run = createRun("village-stars");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const ONLY = opt("only", "sky,pc,phone,day,tiers").split(",");
const SKY_SEASONS = args.some((a) => a.startsWith("--seasons=")) ? opt("seasons", "").split(",") : null;
// The known ANGLE/D3D shader-compiler note on some GPUs (not ours).
run.allow("D3D X3595", /X3595/);

const SEASONS = {
  spring: "2026-04-15T21:00",
  summer: "2026-08-15T21:00",
  autumn: "2026-11-10T21:00",
  winter: "2027-01-15T21:00",
};
/** USNO celestial navigation (no refraction): [alt, az] at 21:00 KST. Our probe adds refraction (≤ 0.1° at these heights). */
const USNO = {
  spring: { polaris: [36.33, 359.25], dubhe: [63.21, 15.72], arcturus: [32.81, 89.66], regulus: [65.32, 177.69] },
  summer: { vega: [83.44, 67.03], deneb: [59.65, 60.75], altair: [53.54, 132.53], antares: [23.09, 203.26], polaris: [36.05, 0.55] },
  winter: { betelgeuse: [52.11, 133.59], rigel: [42.73, 157.57], sirius: [25.22, 138.15], capella: [74.02, 48.1], polaris: [37.09, 359.79] },
};

async function launch() {
  return chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
}

let seq = 0;
async function joinAt(p, time) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`별${++seq}${Math.floor(Math.random() * 90 + 10)}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvSky, null, { timeout: 90000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
}
const skyOf = (p) => p.page.evaluate(() => window.__cvSky());
async function waitSky(p) {
  await p.page.waitForFunction(() => window.__cvSky?.().loaded && window.__cvSky().visible, null, { timeout: 30000 });
  await sleep(1500);
}
/** First person, looking toward compass `azDeg` at `altDeg` up (the FP look: yaw = -az, pitch = -alt). */
async function lookAt(p, azDeg, altDeg) {
  await p.page.evaluate(
    async ([az, alt]) => {
      const v = await window.__imp("/src/game/viewState.ts");
      if (v.viewState.mode !== "fp") v.enterFp(0);
      v.viewState.fpYaw = (-az * Math.PI) / 180;
      v.viewState.fpPitch = (-alt * Math.PI) / 180;
    },
    [azDeg, altDeg],
  );
  await sleep(900);
}
/** Hide (or bring back) everything over the canvas but the sky's own layer (the names on the sky stay). */
const hud = (p, on) =>
  p.page.evaluate((show) => {
    if (show) {
      for (const el of window.__skyHidden ?? []) el.style.visibility = "";
      window.__skyHidden = [];
      return;
    }
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    const layer = document.querySelector(".cv-sky-layer");
    for (let e = layer; e; e = e.parentElement) keep.add(e);
    window.__skyHidden = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (keep.has(el) || canvas.contains(el) || (layer && layer.contains(el))) continue;
      if (el.style.visibility !== "hidden") {
        window.__skyHidden.push(el);
        el.style.visibility = "hidden";
      }
    }
  }, on);
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

async function skyScenes(browser) {
  for (const [season, time] of Object.entries(SEASONS)) {
    if (SKY_SEASONS && !SKY_SEASONS.includes(season)) continue;
    await run.step(`sky ${season} ${time}`, async () => {
      const p = await openPlayer(browser, run, { tag: `sky-${season}`, device: DESKTOP, settings: { graphics: "high" } });
      try {
        await joinAt(p, time);
        await waitSky(p);
        const s = await skyOf(p);
        console.log(`   pixel scale ${s.pixel}`);
        run.check("2,549 catalogue stars loaded, random stars hidden", s.count === 2549 && s.randomStarsHidden, { count: s.count, drawn: s.drawn });
        run.check("deep night: full limit 5.5, layer on", s.limit === 5.5 && s.fade === 1, { limit: s.limit, fade: s.fade, sun: s.sunElevationDeg });
        run.check("Polaris at the village's latitude (36.5° ± 0.7), due north", Math.abs(s.stars.polaris.alt - 36.5) < 0.7 && angDiff(s.stars.polaris.az, 0) < 1.2, s.stars.polaris);
        for (const [name, [alt, az]] of Object.entries(USNO[season] ?? {})) {
          const got = s.stars[name];
          run.check(`${name} vs USNO (alt ${alt}, az ${az}) within 0.15°`, Math.abs(got.alt - alt) < 0.15 && angDiff(got.az, az) * Math.cos((alt * Math.PI) / 180) < 0.15, got);
        }
        await hud(p, false);
        if (season === "spring") {
          await lookAt(p, 10, 48);
          await run.shot(p, `sky-spring-north-polaris-dipper.png`);
        } else if (season === "summer") {
          await lookAt(p, 95, 62);
          await run.shot(p, `sky-summer-triangle.png`);
          await lookAt(p, 190, 22);
          await run.shot(p, `sky-summer-south-scorpius.png`);
        } else if (season === "autumn") {
          await lookAt(p, 175, 58);
          await run.shot(p, `sky-autumn-south-pegasus.png`);
          await lookAt(p, 0, 45);
          await run.shot(p, `sky-autumn-north-cassiopeia-polaris.png`);
        } else {
          await lookAt(p, 150, 35);
          await run.shot(p, `sky-winter-south-orion.png`);
          await lookAt(p, 5, 40);
          await run.shot(p, `sky-winter-north-polaris-dipper.png`);
        }
        await hud(p, true);
      } finally {
        await p.ctx.close();
      }
    });
  }
}

/** Point the first-person look at the finder's target (as a player would drag it there). */
async function aimAtTarget(p) {
  const f = (await skyOf(p)).finder;
  await lookAt(p, f.targetAz, Math.min(85.5, f.targetAlt));
  return f;
}

async function finderFlow(browser, device, label) {
  await run.step(`finder flow (${label})`, async () => {
    const p = await openPlayer(browser, run, { tag: `finder-${label}`, device, settings: { graphics: device === PHONE ? "low" : "high" } });
    try {
      await joinAt(p, SEASONS.autumn);
      await waitSky(p);
      const cam0 = await p.page.evaluate(() => window.__cvCamera?.().mode);
      run.check("starts in third person", cam0 === "tp", cam0);
      await press(p, p.page.getByRole("button", { name: "별자리 찾기", exact: true }));
      await p.page.locator(".cv-sky-card").waitFor({ state: "visible", timeout: 5000 });
      await sleep(1500);
      let s = await skyOf(p);
      const mode = await p.page.evaluate(() => window.__cvCamera?.().mode);
      run.check("🔭 at night switches to first person", mode === "fp", mode);
      run.check("a target is chosen (autumn, first time: Cassiopeia)", s.finder.targetId === "Cas", s.finder);
      const card = await p.page.locator(".cv-sky-card").innerText();
      run.check("card: count, name, hint, where, how", /가을 발견 0\/6/.test(card) && /카시오페이아자리/.test(card) && /1초 동안 맞춰 보세요/.test(card) && /고도/.test(card), card.slice(0, 300));
      run.check("reticle shows", await p.page.locator(".cv-sky-reticle").isVisible());
      await run.shot(p, `${label}-1-card.png`);

      // looking the other way: the edge arrow
      const f = s.finder;
      await lookAt(p, (f.targetAz + 180) % 360, 20);
      await sleep(400);
      const arrow = await p.page.locator(".cv-sky-arrow").isVisible();
      const arrowText = await p.page.locator(".cv-sky-arrow-text").innerText().catch(() => "");
      run.check("edge arrow when the target is behind", arrow && /뒤쪽/.test(arrowText), arrowText);
      await run.shot(p, `${label}-2-arrow.png`);

      if (device === PHONE) {
        // a one-finger drag on the right of the screen turns the first-person look
        const before = await p.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).viewState.fpYaw);
        const vp = p.page.viewportSize();
        await touchDown(p, vp.width * 0.75, vp.height * 0.55);
        for (let k = 1; k <= 8; k++) await touchMoveTo(p, vp.width * 0.75 - k * 15, vp.height * 0.55 + k * 6);
        await touchUp(p);
        await sleep(300);
        const after = await p.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).viewState.fpYaw);
        run.check("a touch drag looks around in first person", Math.abs(after - before) > 0.05, { before, after });
      }

      // into the reticle: found
      await aimAtTarget(p);
      await p.page.waitForFunction(() => window.__cvSky().finder.foundNow !== null, null, { timeout: 5000 });
      await sleep(1600); // the reveal draws the lines and names
      s = await skyOf(p);
      const found = await p.page.locator(".cv-sky-card").innerText();
      run.check("found: story and the season's count", /찾았어요!/.test(found) && /가을 발견 1\/6/.test(found), found.slice(0, 300));
      run.check("found figure's lines drawn", s.finder.lines.some((l) => l.id === "Cas" && l.brightness === 1), s.finder.lines);
      const names = await p.page.locator(".cv-sky-label:not([hidden])").allInnerTexts();
      run.check("names on the sky (the figure and its stars)", names.some((n) => /카시오페이아/.test(n)) && names.some((n) => /셰다르/.test(n)), names);
      const live = await p.page.locator(".cv-sky-announce").innerText();
      run.check("screen readers hear it", /카시오페이아자리를 찾았어요/.test(live), live);
      const stored = await p.page.evaluate(() => JSON.parse(localStorage.getItem("cv-stars-v1") || "{}"));
      run.check("progress stored on this device", !!stored.found?.Cas, stored);
      await hud(p, true);
      await run.shot(p, `${label}-3-found.png`);

      // next: Polaris (the first-timer's second step)
      await press(p, p.page.getByRole("button", { name: /다음 별자리/ }));
      await sleep(1500);
      s = await skyOf(p);
      run.check("next target: 북극성 찾기", s.finder.targetId === "polaris", s.finder.targetId);
      await aimAtTarget(p);
      await p.page.waitForFunction(() => window.__cvSky().finder.foundNow === "polaris", null, { timeout: 5000 });
      await sleep(2200);
      const pol = await p.page.locator(".cv-sky-card").innerText();
      run.check("Polaris: its height is the village's latitude", /북극성 높이 3[67]\.\d° — 마을의 위도/.test(pol), pol.slice(0, 300));
      await run.shot(p, `${label}-4-polaris.png`);

      // close: back to third person
      await press(p, p.page.locator('.cv-sky-card [aria-label="별자리 찾기 닫기"]'));
      await sleep(800);
      const back = await p.page.evaluate(() => window.__cvCamera?.().mode);
      run.check("closing returns to third person", back === "tp", back);
      run.check("card and reticle gone", !(await p.page.locator(".cv-sky-card").isVisible()) && !(await p.page.locator(".cv-sky-reticle").isVisible()));
    } finally {
      await p.ctx.close();
    }
  });
}

async function dayCheck(browser) {
  await run.step("day: no stars, the finder says night only", async () => {
    const p = await openPlayer(browser, run, { tag: "day", device: DESKTOP, settings: { graphics: "high" } });
    try {
      await joinAt(p, "2026-11-10T14:00");
      await sleep(3000);
      const s = await skyOf(p);
      run.check("no star layer by day (and no download)", !s.visible && !s.loaded, { visible: s.visible, loaded: s.loaded, fade: s.fade });
      const randomStars = await p.page.evaluate(() => window.__cvVillage?.().stars?.visible ?? null);
      run.check("the random stars are off too", randomStars === false, randomStars);
      await press(p, p.page.getByRole("button", { name: "별자리 찾기", exact: true }));
      await p.page.locator(".cv-sky-card").waitFor({ state: "visible", timeout: 5000 });
      await sleep(1500);
      const card = await p.page.locator(".cv-sky-card").innerText();
      run.check("day card: 별은 밤에 보여요 + tonight's time", /별은 밤에 보여요/.test(card) && /오늘 오후 5시 5\d분쯤부터 밝은 별이/.test(card), card);
      const mode = await p.page.evaluate(() => window.__cvCamera?.().mode);
      run.check("by day the view stays third person", mode === "tp", mode);
      await run.shot(p, "day-card.png");
      await press(p, p.page.getByRole("button", { name: /별자리 도감/ }).last());
      await sleep(600);
      const album = await p.page.locator(".cv-sky-card").innerText();
      run.check("album opens by day", /봄/.test(album) && /겨울/.test(album) && /북쪽 하늘/.test(album), album.slice(0, 200));
      await run.shot(p, "day-album.png");
    } finally {
      await p.ctx.close();
    }
  });
}

async function tiers(browser) {
  for (const tier of ["high", "low"]) {
    await run.step(`tier ${tier}: winter Orion`, async () => {
      const p = await openPlayer(browser, run, { tag: `tier-${tier}`, device: DESKTOP, settings: { graphics: tier } });
      try {
        await joinAt(p, SEASONS.winter);
        await waitSky(p);
        const s = await skyOf(p);
        run.check(`${tier}: drawn ${tier === "low" ? "1,441 (V ≤ 5.0)" : "2,549"} + 4 planets`, s.drawn === (tier === "low" ? 1445 : 2553), s.drawn);
        await hud(p, false);
        await lookAt(p, 150, 35);
        await run.shot(p, `tier-${tier}-winter-orion.png`);
        const fps = await p.page.evaluate(async () => {
          let n = 0;
          const t0 = performance.now();
          await new Promise((r) => {
            const f = () => (++n < 120 ? requestAnimationFrame(f) : r());
            requestAnimationFrame(f);
          });
          return (n * 1000) / (performance.now() - t0);
        });
        run.check(`${tier}: frame rate measured`, fps > 0, { fps: Math.round(fps) });
      } finally {
        await p.ctx.close();
      }
    });
  }
}

const browser = await launch();
try {
  if (ONLY.includes("sky")) await skyScenes(browser);
  if (ONLY.includes("pc")) await finderFlow(browser, DESKTOP, "pc");
  if (ONLY.includes("phone")) await finderFlow(browser, PHONE, "phone");
  if (ONLY.includes("day")) await dayCheck(browser);
  if (ONLY.includes("tiers")) await tiers(browser);
} finally {
  await browser.close();
}
process.exit(run.finish());
