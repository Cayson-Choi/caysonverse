/**
 * e2e/guide-pages.mjs — 마을 안내원 주제 페이지 (2026-11-20, owner "이대로 만들어"), on a PC and on a phone in portrait:
 *  - 문의하기 opens the topic cards (9), every card opens its page (title, summary, numbered steps with icons, Q&As), a question
 *    opens its answer, a long page scrolls, the head and the buttons stay on screen, nothing is cut off or selectable;
 *  - "지도에서 보기" opens the map framed on the place with its card open (추모관, 케이슨랜드);
 *  - "같이 가요" walks the avatar to the fountain, the memorial hall's door and 케이슨랜드's gate;
 *  - 뒤로 returns to the cards, 닫기 (and Esc on a PC) closes.
 * Every page is screenshotted (top and scrolled to the bottom).
 *
 *   server: PORT=2969 npx tsx src/index.ts   (server/)
 *   client: VITE_SERVER_URL=http://localhost:2969 npx vite --port 5969 --strictPort   (client/)
 *   CV_CLIENT_URL=http://localhost:5969 node e2e/guide-pages.mjs [--device=pc|phone|both] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, press, pos, sleep, waitIdle } from "./lib/common.mjs";
import { act, guideAnswer, guideCard, joinVillage, layoutOf, question, standAtPlazaGuide } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const run = createRun("guide-pages");
run.evidence = opt("out", "D:\\ClaudeCode\\tmpshots\\guide");
mkdirSync(run.evidence, { recursive: true });
const which = opt("device", "both");
/** --only=go: only the 같이 가요 step (a quicker re-run while fixing it). */
const only = opt("only", "");
const want = (k) => !only || only.split(",").includes(k);

const page = (p) => p.page.evaluate(() => document.querySelector(".cv-guide")?.getAttribute("data-guide-page") ?? null);
const waitPage = (p, id) => p.page.waitForFunction((id) => document.querySelector(".cv-guide")?.getAttribute("data-guide-page") === id, id, { timeout: 4000 });
const dialogGone = (p) => p.page.waitForFunction(() => !document.querySelector(".cv-guide"), null, { timeout: 4000 }).then(() => true, () => false);
const view = (p) =>
  p.page.evaluate(async () => {
    const v = (await window.__imp("/src/game/viewState.ts")).viewState;
    return { mode: v.mode, cx: Math.round(v.ovCenterX * 10) / 10, cz: Math.round(v.ovCenterZ * 10) / 10, h: Math.round(v.ovHeight) };
  });
const exitMap = (p) => p.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).exitOverview());
const walkTarget = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/mapWalk.ts")).mapWalkTarget());

/** How the open dialog sits: the panel, head, body and foot inside the screen; clipped text; selectable text; the body's scroll. */
const fit = (p) =>
  p.page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const r = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) };
    };
    const inside = (b) => !!b && b.l >= 0 && b.t >= 0 && b.r <= vw && b.b <= vh;
    const panel = r(".cv-guide-panel");
    const head = r(".cv-guide-head");
    const foot = r(".cv-guide-foot");
    const body = document.querySelector(".cv-guide-body");
    // text that does not fit its box (a nowrap button, a card title): wider than its box by more than a pixel
    const clipped = [];
    for (const e of document.querySelectorAll(".cv-guide-panel button, .cv-guide-panel .cv-guide-step-text, .cv-guide-panel .cv-guide-title, .cv-guide-card-title, .cv-guide-summary")) {
      if (e.scrollWidth > e.clientWidth + 1) clipped.push((e.textContent ?? "").trim().slice(0, 30));
    }
    // a line cut out at the panel's sides (horizontal scroll inside the body)
    const hScroll = body ? body.scrollWidth > body.clientWidth + 1 : null;
    const selectable = [...document.querySelectorAll(".cv-guide *")].filter((e) => getComputedStyle(e).userSelect !== "none").length;
    return {
      vw,
      vh,
      panel,
      inside: inside(panel) && inside(head) && inside(foot),
      clipped,
      hScroll,
      selectable,
      body: body ? { sh: body.scrollHeight, ch: body.clientHeight, top: Math.round(body.scrollTop) } : null,
      buttons: [...document.querySelectorAll("[data-guide-act]")].map((b) => b.getAttribute("data-guide-act")),
    };
  });
const scrollBody = (p, to) =>
  p.page.evaluate((to) => {
    const b = document.querySelector(".cv-guide-body");
    if (!b) return null;
    b.scrollTop = to === "end" ? b.scrollHeight : 0;
    return Math.round(b.scrollTop);
  }, to);

