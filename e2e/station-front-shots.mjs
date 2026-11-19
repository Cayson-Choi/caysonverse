/**
 * e2e/station-front-shots.mjs — the coaster station's front (the north steps, the stone face, the coping), day or night (--night), PC or phone (--phone).
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/station-front-shots.mjs [--night] [--phone] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const night = process.argv.includes("--night");
const run = createRun(`station-front-${phone ? "phone" : "pc"}${night ? "-night" : ""}`);
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
  await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(night ? "2026-11-03T21:30" : "2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
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


await run.step("the station front", async () => {
  for (const [name, x, y, z, tx, ty, tz, fov] of [
    ["s01-approach", 2, 1.7, -46, 2, 2.5, -6, 62],
    ["s02-front", 2, 1.7, -22, 2, 1.6, -6, 62],
    ["s03-steps-close", 5, 1.5, -15, 2, 0.9, -8.5, 52],
    ["s04-side", -10, 2.2, -18, 3, 1.0, -8, 56],
    ["s05-face", 12, 1.4, -13, -2, 1.0, -6.9, 55],
  ]) {
    await P.page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [x, y, z, tx, ty, tz, fov]);
    await sleep(1400);
    await run.shot(P, `${name}.png`);
  }
  await P.page.evaluate(() => { window.__cvShot = null; });
  run.check("shots taken", true);
});

const code = run.finish({});
await b.close();
process.exit(code);
