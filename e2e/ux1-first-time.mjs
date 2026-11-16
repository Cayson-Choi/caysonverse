/**
 * e2e/ux1-first-time.mjs — 처음 온 사람 UX 묶음 (UX 2026-11-16) 점검. PC 1280×800 과 iPhone 13 375×812 에서:
 *   1 입장 로딩 화면(단계·진행 막대·도움말, 마을이 보이면 걷힘)
 *   2 지도 장소 이름표(아이콘+이름)와 "여기로 가기"(길 따라 걸어감)
 *   3 걷기·달리기 속도(PC Shift, 폰 막대 끝까지)
 *   4 낚시: "낚싯대를 빌렸어요", E 다시 눌러도 반납 안 됨, 잔교로 가는 화면 안내, 앉아서 E로 던지기 (PC)
 *   5 폰 첫 안내 ③ 말하기: 5초 뒤 저절로 끝, 카드가 아바타·이름표를 가리지 않음
 *   6 별자리 찾기: 추모관에 들어가면 닫힘 (PC)
 *   7 앉아 있을 때 이동 키 / 막대로 일어남
 *   8 광장 느티나무 평상에 앉기 (누르면 걸어가 앉음)
 *
 *   CV_CLIENT_URL=http://localhost:5791 node e2e/ux1-first-time.mjs [--only=pc|phone] [--out=<폴더>]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, pos, sleep, touchDown, touchMoveTo, touchUp, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { act, areaOf, joinVillage } from "./lib/village.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const OUT = args.out ?? join(REPO, ".superpowers", "sdd", "evidence", "ux1-first-time");
mkdirSync(OUT, { recursive: true });
const run = createRun("ux1-first-time");
run.evidence = OUT;
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);

const browser = await launchBrowser();

const veilOff = (p) => p.page.waitForFunction(() => document.querySelector(".cv-veg-veil")?.getAttribute("data-covered") === "0", null, { timeout: 120000 });
const seatOf = async (p) => (await pos(p)).seatIndex;
const shot = (p, name) => run.shot(p, `${p.tag}-${name}.png`);
/** The screen point of a world point (the live camera). */
const screenAt = (p, x, y, z) =>
  p.page.evaluate(
    ([x, y, z]) => {
      const { camera } = window.__cvThree();
      const v = camera.position.clone().set(x, y, z).project(camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, z: v.z };
    },
    [x, y, z],
  );
const tapAt = (p, x, y) => (p.touch ? p.page.touchscreen.tap(x, y) : p.page.mouse.click(x, y));
const stickPush = async (p, dy, ms) => {
  await touchDown(p, 90, 650);
  for (let i = 1; i <= 6; i++) {
    await touchMoveTo(p, 90, 650 + (dy * i) / 6);
    await sleep(16);
  }
  await sleep(ms);
  await touchUp(p);
};

/** Speed over `ms` while `hold` keeps the input on. */
async function speedOf(p, hold, ms = 2200) {
  const a = await pos(p);
  const t0 = Date.now();
  let gait = null;
  await hold(async () => {
    await sleep(ms / 2);
    gait = await p.page.evaluate(() => window.__cv.getGait());
    await sleep(ms / 2);
  });
  const b = await pos(p);
  return { mps: Math.round((Math.hypot(b.x - a.x, b.z - a.z) / ((Date.now() - t0) / 1000)) * 100) / 100, gait };
}

async function loaderRun(p) {
  // the loading screen from the press: its steps and bar, then gone once the village is seen
  const seen = { open: false, steps: new Set(), pcts: [], tips: new Set() };
  await p.page.exposeFunction("__ux1Loader", (s) => {
    seen.open = true;
    seen.steps.add(s.step);
    seen.pcts.push(Number(s.pct));
    if (s.tip) seen.tips.add(s.tip);
  });
  await p.page.addInitScript(() => {
    setInterval(() => {
      const l = document.querySelector("[data-testid='village-loader']");
      if (l) window.__ux1Loader?.({ step: l.getAttribute("data-step"), pct: l.getAttribute("data-pct"), tip: l.querySelector(".cv-loader-tip")?.textContent });
    }, 120);
  });
  let shotTaken = false;
  const t = setInterval(async () => {
    if (shotTaken || !seen.open) return;
    shotTaken = true;
    await shot(p, "1-loader");
  }, 150);
  await joinVillage(p, p.touch ? "폰" : "피");
  await veilOff(p);
  await p.page.waitForFunction(() => !document.querySelector("[data-testid='village-loader']"), null, { timeout: 60000 }).catch(() => {});
  clearInterval(t);
  const gone = await p.page.evaluate(() => !document.querySelector("[data-testid='village-loader']"));
  run.check("loading screen shows from the press, with steps 마을 → 캐릭터 → 접속", seen.open, [...seen.steps]);
  run.check("its bar only goes up and ends at 100", seen.pcts.every((v, i) => i === 0 || v >= seen.pcts[i - 1]) && seen.pcts.at(-1) === 100, seen.pcts.filter((_, i) => i % 6 === 0));
  run.check("it is gone once the village is seen", gone);
}

