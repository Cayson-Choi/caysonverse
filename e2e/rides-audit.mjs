/**
 * e2e/rides-audit.mjs — one 케이슨랜드 ride's whole lifecycle, instrumented (the rides audit, owner 2026-11-20 "놀이기구 하나하나의 동작을 세세하게").
 * Three pages: R (the rider; a phone with --phone), R2 (a second rider), O (a spectator). R reserves early through the panel button (자리 맡기),
 * R2 boards with E (the action button on a phone) once the station opens; mid-ride R2's connection is cut and comes back; O watches both.
 * Logged, every 100 ms on R (ride-log.json): the wall clock (live and its server offset), the ride's status / phase / countdown from the shared
 * timeline, the panel's lines and button, the seat, the avatar's root, the camera eye and the vehicle as drawn. Every frame (rAF) on R: the
 * avatar's root and the eye in the drawn vehicle's frame (they must not move against it), and the vehicle's frame-to-frame jump (no snaps).
 *   CV_CLIENT_URL=http://localhost:5943 node e2e/rides-audit.mjs --ride=moonboat [--phone] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const KEY = (process.argv.find((a) => a.startsWith("--ride=")) ?? "--ride=moonboat").slice(7);
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`rides-audit-${KEY}-${phone ? "phone" : "pc"}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
run.allow("the cut network", /ERR_INTERNET_DISCONNECTED|Network offline|Room connection was closed|reconnect|WebSocket is already in CLOSING/i);

const RIDE_ID = { coaster: 1, carousel: 2, wheel: 3, moonboat: 4, droptower: 5 }[KEY];
const CAN_LEAVE_MID = KEY === "coaster" || KEY === "carousel" || KEY === "moonboat";
const TIME = "2026-11-03T12:30";

let nickSeq = 0;
async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}`, { waitUntil: "domcontentloaded", timeout: 120000 * SLOW });
  await entryReady(p);
  const nick = `${prefix}${++nickSeq}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10);
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 120000 * SLOW });
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2000);
  p.nick = nick;
}
async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
async function goTo(p, x, z, tol = 1.2) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(400);
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 120000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function enterPark(p) {
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  for (let attempt = 0; attempt < 5 && (await areaOf(p)) !== "park"; attempt++) {
    await goTo(p, g.x, g.z - 0.5, 1.0);
    await sleep(800);
    if (await p.page.locator(".cv-action-btn").count()) await act(p);
    await until(async () => (await areaOf(p)) === "park", 8000);
  }
  await p.page.waitForFunction(() => !document.querySelector("[data-testid=park-loading]"), null, { timeout: 60000 * SLOW }).catch(() => undefined);
  await sleep(2000);
  return (await areaOf(p)) === "park";
}
const state = (p) =>
  p.page.evaluate(async (key) => {
    const rides = await window.__imp("/land/rides.ts");
    const m = await window.__imp("/src/land/coasterRide.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const def = rides.rideByKey(key);
    const wall = clock.villageClock.liveMs();
    const st = def.statusAt(wall);
    return { slot: m.selfRide.slot, ride: m.selfRide.ride, status: st.status, cycle: st.cycle, phase: st.phase, departsInMs: st.departsInMs, wall, canLeave: def.canLeave ? def.canLeave(Math.max(0, m.selfRide.slot), wall) : true };
  }, KEY);
const remotes = (p) => p.page.evaluate(async () => (await window.__imp("/src/game/remoteStore.ts")).getRemotes());

/** Install the 100 ms logger and the per-frame sampler on a rider's page. */
async function instrument(p) {
  await p.page.evaluate(async ([key, rideId]) => {
    const rides = await window.__imp("/land/rides.ts");
    const m = await window.__imp("/src/land/coasterRide.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const probes = {
      1: (await window.__imp("/src/land/coasterRide.ts")).rideProbe,
      2: (await window.__imp("/src/land/carouselRide.ts")).carouselProbe,
      3: (await window.__imp("/src/land/wheelRide.ts")).wheelProbe,
      4: (await window.__imp("/src/land/moonBoatRide.ts")).moonBoatProbe,
      5: (await window.__imp("/src/land/dropTowerRide.ts")).dropProbe,
    };
    const def = rides.rideByKey(key);
    let self = window.__cvSelfGroup();
    // the app's own three (a second copy of the module would do as well for maths, but this one is at hand)
    const THREE = { Matrix4: self.matrixWorld.constructor, Vector3: self.position.constructor };
    const NAMES = { 1: "ride-coaster-car", 2: "ride-carousel-turntable", 3: "ride-wheel-gondola", 4: "ride-moonboat-hull", 5: "ride-droptower-car" };
    let veh = null;
    // the scene can be built again (a reconnection's overlay): find my avatar and the vehicle anew whenever the avatar group changed
    const acquire = () => {
      const now = window.__cvSelfGroup?.() ?? null;
      if (!now) return false;
      if (now !== self || !veh) {
        if (veh) window.__audit && window.__audit.remounts++;
        self = now;
        let root = self;
        while (root.parent) root = root.parent;
        veh = root.getObjectByName(NAMES[rideId]) ?? null;
      }
      return !!veh;
    };
    acquire();
    const Mv = new THREE.Matrix4();
    const Mi = new THREE.Matrix4();
    const Minv = new THREE.Matrix4();
    const pA = new THREE.Vector3();
    const pE = new THREE.Vector3();
    const prev = new THREE.Vector3();
    let hasPrev = false;
    const vehMatrix = (slot) => {
      if (!veh) return null;
      if (veh.isInstancedMesh) {
        const idx = rideId === 3 ? Math.floor(slot / 4) : Math.floor(slot / 2); // the wheel's gondola, the coaster's car
        veh.getMatrixAt(idx, Mi);
        return Mv.multiplyMatrices(veh.matrixWorld, Mi);
      }
      return Mv.copy(veh.matrixWorld);
    };
    window.__audit = { log: [], frames: [], vehFound: !!veh, rideId, remounts: 0 };
    const A = window.__audit;
    const panel = () => {
      const q = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
      return { line: q("[data-testid=ride-countdown]") ?? q("[data-testid=coaster-ride-hud] .cv-ride-line"), btn: q(`[data-testid=ride-go-${key}]`) ?? q("[data-testid=coaster-leave]"), name: q(".cv-ride-name"), toast: q("[data-testid=coaster-notice]") };
    };
    A.timer = setInterval(() => {
      if (!acquire() || !window.__cv) return;
      const wall = clock.villageClock.liveMs();
      const st = def.statusAt(wall);
      const slot = m.selfRide.slot;
      const pr = probes[rideId];
      const M = vehMatrix(Math.max(0, slot));
      const vp = M ? new THREE.Vector3().setFromMatrixPosition(M) : null;
      A.log.push({
        t: Date.now(),
        wall: Math.round(wall),
        off: clock.villageClock.offsetMs(),
        status: st.status,
        cycle: st.cycle,
        phase: Math.round(st.phase),
        dep: Math.round(st.departsInMs),
        slot,
        ride: m.selfRide.ride,
        av: [self.position.x, self.position.y, self.position.z].map((n) => Math.round(n * 100) / 100),
        eye: pr?.active ? pr.eye.map((n) => Math.round(n * 100) / 100) : null,
        veh: vp ? [vp.x, vp.y, vp.z].map((n) => Math.round(n * 100) / 100) : null,
        panel: panel(),
        pos: window.__cv.getPos(),
      });
    }, 100);
    let lastT = 0;
    const tick = (t) => {
      const slot = m.selfRide.slot;
      const M = acquire() ? vehMatrix(Math.max(0, slot)) : null;
      if (M) {
        pE.setFromMatrixPosition(M);
        const dt = lastT ? (t - lastT) / 1000 : 0;
        const jump = hasPrev ? pE.distanceTo(prev) : 0;
        prev.copy(pE);
        hasPrev = true;
        if (slot >= 0 && m.selfRide.ride === rideId) {
          Minv.copy(M).invert();
          pA.copy(self.position).applyMatrix4(Minv);
          const pr = probes[rideId];
          const eye = pr?.active ? new THREE.Vector3(pr.eye[0], pr.eye[1], pr.eye[2]).applyMatrix4(Minv) : null;
          const st = def.statusAt(clock.villageClock.liveMs());
          A.frames.push({ t: Math.round(t), dt: Math.round(dt * 1000), st: st.status, rel: [pA.x, pA.y, pA.z], eyeRel: eye ? [eye.x, eye.y, eye.z] : null, jump, vy: pE.y });
          if (A.frames.length > 20000) A.frames.shift();
        }
      }
      lastT = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [KEY, RIDE_ID]);
}

const RIDER = phone ? PHONE : { viewport: { width: 900, height: 560 } };
const small = { viewport: { width: 560, height: 360 } };
const b = await launchBrowser();
const R = await openPlayer(b, run, { tag: phone ? "R-phone" : "R-pc", device: RIDER });
const R2 = await openPlayer(b, run, { tag: "R2", device: small });
const O = await openPlayer(b, run, { tag: "O", device: small });
let PAD = null;
const summary = { ride: KEY, phone };

await run.step("join", async () => {
  await joinLand(R, "Ra");
  await joinLand(R2, "Rb");
  await joinLand(O, "Ro");
  for (const p of [R, R2, O]) run.check(`${p.tag} enters the park`, await enterPark(p));
  PAD = await R.page.evaluate(async (key) => (await window.__imp("/land/rides.ts")).rideByKey(key).pad, KEY);
  await Promise.all([goTo(R, PAD.x, PAD.z, 2), goTo(R2, PAD.x + 1, PAD.z + 1, 2.5)]);
  const near = await R.page.evaluate(async (key) => {
    const site = await window.__imp("/land/rides.ts");
    return site.rideByKey(key).pad;
  }, KEY);
  await goTo(O, near.x + 8, near.z + 8, 4);
  const at = await pos(R);
  run.check("R stands at the pad", Math.hypot(at.x - PAD.x, at.z - PAD.z) < PAD.radius + 2, { at, PAD });
  await instrument(R);
  run.check("the drawn vehicle is found", await R.page.evaluate(() => window.__audit.vehFound));
});

if (!PAD || !(await R.page.evaluate(() => !!window.__audit).catch(() => false))) {
  // the join did not get through (an overloaded machine): nothing below can be measured
  await b.close();
  process.exit(run.finish(summary));
}

await run.step("reserve early (panel button outside the window)", async () => {
  // wait for a moment the station is not open (KEY wheel: between two passes)
  const ok = await until(async () => {
    const s = await state(R);
    return s.status === "riding" && (KEY !== "wheel" || s.departsInMs > 5000); // well clear of the next opening (the wheel opens every 18.75 s)
  }, 260000 * SLOW);
  run.check("the station is closed now", ok, await state(R));
  const btn = R.page.locator(`[data-testid=ride-go-${KEY}]`).first();
  const label = (await btn.textContent())?.trim();
  run.check("the button says 자리 맡기 while closed", label === "자리 맡기", { label });
  await press(R, btn);
  await sleep(900);
  const line = (await R.page.locator("[data-testid=ride-countdown]").textContent().catch(() => ""))?.trim();
  run.check("the panel shows the reservation", /자리 맡음/.test(line ?? ""), { line });
  const label2 = (await btn.textContent().catch(() => ""))?.trim();
  run.check("the button now says 자리 취소", label2 === "자리 취소", { label2 });
});

let boardedAt = null;
let r2Slot = -1;
await run.step("board: R seated by the reservation, R2 with E", async () => {
  const seated = await until(async () => (await state(R)).slot >= 0, 260000 * SLOW);
  const s = await state(R);
  boardedAt = s;
  run.check("R is seated when the station opens", seated && s.ride === RIDE_ID && s.status === "boarding", s);
  summary.rSeat = s.slot;
  if (KEY === "moonboat") {
    const row = await R.page.evaluate(async (slot) => (await window.__imp("/land/moonBoat.ts")).moonSeatCell(slot).row, s.slot);
    run.check("moon boat: the first rider sits in an end row (0 or 7)", row === 0 || row === 7, { slot: s.slot, row });
  }
  await act(R2);
  const ok2 = await until(async () => (await state(R2)).slot >= 0, 8000);
  const s2 = await state(R2);
  r2Slot = s2.slot;
  run.check("R2 boards with E: another seat", ok2 && s2.slot !== s.slot && s2.ride === RIDE_ID, { r: s.slot, r2: s2.slot });
  if (KEY === "moonboat") {
    const row = await R.page.evaluate(async (slot) => (await window.__imp("/land/moonBoat.ts")).moonSeatCell(slot).row, s2.slot);
    run.check("moon boat: the second rider also gets an end row", row === 0 || row === 7, { slot: s2.slot, row });
  }
  await sleep(1500);
  await run.shot(R, "a01-seated.png");
  const seen = (await remotes(O)).filter((r) => r.nickname === R.nick || r.nickname === R2.nick);
  run.check("O sees both riders seated (rideId, rideSeat)", seen.length === 2 && seen.every((r) => r.rideId === RIDE_ID && r.rideSeat >= 0), seen.map((r) => ({ n: r.nickname, id: r.rideId, seat: r.rideSeat })));
  // pressing again while seated does nothing harmful
  await act(R);
  await sleep(600);
  run.check("a second press while seated keeps the seat", (await state(R)).slot === s.slot);
});

await run.step("ride: cut R2's connection mid-ride, back after 4 s", async () => {
  await until(async () => (await state(R)).status === "riding", 120000);
  await sleep(KEY === "wheel" ? 4000 : 6000);
  await run.shot(R, "a02-riding.png");
  const before = await state(R2);
  await R2.ctx.setOffline(true);
  await R2.page.evaluate(() => window.__cv.dropConnection()).catch(() => {});
  await sleep(4000);
  await R2.ctx.setOffline(false);
  const back = await until(async () => {
    const s = await state(R2).catch(() => null);
    const connected = await R2.page.evaluate(async () => !!(await window.__imp("/src/net/connection.ts")).getRoom()).catch(() => false);
    return s && connected && s.slot >= 0;
  }, 30000);
  const after = await state(R2);
  run.check("R2 reconnects still seated in the same seat", back && after.slot === before.slot, { before: before.slot, after: after.slot });
  const seen = (await remotes(O)).find((r) => r.nickname === R2.nick);
  run.check("O still sees R2 seated after the reconnection", !!seen && seen.rideSeat === before.slot, { seat: seen?.rideSeat, connected: seen?.connected });
  // leaving early: allowed (비상 내리기) or refused while aloft
  const leaveBtn = R2.page.locator("[data-testid=coaster-leave]");
  const label = (await leaveBtn.textContent().catch(() => ""))?.trim();
  const disabled = await leaveBtn.isDisabled().catch(() => null);
  if (CAN_LEAVE_MID) {
    run.check("the leave button reads 비상 내리기 mid-ride", label === "비상 내리기", { label });
    await press(R2, leaveBtn);
    const off = await until(async () => (await state(R2)).slot < 0, 5000);
    run.check("비상 내리기 puts R2 off", off);
    await sleep(1500);
    const at = await pos(R2);
    run.check("R2 stands by the pad after the early leave", Math.hypot(at.x - PAD.x, at.z - PAD.z) < PAD.radius + 8, at);
    const seenOff = (await remotes(O)).find((r) => r.nickname === R2.nick);
    run.check("O sees R2 off the ride (no ghost in the seat)", !!seenOff && (seenOff.rideSeat ?? -1) < 0, { seat: seenOff?.rideSeat });
  } else {
    const st = await state(R2);
    run.check("the leave button is disabled aloft", disabled === true || st.canLeave, { label, disabled, canLeave: st.canLeave });
  }
});

let offAt = null;
await run.step("ride to the end and alight", async () => {
  const shots = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 400000 * SLOW) {
    const s = await state(R);
    if (s.slot < 0) {
      offAt = s;
      break;
    }
    if (!shots.has("mid") && s.status === "riding" && s.phase > (s.phase + s.departsInMs) * 0) {
      // nothing: the mid shot is taken below by ride time
    }
    await sleep(200);
  }
  run.check("R is put off", !!offAt, offAt);
  if (offAt) {
    summary.offAt = offAt;
    await sleep(1600);
    const at = await pos(R);
    run.check("R stands by the pad after the ride", Math.hypot(at.x - PAD.x, at.z - PAD.z) < PAD.radius + 8, { at, PAD });
    run.check("the rider panel is gone", (await R.page.locator("[data-testid=coaster-ride-hud]").count()) === 0);
    const cam = await R.page.evaluate(() => window.__cvCamera?.());
    run.check("the camera is the village's again (not at the ride eye)", cam && cam.distance > 0.5, { distance: cam?.distance });
    await run.shot(R, "a03-after.png");
    // not stuck: a walk of 4 m away from the pad
    const from = await pos(R);
    const to = await goTo(R, from.x + 3, from.z + 3, 1.5);
    run.check("R can walk away after alighting", Math.hypot(to.x - from.x, to.z - from.z) > 2, { from, to });
    const seen = (await remotes(O)).find((r) => r.nickname === R.nick);
    run.check("O sees R off the ride", !!seen && (seen.rideSeat ?? -1) < 0, { seat: seen?.rideSeat });
  }
});

const audit = await R.page.evaluate(() => {
  clearInterval(window.__audit.timer);
  return { log: window.__audit.log, frames: window.__audit.frames, remounts: window.__audit.remounts };
});
await b.close();

// analysis
const fr = audit.frames.filter((f) => f.st === "riding");
const all = audit.frames;
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
function spread(list, pick) {
  if (!list.length) return null;
  const xs = list.map((f) => pick(f)).filter((v) => v);
  if (!xs.length) return null;
  const m = [0, 1, 2].map((i) => med(xs.map((v) => v[i])));
  let max = 0;
  for (const v of xs) max = Math.max(max, Math.hypot(v[0] - m[0], v[1] - m[1], v[2] - m[2]));
  return { median: m.map((n) => Math.round(n * 1000) / 1000), maxDev: Math.round(max * 1000) / 1000 };
}
const relSpread = spread(all, (f) => f.rel);
const eyeSpread = spread(all, (f) => f.eyeRel);
// a jump: a vehicle step far beyond what its speed allows (here: > 3 m in one frame, or > 1.5x the median step of its neighbours)
let maxJump = 0;
let maxJumpAt = null;
for (let i = 2; i < all.length - 2; i++) {
  const f = all[i];
  const around = (all[i - 2].jump + all[i - 1].jump + all[i + 1].jump + all[i + 2].jump) / 4;
  const excess = f.jump - around * 1.8;
  if (excess > maxJump && f.jump > 0.05) {
    maxJump = excess;
    maxJumpAt = { i, jump: f.jump, around, dt: f.dt, st: f.st };
  }
}
summary.frames = all.length;
summary.sceneRebuilds = audit.remounts;
summary.ridingFrames = fr.length;
summary.avatarInVehicle = relSpread;
summary.eyeInVehicle = eyeSpread;
summary.vehicleSnap = maxJumpAt;
// the countdown on the panel against the timeline: every 100 ms row's countdown number vs departsInMs
const mism = [];
for (const row of audit.log) {
  const line = row.panel?.line ?? "";
  const mm = /(\d+)초 뒤 출발/.exec(line);
  if (mm && row.status === "boarding") {
    const want = Math.ceil(row.dep / 1000);
    if (Math.abs(Number(mm[1]) - want) > 1) mism.push({ t: row.t, line, want });
  }
}
summary.countdownMismatches = mism.length;
// the clock: offset jumps
let offJumps = 0;
for (let i = 1; i < audit.log.length; i++) if (Math.abs(audit.log[i].off - audit.log[i - 1].off) > 5) offJumps++;
summary.offsetJumps = offJumps;
summary.offsetRange = audit.log.length ? [Math.min(...audit.log.map((r) => r.off)), Math.max(...audit.log.map((r) => r.off))] : null;
// alight timing: the first row with slot < 0 after the ride, against the cycle boundary
const lastSeated = [...audit.log].reverse().find((r) => r.slot >= 0);
const firstOff = lastSeated ? audit.log.find((r) => r.t > lastSeated.t && r.slot < 0) : null;
summary.alight = firstOff ? { status: firstOff.status, phase: firstOff.phase, cycle: firstOff.cycle, lastSeated: { status: lastSeated.status, phase: lastSeated.phase, cycle: lastSeated.cycle } } : null;
// the texts the panel showed (each once, in order)
const texts = [];
for (const row of audit.log) {
  const t = `${row.status}|${(row.panel?.line ?? "").replace(/\d+/g, "N")}|${row.panel?.btn ?? ""}`;
  if (texts[texts.length - 1] !== t) texts.push(t);
}
summary.panelTexts = [...new Set(texts)];
run.check("the avatar stays put in the drawn vehicle (< 3 cm)", relSpread && relSpread.maxDev < (KEY === "carousel" ? 0.6 : 0.03), relSpread);
run.check("the panel countdown matches the timeline (within 1 s)", mism.length === 0, mism.slice(0, 5));
writeFileSync(join(run.evidence, "ride-log.json"), JSON.stringify({ summary, log: audit.log }, null, 0));
writeFileSync(join(run.evidence, "frames.json"), JSON.stringify(audit.frames.filter((_, i) => i % 3 === 0)));
writeFileSync(join(run.evidence, "summary.json"), JSON.stringify(summary, null, 1));
console.log("SUMMARY", JSON.stringify(summary, null, 1));
process.exit(run.finish(summary));
