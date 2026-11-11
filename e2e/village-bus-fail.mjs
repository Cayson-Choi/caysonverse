/**
 * e2e/village-bus-fail.mjs — 마을버스 파일이 늦거나 멈추거나 없어도 마을은 기다리지 않음 (버스 검토 r3, M2).
 *
 * 버스(village_bus.glb)는 마을 안의 자기 Suspense와 자기 오류 경계, 자기 로딩 매니저로 읽는다(VillageScene.tsx,
 * villageBusLoader.ts). 세 경우를 브라우저 문맥 하나씩으로 확인한다(PC, 화려하게):
 *   - hang: 버스 요청에 영원히 답하지 않음(page.route가 이행하지 않음) -> 마을이 다 그려지고, "불러오는 중…" 가림막이
 *     걷히고, 버스는 없음
 *   - 404: 버스 파일이 없음 -> 마을이 다 그려지고, 채팅 안내 한 번, 정해진 횟수만 다시 받고, 버스는 없음, 가림막 없음
 *   - late: 마을이 그려질 때까지 버스 응답을 붙잡았다가 보냄 -> 마을이 먼저 서고, 버스가 뒤에 나타남
 *
 *   npm run dev   (다른 창에서; 또는 CV_CLIENT_URL=http://localhost:<포트>)
 *   node e2e/village-bus-fail.mjs [--only=hang,404,late] [--out=<폴더>]
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/escape.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (n, fallback) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${fallback}`).slice(n.length + 3);
const only = opt("only", "hang,404,late").split(",");
const run = createRun("village-bus-fail");
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
// ANGLE's D3D shader compiler warns about the bloom pass's loop (known, not the bus's; e2e/village-desktop.mjs logs it too)
run.allow("D3D X3595 (bloom shader, known)", /warning X3595: gradient instruction used in a loop/);

/** The retries LoadBoundary makes after the first failure (client/src/village/loadRetry.ts LOAD_RETRY_LIMIT). */
const RETRIES = 3;
const BUS = /\/models\/village\/village_bus\.glb(\?|$)/;
const NOTICE = "마을버스를 불러오지 못했어요";

const state = (p) =>
  p.page.evaluate(() => {
    const v = window.__cvVillage?.();
    let inScene = false;
    for (let o = v?.root; o; o = o.parent) if (o.isScene) inScene = true;
    return {
      village: !!v,
      villageInScene: inScene,
      bus: !!window.__cvBus,
      loadingOverlay: !!document.querySelector(".cv-loading"),
      frame: window.__cvThree?.().gl.info.render.frame ?? null,
    };
  });
const noticeCount = (p) => p.page.evaluate((t) => [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && (e.textContent ?? "").includes(t)).length, NOTICE);

/** One browser context: the bus's requests answered by `handle` (counted), the village joined. */
async function withBus(browser, tag, handle) {
  const p = await openPlayer(browser, run, { tag, device: DESKTOP, settings: { graphics: "high" } });
  p.busRequests = 0;
  await p.ctx.route(BUS, (route) => {
    p.busRequests += 1;
    return handle(route, p.busRequests);
  });
  return p;
}

/** The village is drawn and the loading overlay has gone (within the times a normal visit takes). */
async function villageUp(p) {
  const t0 = Date.now();
  const drawn = await p.page.waitForFunction(() => !!window.__cvVillage, null, { timeout: 90000 }).then(() => true, () => false);
  const tDrawn = (Date.now() - t0) / 1000;
  const clear = await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 30000 }).then(() => true, () => false);
  return { drawn, clear, tDrawn: Math.round(tDrawn * 10) / 10 };
}

const browser = await launchBrowser();
try {
  if (only.includes("hang")) {
    await run.step("hang: the bus request is never answered", async () => {
      const p = await withBus(browser, "hang", () => new Promise(() => {})); // never fulfilled, aborted or continued
      await joinVillage(p, "멈춤");
      const up = await villageUp(p);
      run.check("the village model is drawn", up.drawn, up);
      run.check("the loading overlay has gone (the bus is not in the default loading manager)", up.clear, up);
      const f0 = (await state(p)).frame ?? 0;
      await sleep(8000);
      const s = await state(p);
      run.check("8 s later: the village is in the scene and frames keep being drawn", s.village && s.villageInScene && (s.frame ?? 0) > f0 + 30, { ...s, f0 });
      run.check("no bus, no overlay", !s.bus && !s.loadingOverlay, s);
      run.check("the bus was requested (once, still pending)", p.busRequests === 1, p.busRequests);
      run.check("no chat notice (a stalled bus is no bus, not a failure)", (await noticeCount(p)) === 0);
      await run.shot(p, "bus-hang.png");
      await p.ctx.close();
    });
  }

  if (only.includes("404")) {
    await run.step("404: the bus file is missing", async () => {
      const stopAllow = run.allow("bus 404", /^Failed to load resource: the server responded with a status of 404\b/);
      const p = await withBus(browser, "404", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }));
      await joinVillage(p, "없음");
      const up = await villageUp(p);
      run.check("the village model is drawn", up.drawn, up);
      run.check("the loading overlay has gone", up.clear, up);
      // the first try, then RETRIES more after 4, 8 and 16 s (loadRetry.ts)
      const t0 = Date.now();
      while (p.busRequests < 1 + RETRIES && Date.now() - t0 < 45000) await sleep(500);
      const all = p.busRequests;
      await sleep(3000); // and no more after the last
      const s = await state(p);
      run.check(`the bus was tried ${1 + RETRIES} times, then given up`, all === 1 + RETRIES && p.busRequests === 1 + RETRIES, p.busRequests);
      run.check("the village is still in the scene; no bus, no overlay", s.village && s.villageInScene && !s.bus && !s.loadingOverlay, s);
      const n = await noticeCount(p);
      run.check("the chat says so once", n === 1, n);
      // R3F reports an error its boundary caught through window.reportError (a page error): one per failed try, expected here
      const caught = run.errors.filter((e) => e.startsWith("[404] pageerror: Could not load /models/village/village_bus.glb"));
      for (const e of caught) run.errors.splice(run.errors.indexOf(e), 1);
      run.check(`the failed loads were reported as caught errors, one per try (${1 + RETRIES})`, caught.length === 1 + RETRIES, caught.length);
      await run.shot(p, "bus-404.png");
      await p.ctx.close();
      stopAllow();
    });
  }

  if (only.includes("late")) {
    await run.step("late: the bus answers only after the village is drawn", async () => {
      let release;
      const gate = new Promise((r) => (release = r));
      const p = await withBus(browser, "late", async (route) => {
        await gate;
        await route.continue();
      });
      await joinVillage(p, "늦음");
      const up = await villageUp(p);
      const before = await state(p);
      run.check("the village is drawn while the bus is held back", up.drawn && before.village && !before.bus, { up, before });
      run.check("the loading overlay has gone while the bus is held back", up.clear && !before.loadingOverlay, before);
      release();
      const came = await p.page.waitForFunction(() => !!window.__cvBus, null, { timeout: 30000 }).then(() => true, () => false);
      await sleep(1500);
      const after = await state(p);
      run.check("once answered, the bus appears beside the village", came && after.bus && after.village && after.villageInScene, after);
      run.check("the bus was requested once", p.busRequests === 1, p.busRequests);
      await run.shot(p, "bus-late.png");
      await p.ctx.close();
    });
  }
} finally {
  await browser.close();
}
process.exit(run.finish({ only }));
