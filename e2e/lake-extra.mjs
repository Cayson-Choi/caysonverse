/**
 * e2e/lake-extra.mjs - the rest of chunk E's sweep (design 12.5, 12.9, 12.11): the lake as another player sees it, the download that
 * fails (and the village that stays whole), the overview map over the wider walk area, and the frames with 30 anglers.
 *
 *   CV_CLIENT_URL=http://localhost:5571 node e2e/lake-extra.mjs --out=<folder> [--device=pc|phone]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, REPO, createRun, entryReady, launchBrowser, openPlayer, pos, press, sleep, walkAndWait } from "./lib/common.mjs";
import { installMock } from "./lib/lakeMock.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, ".superpowers", "sdd", "evidence", "lake-extra"));
const dev = opt("device", "pc");
const device = dev === "phone" ? PHONE : DESKTOP;
const run = createRun("lake-extra-" + dev);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);
const browser = await launchBrowser();

let nick = 0;
async function enter(p, query = "") {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}${query}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`엑${++nick}${Math.floor(Math.random() * 90 + 10)}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 });
  await sleep(1500);
}
const toLake = async (p) => {
  for (const [x, z] of [[40, 0], [80, -9], [100, -12], [118, -12]]) await walkAndWait(p, x, z, 40000, 2);
};

// ── 12.9: the lake file that cannot be had ──────────────────────────────────────────
await run.step("a lake file that fails to download: the village stays whole, a notice, the stand-in lake", async () => {
  const p = await openPlayer(browser, run, { tag: "F", device });
  const end = run.allow("the missing lake.glb (forced with ?lake=glb)", /lake\.glb|404|Failed to load resource|\[lake\]|Could not load|Unexpected token|THREE\.GLTFLoader|fetch/i);
  const times = {};
  p.page.on("response", (r) => {
    const u = r.url();
    if (/village\.glb/.test(u) && !times.village) times.village = Date.now();
    if (/lake\.glb/.test(u) && !times.lake) times.lake = Date.now();
  });
  await enter(p, "&lake=glb");
  await sleep(9000);
  await toLake(p);
  await sleep(3000);
  const patch = await p.page.evaluate(() => window.__cvLakePatch?.() ?? null);
  run.check("the stand-in lake (boxes) is drawn after the failure, the old lake taken out", !!patch && patch.trianglesRemoved > 0, patch);
  const notice = await p.page.evaluate(async () => {
    const m = await window.__imp("/src/stores/chatStore.ts");
    return JSON.stringify(m.useChatStore.getState()).includes("낚시터를 불러오지 못했어요");
  });
  run.check("the chat says the lake could not be loaded", notice);
  run.check("the lake was asked for after the village (design 10: the village first)", !times.lake || (times.village && times.lake >= times.village), times);
  await run.shot(p, `${dev}-20-load-failed.png`);
  end();
  // React reports the boundary's caught error (dev mode) as a page error too: expected here, and only here
  const mine = run.errors.filter((e) => /lake\.glb/.test(e));
  run.check("the failed download shows up only as that one expected error", mine.length >= 1, mine.length);
  for (const e of mine) run.errors.splice(run.errors.indexOf(e), 1);
  await p.ctx.close();
});

// ── 12.5: another player's lake ─────────────────────────────────────────────────────
await run.step("another player sees the rod, the float and the line, and loses them when the angler goes", async () => {
  const A = await openPlayer(browser, run, { tag: "A", device });
  const B = await openPlayer(browser, run, { tag: "B", device });
  await enter(A);
  await enter(B);
  await toLake(A);
  await toLake(B);
  await installMock(A);
  const sidA = await A.page.evaluate(() => window.__cv.getSessionId());
  // A fishes by the mock; B's screen is given A's fields the way the schema would (the same fields, the same room clock)
  const mirror = async (patch) => {
    await A.page.evaluate((x) => window.__cvLake.setView(window.__cv.getSessionId(), x), patch);
    await B.page.evaluate(([sid, x]) => window.__cvLake.setView(sid, x), [sidA, patch]);
  };
  const clock = () => B.page.evaluate(() => window.__cvLake.clock());
  const rodOnly = { rod: 1, spot: -1, phase: 1, seq: 0, sig: 0, kind: 0, cm: 0, at: await clock() };
  await mirror(rodOnly);
  await sleep(1500);
  await run.shot(B, `${dev}-21-remote-rod.png`);
  await mirror({ spot: 6, phase: 5, seq: 4, at: await clock() });
  await sleep(1500);
  await run.shot(B, `${dev}-22-remote-float.png`);
  const stats = await B.page.evaluate(() => window.__cvLakeStats?.() ?? null);
  run.check("B draws A's float and line", !!stats && stats.floats === 1, stats);
  await mirror({ phase: 7, sig: 1, at: await clock() });
  await sleep(900);
  await run.shot(B, `${dev}-23-remote-bite.png`);
  await B.page.evaluate((sid) => window.__cvLake.setView(sid, null), sidA);
  await sleep(800);
  const gone = await B.page.evaluate(() => window.__cvLakeStats?.() ?? null);
  run.check("when A is gone B's float is gone too", !!gone && gone.floats === 0, gone);
  await A.ctx.close();
  await B.ctx.close();
});

// ── 12.1 / minimap: the overview over the wider walk area ───────────────────────────
await run.step("the overview map covers the lake's walk area (x up to 186)", async () => {
  const p = await openPlayer(browser, run, { tag: "M", device });
  await enter(p);
  await toLake(p);
  const info = await p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/activeMap.ts");
    const b = m.activeBounds();
    return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
  });
  run.check("the active bounds reach x 186", info.maxX >= 186 && info.minX <= -95, info);
  await p.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).toggleOverview());
  await sleep(2500);
  const ov = await p.page.evaluate(() => ({ mode: window.__cv.getView().mode, h: window.__cv.getView().ovHeight, cx: window.__cv.getView().ovCenterX }));
  run.check("the overview is on", ov.mode === "ov", ov);
  await run.shot(p, `${dev}-24-overview.png`);
  await p.ctx.close();
});

// ── 12.9: frames with 30 anglers ─────────────────────────────────────────────────────
await run.step("frames: 30 anglers (30 floats, 30 lines) against the lake alone", async () => {
  const p = await openPlayer(browser, run, { tag: "P", device });
  await enter(p);
  await toLake(p);
  const cdp = await p.ctx.newCDPSession(p.page);
  if (dev === "phone") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const measure = async () => {
    await sleep(1500);
    const stats = await p.page.evaluate(() => window.__cv.getFrameStats(6000));
    return stats;
  };
  await sleep(2000);
  const alone = await measure();
  await p.page.evaluate(async () => {
    const clock = window.__cvLake.clock();
    for (let i = 0; i < 30; i++) window.__cvLake.setView("bot" + i, { rod: 1, spot: i, phase: 5, seq: i + 1, sig: 0, kind: 0, cm: 0, at: clock });
  });
  const crowd = await measure();
  await run.shot(p, `${dev}-25-30-anglers.png`);
  const st = await p.page.evaluate(() => window.__cvLakeStats?.() ?? null);
  run.check("30 floats are drawn", !!st && st.floats === 30, st);
  console.log("frames alone", JSON.stringify(alone), "with 30", JSON.stringify(crowd));
  run.check("frame stats readable", !!alone?.meanMs && !!crowd?.meanMs, { alone, crowd });
  run.check("30 anglers cost no more than 30 % (and 2 ms) of a frame", crowd.meanMs <= alone.meanMs * 1.3 + 2, { aloneMs: Math.round(alone.meanMs * 10) / 10, crowdMs: Math.round(crowd.meanMs * 10) / 10, p95: [alone.p95Ms, crowd.p95Ms] });
  await p.ctx.close();
});

const code = run.finish();
await browser.close();
process.exit(code);
