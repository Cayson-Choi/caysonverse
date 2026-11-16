/**
 * e2e/village-bus-nametag.mjs — the name tags of riders do not flicker inside the bus (owner 2026-11-16: "버스안에서 이름표가
 * 계속 빠르게 깜뻑거리는데"). Three players board (A, B, C); B sits, C stands in the aisle. On A's screen (a rider, PC or --phone)
 * the tags of B and C are sampled every frame for ~3 s: with the bus standing at the stop and driving on the lap, first person
 * and third person. Each sample: the tag's opacity, whether it is selected / occluded, and where the tag sprite is in the bus's
 * own frame (and over its avatar). Checks: a visible tag never toggles (no opacity reversals, no selected / occluded flips), and
 * it rides with the bus (its bus-local position and its height over the avatar stay put: no jitter).
 *
 * Start the server with its clock ~150 s before a departure (DEV offset), e.g. in Git Bash:
 *   OFF=$(node -e 'const n=Date.now()+150000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=3081 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:3081 npx vite --port 5681 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5681 node e2e/village-bus-nametag.mjs --out=<folder> [--phone] [--time=2026-11-03T21:30]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, NOON } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const timeArg = process.argv.find((a) => a.startsWith("--time="));
const phone = process.argv.includes("--phone");
const TIME = timeArg ? timeArg.slice("--time=".length) : NOON;
const run = createRun(phone ? "village-bus-nametag-phone" : "village-bus-nametag");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });
const tag = phone ? "phone" : "pc";

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: `A-${tag}`, device: phone ? PHONE : DESKTOP });
const B = await openPlayer(browser, run, { tag: "B-pc", device: DESKTOP });
const C = await openPlayer(browser, run, { tag: "C-pc", device: DESKTOP });
const shot = (p, name) => p.page.screenshot({ path: join(OUT, name) });
const sid = (p) => p.page.evaluate(() => window.__cv.getSessionId());
const ride = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/busRide.ts");
    return { slot: m.selfBusRide.slot, walk: { ahead: m.busWalk.ahead, right: m.busWalk.right }, fp: m.busCamState.firstPerson, active: m.busCamState.active };
  });
const tripStatus = (p) => p.page.evaluate(async () => { const s = await window.__imp("/src/net/transitSync.ts"); return s.transitTripAt(s.transitNowMs()).status; });
const targetsOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label })));
async function pollUntil(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const waitSlot = (p, pred, ms = 6000) => pollUntil(async () => pred((await ride(p)).slot), ms);

async function view(p, name) {
  const loc = p.page.locator(`[data-testid=bus-ride-views] button[data-view=${name}]`).first();
  if (p.touch) await loc.tap({ timeout: 4000 }).catch(() => {});
  else await loc.click({ timeout: 4000 }).catch(() => {});
  await sleep(1100);
}

/** Walk the free rider (keys) to a bus-local point, a closed loop on the predicted point. */
async function walkBus(p, ahead, right, tol = 0.2, ms = 14000) {
  await view(p, "front");
  const t0 = Date.now();
  let held = null;
  while (Date.now() - t0 < ms) {
    const r = await ride(p);
    const da = ahead - r.walk.ahead;
    const dr = right - r.walk.right;
    if (Math.hypot(da, dr) < tol) break;
    const key = Math.abs(da) > Math.abs(dr) ? (da > 0 ? "KeyW" : "KeyS") : dr > 0 ? "KeyD" : "KeyA";
    if (key !== held) {
      if (held) await p.page.keyboard.up(held);
      await p.page.keyboard.down(key);
      held = key;
    }
    await sleep(90);
  }
  if (held) await p.page.keyboard.up(held);
  await sleep(300);
}

/** A seat's approach point (the shared rule: where a rider walks to sit in it) and its index, by the seat's id. */
const seatSpot = (p, id) =>
  p.page.evaluate(async (id) => {
    const c = await window.__imp("/shared/src/village/busCabin.ts");
    const index = c.BUS_SEATS.findIndex((s) => s.id === id);
    const ap = c.seatApproachPoint(c.BUS_SEATS[index]);
    return { a: ap.ahead, r: ap.right, index };
  }, id);

/**
 * Sample the tags of `ids` on `p`'s screen once per drawn frame (R3F's after-effect: what was just drawn) for `ms`: the tag's
 * opacity / selected / occluded, whether it is drawn at all (the sprite and every parent visible: a hidden avatar hides its tag),
 * and where it is relative to the camera in the bus's own frame (what the viewer sees move; 0 while nobody walks, even with the
 * bus driving).
 */