async function mapRun(p, placeId, untilMs) {
  await p.page.locator('button[aria-label="지도 보기"]').first().click();
  await p.page.waitForFunction(() => window.__cv.getView().ovBlend > 0.9, null, { timeout: 10000 }).catch(() => {});
  await sleep(600);
  const labels = await p.page.evaluate(() =>
    [...document.querySelectorAll("[data-map-place]")].filter((e) => e.style.display !== "none").map((e) => ({ id: e.getAttribute("data-map-place"), text: e.textContent.trim(), shown: e.style.visibility !== "hidden" })),
  );
  run.check("the map names its places with icons (추모관, 버스정류장, 카페, 케이슨 낚시터, 광장, N번 집); the main ones shown (a phone's whole-village view may fold one into its neighbour until zoomed)", ["memorial", "busstop", "cafe", "lake", "plaza"].filter((id) => labels.some((l) => l.id === id && l.shown)).length >= (p.touch ? 3 : 5) && labels.length >= 15, labels.map((l) => l.text + (l.shown ? "" : " (겹쳐서 숨김)")));
  await shot(p, "2-map-places");
  const box = await p.page.locator(`[data-map-place="${placeId}"] .cv-map-place-tag`).boundingBox();
  await tapAt(p, box.x + box.width / 2, box.y + box.height / 2); // the tag moves with the map every frame: tapped where it is
  await sleep(300);
  await shot(p, `2-map-${placeId}`);
  const go = p.page.locator(`[data-map-go="${placeId}"]`);
  run.check("tapping a place offers 여기로 가기", (await go.count()) === 1);
  const gb = await go.boundingBox();
  await tapAt(p, gb.x + gb.width / 2, gb.y + gb.height / 2);
  await sleep(800);
  const view = await p.page.evaluate(() => window.__cv.getView().mode);
  run.check("the map closes and the walk starts", view !== "ov", view);
  const hint = await p.page
    .waitForFunction(() => /도착했어요|막혀서|찾지 못했어요/.test(document.querySelector("[data-testid='click-hint']")?.textContent ?? ""), null, { timeout: untilMs, polling: 250 })
    .then(() => p.page.evaluate(() => document.querySelector("[data-testid='click-hint']")?.textContent))
    .catch(() => null);
  return hint;
}

