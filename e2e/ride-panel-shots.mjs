/**
 * e2e/ride-panel-shots.mjs — the park's ride panel in every state, PC or phone (--phone), full-size shots:
 * far (the way to the nearest ride), near with boarding open (타기), near and closed (자리 맡기), reserved (자리 맡음 + bar + 자리 취소), a refused board's toast,
 * cancelled again, riding (the card on a ride) and, on a phone, folded and with the other rides open. Checks that nothing is selectable, nothing wraps or clips.
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/ride-panel-shots.mjs [--phone] [--ride=coaster|carousel|wheel|moonboat|droptower] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const rideArg = process.argv.find((a) => a.startsWith("--ride="));
const KEY = rideArg ? rideArg.slice("--ride=".length) : "coaster";
const run = createRun(`ride-panel-${phone ? "phone" : "pc"}-${KEY}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

const b = await launchBrowser();
const P = await openPlayer(b, run, { tag: phone ? "P-phone" : "P-pc", device: phone ? PHONE : DESKTOP });

async function until(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
async function goTo(x, z, tol = 1.2) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await P.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const me = window.__cv.getPos();
        const via = plan.findDetour(me.x, me.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(400);
    await until(async () => (await P.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 120000);
    await sleep(300);
    const at = await pos(P);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(P);
}
const areaOf = () => P.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const status = () =>
  P.page.evaluate(async (k) => {
    const r = await window.__imp("/land/rides.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    return r.rideByKey(k).statusAt(clock.villageClock.liveMs()).status;
  }, KEY);
const rideState = () =>
  P.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    return { slot: m.selfRide.slot, ride: m.selfRide.ride };
  });
const panelText = () => P.page.locator("[data-testid=coaster-hud], [data-testid=coaster-ride-hud]").first().innerText().catch(() => "");
/** The panel's own health: nothing selectable, no horizontal overflow, every row on one line, the toast inside the panel. */
const health = () =>
  P.page.evaluate(() => {
    const el = document.querySelector("[data-testid=coaster-hud], [data-testid=coaster-ride-hud]");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const wrapped = [];
    for (const n of el.querySelectorAll(".cv-ride-name, .cv-ride-rname, .cv-ride-dist, .cv-ride-primary, .cv-ride-tool, .cv-ride-row, .cv-ride-line")) {
      const lh = parseFloat(getComputedStyle(n).lineHeight) || 18;
      if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).textOverflow !== "ellipsis") wrapped.push(n.className + ":" + n.textContent);
      if (n.getBoundingClientRect().height > lh * 1.6 + (n.tagName === "BUTTON" ? 60 : 0) && !n.classList.contains("cv-ride-primary")) wrapped.push("tall:" + n.className + ":" + n.textContent);
    }
    const toast = el.querySelector(".cv-ride-toast");
    const tb = toast ? toast.getBoundingClientRect() : null;
    const small = [...el.querySelectorAll("button")].filter((x) => x.getBoundingClientRect().height < (document.documentElement.classList.contains("cv-touch") ? 43.5 : 28)).map((x) => x.textContent);
    return {
      select: cs.userSelect || cs.webkitUserSelect,
      width: Math.round(box.width),
      bottom: Math.round(box.bottom),
      viewH: innerHeight,
      overflowX: el.scrollWidth > el.clientWidth + 1,
      wrapped,
      toastInside: tb ? tb.bottom <= box.bottom + 0.5 && tb.left >= box.left - 0.5 && tb.right <= box.right + 0.5 : null,
      smallTargets: small,
      selection: String(getSelection()),
    };
  });
const shot = async (name) => {
  await sleep(500);
  await run.shot(P, name);
};

await run.step("join and enter the park", async () => {
  await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(P);
  await P.page.locator("input.cv-input").first().fill("Pn" + Math.floor(Math.random() * 900 + 100));
  await press(P, P.page.locator(".cv-submit"));
  await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 120000 * SLOW });
  await sleep(3000);
  const g = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  for (let a = 0; a < 5 && (await areaOf()) !== "park"; a++) {
    await goTo(g.x, g.z - 0.5, 1.0);
    await sleep(800);
    if (await P.page.locator(".cv-action-btn").count()) await act(P);
    await until(async () => (await areaOf()) === "park", 8000);
  }
  await P.page.waitForFunction(() => !document.querySelector("[data-testid=park-loading]"), null, { timeout: 60000 * SLOW }).catch(() => undefined);
  await sleep(2500);
  run.check("in the park", (await areaOf()) === "park");
});