const sampleTags = (p, ids, ms) =>
  p.page.evaluate(
    async ([ids, ms]) => {
      const reg = await window.__imp("/src/game/labelRegistry.ts");
      const sync = await window.__imp("/src/net/transitSync.ts");
      const cam = (await window.__imp("/src/game/cameraProbe.ts")).cameraProbe;
      let fiber = null;
      try {
        fiber = await window.__imp("/@react-three_fiber.js");
      } catch {}
      const out = {};
      for (const id of ids) out[id] = [];
      const t0 = performance.now();
      const shown = (o) => {
        for (let n = o; n; n = n.parent) if (!n.visible) return false;
        return true;
      };
      const tick = () => {
        const bus = sync.getTransitRenderPose();
        const fx = Math.sin(bus.yaw);
        const fz = Math.cos(bus.yaw);
        for (const e of reg.labelEntries()) {
          if (!ids.includes(e.id)) continue;
          const pr = reg.nametagProbe.get(e.id);
          const v = e.tag.sprite.getWorldPosition(new e.tag.sprite.position.constructor());
          const a = e.anchor.getWorldPosition(new e.tag.sprite.position.constructor());
          const dx = v.x - cam.x;
          const dz = v.z - cam.z;
          out[e.id].push({
            t: Math.round(performance.now() - t0),
            op: pr ? Math.round(pr.opacity * 1000) / 1000 : null,
            sel: pr?.selected ?? null,
            occ: pr?.occluded ?? null,
            vis: shown(e.tag.sprite) && (pr ? pr.opacity > 0.01 : true),
            ahead: dx * fx + dz * fz,
            right: -dx * fz + dz * fx,
            up: v.y - cam.y,
            overAnchor: v.y - a.y,
          });
        }
      };
      await new Promise((resolve) => {
        if (fiber?.addAfterEffect) {
          const off = fiber.addAfterEffect(() => {
            tick();
            if (performance.now() - t0 >= ms) {
              off();
              resolve();
            }
          });
        } else {
          const loop = () => {
            tick();
            if (performance.now() - t0 < ms) requestAnimationFrame(loop);
            else resolve();
          };
          requestAnimationFrame(loop);
        }
      });
      return { usedAfterEffect: !!fiber?.addAfterEffect, out };
    },
    [ids, ms],
  );

/** Toggles and jitter in one tag's samples. */
function analyse(samples) {
  const s = samples.filter((x) => x.op !== null);
  let reversals = 0;
  let dir = 0;
  let selFlips = 0;
  let occFlips = 0;
  let visFlips = 0;
  for (let i = 1; i < s.length; i++) {
    const d = s[i].op - s[i - 1].op;
    if (Math.abs(d) > 0.004) {
      const nd = Math.sign(d);
      if (dir !== 0 && nd !== dir) reversals++;
      dir = nd;
    }
    if (s[i].sel !== s[i - 1].sel) selFlips++;
    if (s[i].occ !== s[i - 1].occ) occFlips++;
    if (s[i].vis !== s[i - 1].vis) visFlips++;
  }
  // jitter: frame-to-frame change of the sprite's bus-local point and of its height over the avatar (the tag rides with the bus)
  let maxStep = 0;
  let maxOver = 0;
  for (let i = 1; i < s.length; i++) {
    // only while the tag is shown on both frames (a tag fading in or out once is not a jitter)
    if (!s[i].vis || !s[i - 1].vis) continue;
    maxStep = Math.max(maxStep, Math.hypot(s[i].ahead - s[i - 1].ahead, s[i].right - s[i - 1].right, s[i].up - s[i - 1].up));
    maxOver = Math.max(maxOver, Math.abs(s[i].overAnchor - s[i - 1].overAnchor));
  }
  const ops = s.map((x) => x.op);
  return {
    n: s.length,
    reversals,
    selFlips,
    occFlips,
    visFlips,
    minOp: ops.length ? Math.min(...ops) : null,
    maxOp: ops.length ? Math.max(...ops) : null,
    maxStepM: Math.round(maxStep * 1000) / 1000,
    maxOverAnchorStepM: Math.round(maxOver * 1000) / 1000,
  };
}

/** First person (true) or third person (false) in the bus: the eye button, as a player toggles it. */
async function setFp(p, want) {
  for (let k = 0; k < 4 && (await ride(p)).fp !== want; k++) {
    const b = p.page.getByRole("button", { name: "1인칭/3인칭 전환" }).first();
    if (p.touch) await b.tap({ timeout: 4000 }).catch(() => {});
    else await b.click({ timeout: 4000 }).catch(() => {});
    await sleep(900);
  }
}