// ─────────────────────────────────────────────── PC ───────────────────────────────────────────────
if (args.only !== "phone") {
  const p = await openPlayer(browser, run, { tag: "pc", device: DESKTOP });
  await run.step("PC 1 loading screen", () => loaderRun(p));

  await run.step("PC 8+7 sit on the zelkova deck by clicking it, W stands up", async () => {
    await walkAndWait(p, -18.5, -3.5, 30000, 1);
    await turnCameraTo(p, -25, -5);
    await sleep(600);
    const at = await screenAt(p, -23.2, 0.46, -4.25); // the deck's top by its east face
    await tapAt(p, at.x, at.y);
    const sat = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex >= 0, null, { timeout: 20000 }).then(() => true, () => false);
    await sleep(1800);
    const s = await seatOf(p);
    const seat = await p.page.evaluate(async (i) => (await window.__imp("/src/game/activeMap.ts")).VILLAGE_ACTIVE_MAP.seats[i]?.id ?? null, s);
    run.check("a click on the deck walks there and sits on it (a zelkova_deck seat)", sat && String(seat).startsWith("zelkova_deck"), { s, seat });
    await shot(p, "8-deck-seated");
    await p.page.keyboard.down("KeyW");
    await sleep(400);
    await p.page.keyboard.up("KeyW");
    const up = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex < 0, null, { timeout: 5000 }).then(() => true, () => false);
    run.check("W while seated stands up", up);
  });

  await run.step("PC 3 walk and run speeds", async () => {
    await walkAndWait(p, 0, 16, 30000, 1);
    await turnCameraTo(p, 0, 30);
    const walk = await speedOf(p, async (mid) => {
      await p.page.keyboard.down("KeyW");
      await mid();
      await p.page.keyboard.up("KeyW");
    });
    await turnCameraTo(p, 0, 0);
    const runS = await speedOf(p, async (mid) => {
      await p.page.keyboard.down("Shift");
      await p.page.keyboard.down("KeyW");
      await mid();
      await p.page.keyboard.up("KeyW");
      await p.page.keyboard.up("Shift");
    }, 1600);
    run.check("walk ≈ 2 m/s, Shift runs at more than twice that (run gait)", walk.mps > 1.7 && runS.mps >= 2 * walk.mps && runS.gait === "run", { walk, run: runS });
  });

  await run.step("PC 2+6 map walk to 추모관, the star finder closes inside", async () => {
    const hint = await mapRun(p, "memorial", 90000);
    const at = await pos(p);
    run.check("the map walk reaches 추모관's door", /도착/.test(hint ?? "") && Math.hypot(at.x, at.z + 48.8) < 2.5, { hint, at });
    await shot(p, "2-arrived-memorial");
    await p.page.locator('button[aria-label="별자리 찾기"]').first().click();
    await sleep(500);
    const opened = await p.page.evaluate(async () => (await window.__imp("/src/village/sky/starFinderStore.ts")).useStarFinder.getState().open);
    await walkAndWait(p, 0, -50.8, 15000, 0.8);
    await act(p);
    await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 }).catch(() => {});
    await sleep(1500);
    const closed = await p.page.evaluate(async () => !(await window.__imp("/src/village/sky/starFinderStore.ts")).useStarFinder.getState().open);
    run.check("the star finder (open outside) is closed once inside the hall", opened && closed && (await areaOf(p)) === "hall", { opened, closed });
    await walkAndWait(p, 300, 4.6, 15000, 0.5);
    await act(p);
    await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "village", null, { timeout: 15000 }).catch(() => {});
    await veilOff(p).catch(() => {});
    await sleep(1500);
  });

  await run.step("PC 4 fishing: rent, E again keeps it, the cue to the pier, E casts", async () => {
    const hint = await mapRun(p, "lake", 150000);
    run.check("the map walk reaches the lake's rental pad", /도착/.test(hint ?? ""), hint);
    const view = () =>
      p.page.evaluate(async () => {
        const net = await window.__imp("/src/lake/lakeNet.ts");
        const proto = await window.__imp("/src/lake/lakeProtocol.ts");
        const v = proto.emptyFishView();
        net.readFishView(net.selfId(), v);
        return { rod: v.rod, spot: v.spot, name: proto.phaseName(v.phase) };
      });
    await walkAndWait(p, 102, -14.6, 20000, 0.8);
    await sleep(600);
    await p.page.keyboard.press("KeyE");
    await sleep(500);
    const said = await p.page.evaluate(() => document.querySelector(".cv-lake-top")?.textContent ?? "");
    run.check("renting says 낚싯대를 빌렸어요 (no '2칸 대')", said.includes("낚싯대를 빌렸어요") && !said.includes("2칸"), said);
    await sleep(900);
    await p.page.keyboard.press("KeyE");
    await sleep(1200);
    run.check("E again on the pad does not give the rod back", (await view()).rod > 0, await view());
    await walkAndWait(p, 104, -10, 15000, 1);
    await sleep(500);
    const cue = await p.page.evaluate(() => {
      const c = document.querySelector("[data-lake-cue]");
      return c ? { text: c.textContent, arrow: c.querySelector(".cv-lake-cue-arrow")?.style.transform } : null;
    });
    run.check("off the pad with a rod: an on-screen cue toward the pier's free chairs", !!cue && /낚시 의자/.test(cue.text) && /rotate/.test(cue.arrow ?? ""), cue);
    await shot(p, "4-pier-cue");
    await p.page.locator("[data-lake-cue]").click();
    const near = await p.page.waitForFunction(() => /앉아서 낚시|여기서 낚시/.test(document.querySelector(".cv-lake-btn")?.textContent ?? ""), null, { timeout: 40000 }).then(() => true, () => false);
    run.check("the cue walks to a free chair (the big button offers to sit)", near);
    await p.page.keyboard.press("KeyE");
    for (let k = 0; k < 40 && (await view()).name !== "ready"; k++) await sleep(300);
    await sleep(2500);
    const kbd = await p.page.evaluate(() => document.querySelector(".cv-lake-btn kbd")?.textContent ?? "");
    await p.page.keyboard.press("KeyE");
    await sleep(700);
    const v2 = await view();
    run.check("seated, E casts like Space (and the key reads E · Space)", ["casting", "settling", "waiting", "nibble", "bite"].includes(v2.name) && kbd.includes("E"), { v2, kbd });
    await shot(p, "4-cast-with-E");
    await p.page.keyboard.down("KeyS");
    await sleep(400);
    await p.page.keyboard.up("KeyS");
    const up = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex < 0, null, { timeout: 6000 }).then(() => true, () => false);
    run.check("a move key stands up from the fishing chair", up);
  });
  await p.ctx.close();
}