await run.step("far: the way to the nearest ride", async () => {
  await shot("p01-far.png");
  const h = await health();
  const t = await panelText();
  run.check("the panel shows a name, one status line, a primary button and the way", /걸어가서 타기/.test(t) && /m/.test(t), { text: t.replace(/\n/g, " | ") });
  run.check("nothing in the panel is selectable and nothing wraps or clips", h && h.select === "none" && !h.overflowX && h.wrapped.length === 0 && h.bottom <= h.viewH, h);
  run.check("every button is a full-size target", h && h.smallTargets.length === 0, h?.smallTargets);
  if (phone) {
    await P.page.locator("[data-testid=ride-fold]").tap();
    await shot("p01b-far-folded.png");
    const t2 = await panelText();
    run.check("folded: just the title and the status line", !/걸어가서 타기/.test(t2) && t2.length > 5, { text: t2.replace(/\n/g, " | ") });
    await P.page.locator("[data-testid=ride-fold]").tap();
    await P.page.locator("[data-testid=ride-more]").tap();
    await shot("p01c-far-more.png");
    const h2 = await health();
    run.check("the other rides as compact one-line rows", h2 && h2.wrapped.length === 0 && !h2.overflowX, h2);
    await P.page.locator("[data-testid=ride-more]").tap();
  }
});

const pad = await P.page.evaluate(async (k) => {
  const r = await window.__imp("/land/rides.ts");
  return r.rideByKey(k).pad;
}, KEY);

await run.step("near the pad: boarding open, then closed (자리 맡기), then reserved", async () => {
  await goTo(pad.x, pad.z, 1.6);
  // the nearest ride must be the chosen one here
  const opened = await until(async () => (await status()) === "boarding", 200000, 200);
  run.check("boarding opens", opened);
  await shot("p02-near-open.png");
  const t = await panelText();
  run.check("near and open: the button says 타기", /타기/.test(t) && !/걸어가서/.test(t), { text: t.replace(/\n/g, " | ") });
  const closed = await until(async () => (await status()) !== "boarding", 200000, 200);
  run.check("boarding closes", closed);
  await sleep(700);
  await shot("p03-near-closed.png");
  const t3 = await panelText();
  run.check("near and closed: the button says 자리 맡기, one countdown", /자리 맡기/.test(t3) && /다음 탑승까지/.test(t3), { text: t3.replace(/\n/g, " | ") });
  await (phone ? P.page.locator(`[data-testid=ride-go-${KEY}]`).tap() : P.page.locator(`[data-testid=ride-go-${KEY}]`).click());
  await sleep(900);
  await shot("p04-reserved.png");
  const t4 = await panelText();
  const h4 = await health();
  run.check("reserved: 자리 맡음 · N초 뒤 탑승, the button says 자리 취소, no repeated toast", /자리 맡음/.test(t4) && /자리 취소/.test(t4) && !/맡아뒀어요/.test(t4), { text: t4.replace(/\n/g, " | ") });
  run.check("the reserved card is healthy", h4 && h4.select === "none" && h4.wrapped.length === 0 && h4.bottom <= h4.viewH, h4);
  // a refused board shows ONE toast inside the card
  await P.page.evaluate(async () => {
    const m = await window.__imp("/land/coasterRide.ts");
    m.rideNotice.reason = "busy";
    m.rideNotice.at = performance.now();
  });
  await sleep(500);
  await shot("p05-toast.png");
  const h5 = await health();
  const t5 = await panelText();
  run.check("the toast sits inside the card and is not cut off", h5 && h5.toastInside === true && h5.bottom <= h5.viewH && /탈 수 없어요/.test(t5), { toastInside: h5?.toastInside, bottom: h5?.bottom, viewH: h5?.viewH });
  // cancel
  await (phone ? P.page.locator(`[data-testid=ride-go-${KEY}]`).tap() : P.page.locator(`[data-testid=ride-go-${KEY}]`).click());
  await sleep(1500);
  await shot("p06-cancelled.png");
  const t6 = await panelText();
  run.check("cancelled: back to 자리 맡기", /자리 맡기/.test(t6) && !/자리 맡음/.test(t6), { text: t6.replace(/\n/g, " | ") });
});

await run.step("riding", async () => {
  await (phone ? P.page.locator(`[data-testid=ride-go-${KEY}]`).tap() : P.page.locator(`[data-testid=ride-go-${KEY}]`).click());
  const seated = await until(async () => (await rideState()).slot >= 0, 320000, 250);
  run.check("the reservation boards by itself", seated);
  await sleep(2500);
  await shot("p07-riding.png");
  const h = await health();
  const t = await panelText();
  run.check("riding: the card has the ride's name, a way off and the sound switch", /탑승 중/.test(t) && /내리기|높이 떠/.test(t) && /소리/.test(t), { text: t.replace(/\n/g, " | ") });
  run.check("the riding card is healthy", h && h.select === "none" && h.wrapped.length === 0 && h.bottom <= h.viewH && h.smallTargets.length === 0, h);
  const leave = P.page.locator("[data-testid=coaster-leave]");
  if (await leave.isEnabled().catch(() => false)) await (phone ? leave.tap() : leave.click());
  const off = await until(async () => (await rideState()).slot < 0, 120000, 250);
  run.check("got off", off);
  await sleep(1200);
  await shot("p08-after.png");
});

const code = run.finish({});
await b.close();
process.exit(code);