/** Open the guide's dialog from 1.3 m in front of it (walking there round its collider). */
async function openGuide(p) {
  for (let attempt = 0; ; attempt++) {
    await standAtPlazaGuide(p);
    await act(p);
    const ok = await p.page.locator(".cv-guide").waitFor({ state: "visible", timeout: 6000 }).then(() => true, () => false);
    if (ok) break;
    const at = await pos(p);
    const ts = await p.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => t.label));
    console.log(`   openGuide: no dialog at (${at.x.toFixed(2)}, ${at.z.toFixed(2)}), targets ${JSON.stringify(ts)}`);
    if (attempt >= 1) throw new Error("the guide's dialog did not open");
  }
  await sleep(400);
}

/** A walk to (x, z) planned round what is in the way, as a tap there would be (clickPlan.ts planClickMove), then wait until it ends. */
async function walkPlanned(p, x, z, tol = 1.5) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await p.page.evaluate(
      async ([x, z]) => {
        const plan = (await window.__imp("/src/game/clickPlan.ts")).planClickMove;
        const am = await window.__imp("/src/game/activeMap.ts");
        const { setClickTarget } = await window.__imp("/src/game/clickMove.ts");
        const at = window.__cv.getPos();
        const map = am.getActiveMap();
        const r = plan(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.activeBounds(), false, { furniture: map.furniture });
        if (r.ok) setClickTarget(r.x, r.z, r.y, r.via);
      },
      [x, z],
    );
    await sleep(400);
    await waitIdle(p, 60000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}

/** Walk the player back to the guide from where it is, along the plaza's lanes (each leg planned round what is in the way). */
async function backToGuide(p, waypoints) {
  for (const [x, z, tol] of waypoints) await walkPlanned(p, x, z, tol ?? 1.5);
  await openGuide(p);
}

/** "같이 가요" on a topic: the dialog closes, a walk to `name` starts, and the player arrives within `tol` m of (x, z). */
async function goWith(p, dev, topic, name, x, z, tol, ms, shot) {
  await press(p, guideCard(p, topic));
  await waitPage(p, topic);
  await press(p, p.page.locator('[data-guide-act="go"]'));
  const closed = await dialogGone(p);
  const target = await walkTarget(p);
  run.check(`[${dev}] ${topic}: 같이 가요 closes the dialog and walks to ${name}`, closed && target === name, { closed, target });
  const t0 = Date.now();
  let at = await pos(p);
  while (Date.now() - t0 < ms) {
    at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol && (await walkTarget(p)) === null) break;
    await sleep(400);
  }
  const d = Math.hypot(at.x - x, at.z - z);
  run.check(`[${dev}] ${topic}: arrived at ${name} (within ${tol} m of (${x}, ${z}))`, d <= tol, { at, d: Math.round(d * 100) / 100, s: Math.round((Date.now() - t0) / 100) / 10 });
  await sleep(600);
  const hint = await p.page.evaluate(() => document.body.textContent.includes("도착했어요"));
  run.check(`[${dev}] ${topic}: '…에 도착했어요' shows`, hint, null);
  await run.shot(p, shot);
  return at;
}