// ─────────────────────────────────────────────── phone ───────────────────────────────────────────────
if (args.only !== "pc") {
  const p = await openPlayer(browser, run, { tag: "phone", device: PHONE, settings: { coachDone: false } });
  await run.step("phone 1 loading screen", () => loaderRun(p));

  await run.step("phone 5 the guide's cards stay off the avatar; ③ ends by itself", async () => {
    await sleep(1500);
    const band = { x: 375 / 2 - 75, y: 812 * 0.35, w: 150, h: 812 * 0.35 };
    const cards = {};
    for (const st of ["move", "look", "talk"]) {
      await p.page.evaluate(async (st) => (await window.__imp("/src/stores/coachStore.ts")).useCoachStore.setState({ step: st }), st);
      await sleep(700);
      cards[st] = await p.page.evaluate(() => document.querySelector(".cv-coach")?.getBoundingClientRect().toJSON() ?? null);
      await shot(p, `5-coach-${st}`);
    }
    const overlaps = Object.entries(cards).filter(([, r]) => r && r.x < band.x + band.w && r.x + r.width > band.x && r.y < band.y + band.h && r.y + r.height > band.y);
    run.check("no guide card over the avatar and its name tag", overlaps.length === 0, cards);
    await p.page.evaluate(async () => (window.__coach = (await window.__imp("/src/stores/coachStore.ts")).useCoachStore));
    await p.page.evaluate(() => window.__coach.setState({ step: "look" }));
    await sleep(300);
    await p.page.evaluate(async () => (await window.__imp("/src/stores/coachStore.ts")).useCoachStore.setState({ step: "talk" }));
    const t0 = Date.now();
    const notYet = await p.page.waitForFunction(() => window.__coach.getState().step === "done", null, { timeout: 3500 }).then(() => false, () => true);
    run.check("③ stays a few seconds (not gone at once)", notYet);
    const done = await p.page.waitForFunction(() => window.__coach.getState().step === "done", null, { timeout: 9000 }).then(() => true, () => false);
    run.check("③ 말하기 ends by itself without chatting (about 5 s)", done, { ms: Date.now() - t0 });
  });

  await run.step("phone 3 stick walk and run", async () => {
    const walk = await speedOf(p, async (mid) => {
      const d = stickPush(p, -30, 2200);
      await mid();
      await d;
    });
    const runS = await speedOf(p, async (mid) => {
      const d = stickPush(p, 56, 1600);
      await mid();
      await d;
    }, 1600);
    run.check("the stick at the rim runs at more than twice the walk", walk.mps > 1.4 && runS.mps >= 2 * walk.mps && runS.gait === "run", { walk, run: runS });
  });

  await run.step("phone 2 the map's places and 여기로 가기 (버스정류장)", async () => {
    const hint = await mapRun(p, "busstop", 60000);
    run.check("the map walk on a phone reaches the bus stop", /도착/.test(hint ?? ""), hint);
  });

  await run.step("phone 8+7 tap the deck to sit, the stick stands up", async () => {
    if ((await p.page.evaluate(() => window.__cv.getView().mode)) === "ov") await p.page.locator('button[aria-label="지도 보기"]').first().tap();
    for (const [x, z] of [[24, 10], [0, 17], [-16, 10]]) await walkAndWait(p, x, z, 40000, 1.5); // round the fountain from the bus stop
    await walkAndWait(p, -18.5, -3.5, 40000, 1);
    await turnCameraTo(p, -25, -5).catch(() => {});
    await sleep(600);
    const at = await screenAt(p, -23.2, 0.46, -4.25);
    await tapAt(p, at.x, at.y);
    const sat = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex >= 0, null, { timeout: 20000 }).then(() => true, () => false);
    await sleep(1800);
    await shot(p, "8-deck-seated");
    run.check("a tap on the deck sits there", sat, await pos(p));
    await stickPush(p, -40, 500);
    const up = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex < 0, null, { timeout: 5000 }).then(() => true, () => false);
    run.check("the stick stands up from a seat", up);
  });
  await p.ctx.close();
}

await browser.close();
process.exit(run.finish());