const report = {};
async function checkPhase(label, ids) {
  const { usedAfterEffect, out: data } = await sampleTags(A, ids, 3000);
  run.check(`${label}: sampled after each drawn frame (R3F after-effect)`, usedAfterEffect, null);
  report[label] = {};
  for (const id of ids) {
    const a = analyse(data[id] ?? []);
    report[label][id] = a;
    run.check(`${label}: ${id.slice(0, 5)}'s tag was sampled`, a.n > 30, a);
    // flicker = going back and forth: at most one change in 3 s (a tag that appears or goes once is not a flicker)
    run.check(`${label}: ${id.slice(0, 5)}'s tag does not flicker (no opacity back-and-forth; selected / occluded / drawn change at most once)`, a.reversals === 0 && a.selFlips <= 1 && a.occFlips <= 1 && a.visFlips <= 1, a);
    run.check(`${label}: ${id.slice(0, 5)}'s tag stays put on the screen while nobody walks (under 1 cm a frame relative to the camera, in the bus's frame)`, a.maxStepM < 0.01 && a.maxOverAnchorStepM < 0.02, a);
  }
  const shown = ids.filter((id) => (report[label][id]?.minOp ?? 0) >= 0.9);
  run.check(`${label}: some rider's tag is on the screen the whole time (the check is not vacuous)`, shown.length >= 1, Object.fromEntries(ids.map((id) => [id.slice(0, 5), report[label][id]?.minOp])));
  writeFileSync(join(OUT, `nametag-${label}-${tag}.json`), JSON.stringify(data, null, 1));
  await shot(A, `nametag-${label}-${tag}.png`);
}

await run.step("join A, B, C", async () => {
  await joinVillage(A, "에이", TIME);
  await joinVillage(B, "비비", TIME);
  await joinVillage(C, "씨씨", TIME);
  await pollUntil(async () => (await tripStatus(A)) === "boarding", 420000, 500);
  run.check("boarding is open", (await tripStatus(A)) === "boarding", await tripStatus(A));
});
const ids = { A: await sid(A), B: await sid(B), C: await sid(C) };
const all = [ids.B, ids.C, ids.A];

await run.step("all three board and take their places: A in the aisle behind, B seated (L2), C standing ahead", async () => {
  // to the door together (the boarding window is 3 minutes), then aboard one after another
  await Promise.all([A, B, C].map(async (p, k) => {
    await walkAndWait(p, 38.5, -0.5, 60000, 1);
    await walkAndWait(p, 36.9, -6.0 - k * 0.7, 40000, 0.5);
  }));
  for (const p of [A, B, C]) {
    if (p !== A) await walkAndWait(p, 36.9, -6.0, 20000, 0.4);
    await sleep(500);
    await act(p);
    run.check(`${p.tag} boarded`, await waitSlot(p, (n) => n >= 0, 8000), await ride(p));
    if (p === A) await walkBus(A, -0.6, 0.0, 0.15, 25000);
    else if (p === B) {
      const spot = await seatSpot(p, "L2");
      await walkBus(p, spot.a, spot.r, 0.12, 25000);
      await p.page.evaluate(async (i) => (await window.__imp("/src/net/transitSync.ts")).sendBusSit("seat", i), spot.index);
      run.check(`${p.tag} is seated`, await waitSlot(p, (n) => n > 0, 5000), await ride(p));
    } else await walkBus(p, 2.2, 0.06, 0.15, 25000);
  }
  await view(A, "front");
  await sleep(1500);
});

await run.step("bus standing at the stop: first person", async () => {
  run.check("A is in first person", (await ride(A)).fp === true, await ride(A));
  await checkPhase("stopped-fp", all);
});
await run.step("bus standing at the stop: third person", async () => {
  await setFp(A, false);
  await view(A, "front");
  await sleep(1200);
  run.check("A is in third person", (await ride(A)).fp === false, await ride(A));
  await checkPhase("stopped-tp", all);
});
await run.step("bus driving: third person, then first person, then a rider close in front", async () => {
  run.check("the bus leaves", await pollUntil(async () => (await tripStatus(A)) === "inTransit", 200000, 500), await tripStatus(A));
  await sleep(6000); // up to cruise
  await checkPhase("moving-tp", all);
  await setFp(A, true);
  await view(A, "front");
  await sleep(1200);
  await checkPhase("moving-fp", all);
  // C a step and a half in front of A's eyes (the "rider in the way" distance: review r1 hides a head that fills the screen)
  await walkBus(C, 0.75, 0.0);
  await view(A, "front");
  await sleep(1200);
  await checkPhase("moving-fp-near", all);
});

writeFileSync(join(OUT, `nametag-report-${tag}.json`), JSON.stringify(report, null, 2));
run.finish(report);
await browser.close();