async function scenario(browser, dev, device) {
  const phone = device === PHONE;
  const P = await openPlayer(browser, run, { tag: dev, device, settings: { graphics: phone ? "low" : "high" } });
  const topics = await (async () => {
    await joinVillage(P, dev === "pc" ? "안내PC" : "안내폰");
    return P.page.evaluate(async () =>
      (await window.__imp("/src/village/guideTopics.ts")).GUIDE_TOPICS.map((t) => ({ id: t.id, title: t.title, steps: t.steps.length, qas: t.qas.map((q) => ({ id: q.id, question: q.question, answer: q.answer })), go: !!t.go, map: !!t.map })),
    );
  })();

  if (want("pages")) await run.step(`[${dev}] 문의하기 opens the topic cards`, async () => {
    await openGuide(P);
    const cards = await P.page.locator(".cv-guide-card").allTextContents();
    run.check(`[${dev}] 9 cards with the approved titles, in order`, JSON.stringify(cards.map((c) => c.trim())) === JSON.stringify(topics.map((t) => t.title)), cards);
    run.check(`[${dev}] every card has its icon`, (await P.page.locator(".cv-guide-card .cv-guide-card-ic svg").count()) === 9, null);
    const f = await fit(P);
    run.check(`[${dev}] home: panel, head and foot inside the screen, nothing clipped, nothing selectable`, f.inside && f.clipped.length === 0 && !f.hScroll && f.selectable === 0, f);
    run.check(`[${dev}] home: only 닫기 at the bottom (no 뒤로 on the cards)`, JSON.stringify(f.buttons) === JSON.stringify(["close"]), f.buttons);
    const lay = await layoutOf(P, ".cv-guide-panel");
    run.check(`[${dev}] home: buttons >= 48 px with gaps >= 8 px, inside the screen`, lay.report.ok, lay.report);
    await run.shot(P, `${dev}-home.png`);
  });

  if (want("pages")) await run.step(`[${dev}] every topic page: steps, Q&As, scrolling, buttons; 뒤로 returns`, async () => {
    for (const t of topics) {
      await press(P, guideCard(P, t.id));
      await waitPage(P, t.id);
      await sleep(250);
      const title = (await P.page.locator(".cv-guide-title").textContent())?.trim();
      const steps = await P.page.locator(".cv-guide-step").count();
      const nums = (await P.page.locator(".cv-guide-step-n").allTextContents()).map((s) => s.trim());
      const icons = await P.page.locator(".cv-guide-step-ic svg").count();
      run.check(`[${dev}] ${t.id}: title '${t.title}', summary, ${t.steps} numbered steps each with an icon, ${t.qas.length} questions`, title === t.title && (await P.page.locator(".cv-guide-summary").count()) === 1 && steps === t.steps && icons === t.steps && nums.join(",") === Array.from({ length: t.steps }, (_, i) => String(i + 1)).join(",") && (await P.page.locator(".cv-guide-questions button").count()) === t.qas.length, { title, steps, icons, nums });
      const f0 = await fit(P);
      const want = [...(t.map ? ["map"] : []), ...(t.go ? ["go"] : []), "back", "close"];
      run.check(`[${dev}] ${t.id}: bottom buttons ${want.join(" / ")}`, JSON.stringify(f0.buttons) === JSON.stringify(want), f0.buttons);
      run.check(`[${dev}] ${t.id}: head and buttons inside the screen, nothing clipped or selectable`, f0.inside && f0.clipped.length === 0 && !f0.hScroll && f0.selectable === 0, f0);
      await run.shot(P, `${dev}-${t.id}-top.png`);
      // the first question opens its answer under it; a second press on it closes it again
      await press(P, question(P, 0));
      await sleep(250);
      const g = await guideAnswer(P);
      run.check(`[${dev}] ${t.id}: '${t.qas[0].question}' opens its answer`, g.answer === t.qas[0].answer && g.asked === t.qas[0].question && g.speaker === "안내원", g);
      // a long page scrolls inside its body, the head and the buttons stay
      const f1 = await fit(P);
      if (f1.body.sh > f1.body.ch + 4) {
        const top = await scrollBody(P, "end");
        await sleep(200);
        const f2 = await fit(P);
        run.check(`[${dev}] ${t.id}: the long page scrolls (${f1.body.sh} > ${f1.body.ch} px), head and buttons stay inside`, top > 0 && f2.inside, { top, body: f2.body });
      } else run.check(`[${dev}] ${t.id}: the page fits without scrolling`, true, f1.body);
      // the last question opens too (at the end of the page)
      const last = t.qas.length - 1;
      await press(P, question(P, last));
      await sleep(250);
      await scrollBody(P, "end");
      await sleep(200);
      const gl = await guideAnswer(P);
      run.check(`[${dev}] ${t.id}: the last question '${t.qas[last].question}' opens its answer`, gl.answer === t.qas[last].answer, gl);
      const lay = await layoutOf(P, ".cv-guide-panel");
      run.check(`[${dev}] ${t.id}: buttons >= 48 px with gaps >= 8 px`, lay.report.ok, lay.report);
      await run.shot(P, `${dev}-${t.id}-bottom.png`);
      await press(P, P.page.locator('[data-guide-act="back"]'));
      await waitPage(P, "home");
      run.check(`[${dev}] ${t.id}: 뒤로 returns to the cards`, (await page(P)) === "home" && (await P.page.locator(".cv-guide-card").count()) === 9, null);
    }
  });

  if (want("map")) await run.step(`[${dev}] 지도에서 보기: the map opens on the place, its card open`, async () => {
    if (!(await page(P))) await openGuide(P);
    for (const [topic, placeId, lx, lz] of [
      ["memorial", "memorial", 0, -60],
      ["park", "lot_gate", -24, 89],
    ]) {
      await press(P, guideCard(P, topic));
      await waitPage(P, topic);
      await press(P, P.page.locator('[data-guide-act="map"]'));
      const closed = await dialogGone(P);
      await sleep(1800); // the overview blend (0.6 s) and the labels' first layout
      const v = await view(P);
      const picked = await P.page.evaluate((id) => {
        const e = document.querySelector(`.cv-map-place.is-picked[data-map-place="${id}"]`);
        const card = e?.querySelector(".cv-map-place-card");
        const b = card?.getBoundingClientRect();
        return { picked: !!e, card: !!card, visible: !!b && b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight, go: card?.textContent ?? null };
      }, placeId);
      run.check(`[${dev}] ${topic}: the dialog closes, the map opens centred on (${lx}, ${lz}), zoomed in`, closed && v.mode === "ov" && Math.hypot(v.cx - lx, v.cz - lz) < 1 && v.h > 0, v);
      run.check(`[${dev}] ${topic}: the place's card is open with '여기로 가기', on screen`, picked.picked && picked.card && picked.visible && picked.go?.includes("여기로 가기"), picked);
      await run.shot(P, `${dev}-map-${topic}.png`);
      await exitMap(P);
      await sleep(1200);
      run.check(`[${dev}] ${topic}: the map closes back to the walk view`, (await view(P)).mode !== "ov", null);
      await openGuide(P);
    }
  });

  if (want("go")) await run.step(`[${dev}] 같이 가요: the fountain, the memorial hall's door, 케이슨랜드's gate`, async () => {
    if (!(await page(P))) await openGuide(P);
    // the fountain's rim (guideTopics FOUNTAIN_SPOT (0, 9.2))
    await goWith(P, dev, "tour", "분수", 0, 9.2, 1.5, 30000, `${dev}-go-fountain.png`);
    await backToGuide(P, [[3.5, 9.6, 0.8], [3.5, 16, 1.2]]); // between the fountain's benches (11 m out) and round the south one
    // the memorial's door: the map place's route end (0, -48.8)
    await goWith(P, dev, "memorial", "추모관", 0, -48.8, 1.5, 90000, `${dev}-go-memorial.png`);
    const ts = await P.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => t.label));
    run.check(`[${dev}] at the hall's door '추모관 들어가기' is offered`, ts.includes("추모관 들어가기"), ts);
    await backToGuide(P, [[0, -33], [-14, -20], [-20, 5]]);
    // 케이슨랜드's gate: the lot door's arrival spot (about (-24, 90.4))
    const gate = await P.page.evaluate(async () => {
      const m = (await window.__imp("/src/village/villagePlaces.ts")).mapPlace("lot_gate");
      return m.route[m.route.length - 1];
    });
    await goWith(P, dev, "park", "케이슨랜드", gate.x, gate.z, 1.5, 120000, `${dev}-go-gate.png`);
    const tg = await P.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => t.label));
    run.check(`[${dev}] at the gate '케이슨랜드 들어가기' is offered`, tg.includes("케이슨랜드 들어가기"), tg);
    await backToGuide(P, [[-24, 70], [-20, 40], [-14, 20]]);
  });

  if (want("close")) await run.step(`[${dev}] 닫기 closes; ${phone ? "the backdrop closes too" : "Esc closes too"}`, async () => {
    if (!(await page(P))) await openGuide(P);
    await press(P, P.page.locator('[data-guide-act="close"]'));
    run.check(`[${dev}] 닫기 closes the dialog`, await dialogGone(P), null);
    await act(P);
    await P.page.locator(".cv-guide").waitFor({ state: "visible", timeout: 6000 });
    await press(P, guideCard(P, "bus"));
    await waitPage(P, "bus");
    if (phone) await P.page.touchscreen.tap(20, 20);
    else await P.page.keyboard.press("Escape");
    run.check(`[${dev}] ${phone ? "a tap on the backdrop" : "Esc"} closes it from a page`, await dialogGone(P), null);
    await act(P);
    await P.page.locator(".cv-guide").waitFor({ state: "visible", timeout: 6000 });
    run.check(`[${dev}] opened again, it starts on the cards`, (await page(P)) === "home", await page(P));
    await press(P, P.page.locator('[data-guide-act="close"]'));
    await dialogGone(P);
  });

  await P.ctx.close();
}

const browser = await launchBrowser();
try {
  if (which === "pc" || which === "both") await scenario(browser, "pc", DESKTOP);
  if (which === "phone" || which === "both") await scenario(browser, "phone", PHONE);
} finally {
  await browser.close();
}
process.exit(run.finish({}));
