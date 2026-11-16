/**
 * e2e/village-bus-cabin.mjs — free riding inside the village bus (owner 2026-11-15: "버스 안에서 캐릭터는 창문의 왼쪽 오른쪽을
 * 다 볼 수 있어야 해 … 의자에 앉을 수도 있고 서있을 수도 있어야 해").
 *
 * Two clients: A on a PC (mouse + keyboard), B on a 390x844 phone (touch). Both board in the boarding window.
 *  - aboard they are free in the aisle at the entry (busSeat 0); A walks the aisle with the keys (inside the cabin), sits in a free
 *    seat with E; B tries the same seat (a notice, the seat is not shared), then sits in R1 with the action button;
 *  - each sees the other in the bus (drawn pose inside the bus body, seated);
 *  - the camera: every quick view (left, front, right, back) on both clients; a drag turns the view; the eye stays in the shell;
 *    screenshots of each view; bus v3 (2026-11-16): no poles, rails or straps in the cabin at all;
 *  - A stands up and walks; the bus leaves and the riders move with it; round the lap the bus stops and both get off.
 * Evidence: screenshots + JSON in --out.
 *
 * Start the server with its clock ~150 s before a departure:
 *   OFF=$(node -e 'const n=Date.now()+170000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2901 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:2901 npx vite --port 5501 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5501 node e2e/village-bus-cabin.mjs --out=<folder> [--time=2026-11-03T21:30]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, NOON } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const timeArg = process.argv.find((a) => a.startsWith("--time="));
const TIME = timeArg ? timeArg.slice("--time=".length) : NOON;
const night = TIME !== NOON;
const run = createRun(night ? "village-bus-cabin-night" : "village-bus-cabin");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });
const PHONE_390 = { ...PHONE, viewport: { width: 390, height: 844 } };

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: "A-pc", device: DESKTOP });
const B = await openPlayer(browser, run, { tag: "B-phone", device: PHONE_390 });
const shot = (p, name) => p.page.screenshot({ path: join(OUT, name) });
const sid = (p) => p.page.evaluate(() => window.__cv.getSessionId());
const ride = (p) =>
  p.page.evaluate(async () => {
    const r = (await window.__imp("/src/game/busRide.ts")).selfBusRide;
    const w = (await window.__imp("/src/game/busRide.ts")).busWalk;
    const cam = (await window.__imp("/src/game/busRide.ts")).busCamState;
    return { slot: r.slot, ahead: r.ahead, right: r.right, yaw: r.yaw, walk: { ahead: w.ahead, right: w.right, yaw: w.yaw, valid: w.valid }, cam: { active: cam.active, fp: cam.firstPerson, arm: cam.arm, eye: [...cam.eye] } };
  });
const serverPlayer = (p, id) =>
  p.page.evaluate(async (id) => {
    const room = (await window.__imp("/src/net/connection.ts")).getRoom();
    const pl = room?.state?.players?.get?.(id);
    return pl ? { busSeat: pl.busSeat, busAhead: pl.busAhead, busRight: pl.busRight, busYaw: pl.busYaw, x: pl.x, z: pl.z } : null;
  }, id);
const transit = (p) =>
  p.page.evaluate(async () => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const pose = sync.getTransitRenderPose();
    const now = sync.transitNowMs();
    const trip = sync.transitTripAt(now);
    return { x: pose.x, z: pose.z, yaw: pose.yaw, status: trip.status, startMs: trip.startMs, now, boarded: sync.getTransitState().boarded, notice: sync.getTransitState().notice };
  });
const targetsOf = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/interactTargets.ts");
    return m.getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label }));
  });
/** Poll a node-side condition (Playwright's waitForFunction does not wait for an async page function's promise). */
async function pollUntil(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const waitSlot = (p, pred, ms = 6000) => pollUntil(async () => pred((await ride(p)).slot), ms);
const tripStatus = (p) => p.page.evaluate(async () => { const sync = await window.__imp("/src/net/transitSync.ts"); return { status: sync.transitTripAt(sync.transitNowMs()).status, boarded: sync.getTransitState().boarded }; });
const hud = (p) => p.page.evaluate(() => document.body.innerText);
const local = (b, q) => {
  const fx = Math.sin(b.yaw);
  const fz = Math.cos(b.yaw);
  return { ahead: (q.x - b.x) * fx + (q.z - b.z) * fz, right: -(q.x - b.x) * fz + (q.z - b.z) * fx };
};

/** The orbit's yaw relative to the bus: set directly (the quick views ease to it; a drag would too). */
async function view(p, name) {
  await p.page.locator(`[data-testid=bus-ride-views] button[data-view=${name}]`).first().click({ timeout: 4000 }).catch(async () => {
    await p.page.locator(`[data-testid=bus-ride-views] button[data-view=${name}]`).first().tap();
  });
  await sleep(1100);
}

/** Walk the free rider (keys on a PC) to a point in the bus's frame, a closed loop on the predicted point. */
async function walkBus(p, ahead, right, tol = 0.25, ms = 14000) {
  // the camera behind the rider looking forward (the front quick view): W = ahead, S = back, A/D across
  await view(p, "front");
  const t0 = Date.now();
  let held = null;
  const release = async () => {
    if (held) await p.page.keyboard.up(held);
    held = null;
  };
  let last = null;
  while (Date.now() - t0 < ms) {
    const r = await ride(p);
    last = r.walk;
    const da = ahead - r.walk.ahead;
    const dr = right - r.walk.right;
    if (Math.hypot(da, dr) < tol) break;
    // W = forward (+ahead), D = to the camera's right; with the camera behind looking forward, right = the bus's right (+right)
    const key = Math.abs(da) > Math.abs(dr) ? (da > 0 ? "KeyW" : "KeyS") : dr > 0 ? "KeyD" : "KeyA";
    if (key !== held) {
      await release();
      await p.page.keyboard.down(key);
      held = key;
    }
    await sleep(90);
  }
  await release();
  await sleep(250);
  return last;
}

await run.step("join A (PC) and B (phone)", async () => {
  await joinVillage(A, "탑승", TIME);
  await joinVillage(B, "구경", TIME);
  await pollUntil(() => A.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null), 30000);
  const t = await transit(A);
  run.check("the bus is at the stop (boarding is checked by the boarding itself below)", t.status === "boarding" || t.status === "atStop", { leftS: Math.round((t.startMs - t.now) / 1000), status: t.status });
});
const sidA = await sid(A);
const sidB = await sid(B);

await run.step("both walk to the bus doors", async () => {
  await Promise.all([
    (async () => {
      await walkAndWait(A, 38.5, -0.5, 40000, 1);
      await walkAndWait(A, 36.9, -6.0, 30000, 0.4);
    })(),
    (async () => {
      await walkAndWait(B, 38.5, -0.5, 40000, 1);
      await walkAndWait(B, 37.7, -8.9, 30000, 0.5);
    })(),
  ]);
  await sleep(800);
  const tg = await targetsOf(A);
  // (the server may be started before the boarding window: the button comes once it opens)
  const offeredBoard = await pollUntil(async () => (await targetsOf(A)).some((t) => t.id === "village_bus_board"), 420000, 500);
  run.check("A is offered 버스 타기 at the door", offeredBoard, await targetsOf(A));
});

await run.step("both board: aboard and free at the entry; the ride panel has the quick views and the hint", async () => {
  await pollUntil(async () => (await A.page.evaluate(async () => { const s = await window.__imp("/src/net/transitSync.ts"); return s.transitTripAt(s.transitNowMs()).status; })) === "boarding", 420000, 500); // the server may be started before the window opens
  await act(A);
  await waitSlot(A, (n) => n === 0, 8000);
  await sleep(1200);
  await shot(A, "cabin-1-A-entry-alone-pc.png"); // A alone aboard: the aisle in first person
  await act(B);
  const ok = await Promise.all([A, B].map((p) => waitSlot(p, (n) => n === 0, 8000)));
  run.check("A and B are aboard and free (busSeat 0)", ok[0] && ok[1], ok);
  await sleep(1500);
  for (const [name, p] of [["A", A], ["B", B]]) {
    const r = await ride(p);
    run.check(`${name}: the camera is the bus camera`, r.cam.active === true, r.cam);
    const text = await hud(p);
    run.check(`${name}: the panel has the quick views`, text.includes("왼쪽") && text.includes("오른쪽"), null);
    run.check(`${name}: the look-around hint is shown`, text.includes("화면을 끌어서 창밖을 둘러보세요") || text.includes("화면을 끌면 둘러볼 수 있어요"), null);
  }
  const rb = await ride(B);
  run.check("B (phone) is offered a seat at the entry (the action button)", (await targetsOf(B)).some((t) => t.id.startsWith("bus_sit:")), await targetsOf(B));
  const pa = await serverPlayer(A, sidA);
  const pb = await serverPlayer(B, sidB);
  run.check("the two riders were put at different spots (not one inside the other)", Math.hypot(pa.busAhead - pb.busAhead, pa.busRight - pb.busRight) >= 0.55, { pa, pb });
  run.check("A starts in first person (the avatar is hidden, the aisle in view)", (await A.page.evaluate(async () => (await window.__imp("/src/game/busRide.ts")).busCamState.firstPerson)) === true, null);
  await shot(A, "cabin-1-A-entry-pc.png");
  await shot(B, "cabin-1-B-entry-phone.png");
  writeFileSync(join(OUT, "cabin-boarded.json"), JSON.stringify({ a: await ride(A), b: rb }, null, 2));
});

await run.step("A walks the aisle inside the cabin (the keys), the server follows", async () => {
  // bus v3: nobody walks through anybody: B (boarded second, standing just behind A in the aisle) walks on down the bus first, to the
  // middle door's standing room
  await walkBus(B, -0.4, 0.6, 0.25, 20000);
  const before = await ride(A);
  const end = await walkBus(A, 1.5, 0.05, 0.3);
  const r = await ride(A);
  const s = await serverPlayer(A, sidA);
  run.check("A moved down the aisle", r.walk.ahead < before.walk.ahead - 1.2, { before: before.walk, after: r.walk });
  run.check("A stays inside the cabin (not through a seat or a wall)", Math.abs(r.walk.right) < 0.9 && r.walk.ahead > -4 && r.walk.ahead < 3.9, r.walk);
  await sleep(1200);
  const r2 = await ride(A);
  const s2 = await serverPlayer(A, sidA);
  run.check("the server has A's point (within a step of the prediction)", s !== null && Math.hypot(s.busAhead - r.walk.ahead, s.busRight - r.walk.right) < 0.6, { s, walk: r.walk, end });
  run.check("review r1: once A has stood still the server and A agree to a hand's breadth (no drift left standing)", Math.hypot(s2.busAhead - r2.walk.ahead, s2.busRight - r2.walk.right) < 0.12, { s2, walk: r2.walk });
  await shot(A, "cabin-2-A-walking-pc.png");
});

/** A seat's approach point (the shared rule) and index, by its id. */
const approachOf = (p, id) =>
  p.page.evaluate(async (id) => {
    const c = await window.__imp("/shared/src/village/busCabin.ts");
    const index = c.BUS_SEATS.findIndex((s) => s.id === id);
    const ap = c.seatApproachPoint(c.BUS_SEATS[index]);
    return { a: ap.ahead, r: ap.right, index };
  }, id);

await run.step("A sits (E); B is refused the same seat; B sits in another seat by the action button", async () => {
  const seatSpot = await approachOf(A, "L2");
  run.check("L2's approach point is known", seatSpot.index >= 0, seatSpot);
  await walkBus(A, seatSpot.a, seatSpot.r, 0.15, 14000);
  await sleep(500);
  const tg = await targetsOf(A);
  const sit = tg.find((t) => t.id.startsWith("bus_sit:seat:"));
  run.check("A is offered a seat to sit in", !!sit, tg);
  await act(A);
  const seated = await waitSlot(A, (n) => n > 0, 5000);
  const samples = [];
  for (let i = 0; i < 8; i++) {
    samples.push((await ride(A)).slot);
    await sleep(200);
  }
  const ra = await ride(A);
  run.check("A is seated (busSeat > 0) and stays seated", seated && samples.every((x) => x > 0), { slot: ra.slot, sit, samples });
  await sleep(1200);
  const seenByB = (await B.page.evaluate(() => window.__cv.getRemoteDrawn()))[sidA];
  const tr = await transit(B);
  const lb = seenByB ? local(tr, seenByB) : null;
  run.check("B draws A seated in the bus (inside the body)", seenByB?.mode === "bus-seated" && lb && Math.abs(lb.ahead) < 4.4 && Math.abs(lb.right) < 1.2 && seenByB.y > 0.3, { seenByB, lb });
  // B tries the seat A took: B stands at the entry, far from it (or on the wrong side): a notice; then sits elsewhere
  const rb0 = await ride(B);
  const taken = ra.slot;
  const refused = await B.page.evaluate(async (n) => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const room = (await window.__imp("/src/net/connection.ts")).getRoom();
    let got = null;
    const off = room.onMessage("bus_rejected", (m) => { got = m.reason; });
    sync.sendBusSit("seat", n - 1);
    for (let i = 0; i < 25 && got === null; i++) await new Promise((r) => setTimeout(r, 150));
    if (typeof off === "function") off();
    return { got, notice: sync.getTransitState().notice, n };
  }, taken);
  run.check("B asks for A's seat: a Korean notice, B stays free", typeof refused.got === "string" && refused.got.length > 0 && (await ride(B)).slot === 0, { refused, rb0: rb0.slot });
  run.check("B's ride panel shows the refusal (a rider must see why)", (await hud(B)).includes("다른 사람이 앉아 있어요"), refused);
  await shot(B, "cabin-3-B-seat-refused-phone.png");
  // B walks (keys) to R1's approach (the front kerb-side seat over the wheel housing) and sits with the action button
  const r1 = await approachOf(B, "R2");
  await walkBus(B, r1.a, r1.r, 0.15, 16000);
  await sleep(500);
  const tgB = await targetsOf(B);
  // the seat offered is the free one B faces there (L2 or R2, across the narrow aisle from each other), never A's, never a handle
  const offerB = tgB.find((t) => t.id.startsWith("bus_sit:seat:"));
  run.check("B is offered a free seat there (not A's) and never a grab handle", !!offerB && offerB.id !== `bus_sit:seat:${taken - 1}` && !tgB.some((t) => /손잡이|잡기/.test(t.label)), tgB);
  await act(B);
  const held = await waitSlot(B, (n) => n > 0 && n !== taken, 5000);
  run.check("B sits in it (the action button)", held, await ride(B));
  await sleep(1200);
  const seenByA = (await A.page.evaluate(() => window.__cv.getRemoteDrawn()))[sidB];
  const ta = await transit(A);
  const la = seenByA ? local(ta, seenByA) : null;
  run.check("A draws B seated, inside the bus", seenByA?.mode === "bus-seated" && la && Math.abs(la.ahead) < 4.4 && Math.abs(la.right) < 1.2, { seenByA, la });
  await shot(A, "cabin-3-A-seated-pc.png");
  await shot(B, "cabin-3-B-seated-phone.png");
});

await run.step("looking out of every window: left, right, front, back, a drag — on the PC and on the phone", async () => {
  const eyes = {};
  const VIEW_YAW = { left: -Math.PI / 2, right: Math.PI / 2, front: Math.PI, back: 0 };
  const lookYaw = (p) => p.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).viewState.fpYaw);
  for (const [name, p] of [["A", A], ["B", B]]) {
    for (const v of ["left", "right", "front", "back"]) {
      await view(p, v);
      const r = await ride(p);
      const ly = await lookYaw(p);
      const dAng = Math.abs(Math.atan2(Math.sin(ly - VIEW_YAW[v]), Math.cos(ly - VIEW_YAW[v])));
      run.check(`${name} ${v} view: the look turned to it (bus-relative yaw)`, dAng < 0.2, { ly, want: VIEW_YAW[v] });
      eyes[`${name}-${v}`] = r.cam;
      run.check(`${name} ${v} view: the eye is inside the cabin`, r.cam.active && Math.abs(r.cam.eye[1]) <= 1.13 && r.cam.eye[0] > -4.15 && r.cam.eye[0] < 4.05 && r.cam.eye[2] < 3.2, r.cam);
      await shot(p, `cabin-4-${name}-${v}.png`);
    }
  }
  // a drag turns the view round the rider
  const o0 = { yaw: await lookYaw(A) };
  await A.page.mouse.move(640, 400);
  await A.page.mouse.down();
  for (let s = 1; s <= 8; s++) await A.page.mouse.move(640 + s * 22, 400);
  await A.page.mouse.up();
  await sleep(400);
  const o1 = { yaw: await lookYaw(A) };
  run.check("a mouse drag turns A's view (the look yaw, relative to the bus)", Math.abs(Math.atan2(Math.sin(o1.yaw - o0.yaw), Math.cos(o1.yaw - o0.yaw))) > 0.2, { o0, o1 });
  writeFileSync(join(OUT, "cabin-eyes.json"), JSON.stringify(eyes, null, 2));
});

await run.step("review r1: a rider in the way of the view is not drawn; bus v3: no pole, rail or strap anywhere in the cabin", async () => {
  // B sits near the front; A (seated) looks at B (first person): B is hidden only when within 1.5 m in front of the lens
  const groupAt = (p, x, z) =>
    p.page.evaluate(([x, z]) => {
      const { scene } = window.__cvThree();
      let found = null;
      scene.traverse((o) => {
        if (o.isGroup && Math.hypot(o.position.x - x, o.position.z - z) < 0.06 && o.children.length > 2 && o.name !== "bus") found = found === false ? false : o.visible;
      });
      return found;
    }, [x, z]);
  const seenByA0 = (await A.page.evaluate(() => window.__cv.getRemoteDrawn()))[sidB];
  const eyeA = (await ride(A)).cam;
  const bus0 = await transit(A);
  const lB = seenByA0 ? local(bus0, seenByA0) : null;
  const dist = lB ? Math.hypot(lB.ahead - eyeA.eye[0], lB.right - eyeA.eye[1]) : 99;
  const visB = seenByA0 ? await groupAt(A, seenByA0.x, seenByA0.z) : null;
  run.check("B is drawn when far in front of A's lens, hidden when near", visB === null || (dist < 1.4 ? visB === false : true), { dist, visB });
  // A in third person (wheel out): the cabin's fixtures near A's body are not drawn
  await A.page.mouse.move(640, 400);
  for (let i = 0; i < 5; i++) await A.page.mouse.wheel(0, 500);
  await sleep(1400);
  const camA = await A.page.evaluate(async () => {
    const m = await window.__imp("/src/game/busRide.ts");
    const cs = m.busCamState;
    const { scene } = window.__cvThree();
    const handles = [];
    let buttons = 0;
    scene.traverse((o) => {
      if (/^(pole|strap|rail)_/.test(o.name)) handles.push(o.name);
      if (/^stop_btn_/.test(o.name)) buttons++;
    });
    return { fp: cs.firstPerson, arm: cs.arm, handles, buttons, head: [...cs.head] };
  });
  run.check("A is in third person after the wheel", camA.fp === false, camA);
  // owner 2026-11-16 ("버스에 손잡이를 없애자"): no stanchion, ceiling rail or strap in the loaded bus; the stop buttons are on the walls
  run.check("no pole, rail or strap in the bus model; the stop buttons are there", camA.handles.length === 0 && camA.buttons >= 8, camA);
  await shot(A, "cabin-3-A-seated-3rd-pc.png");
  for (let i = 0; i < 6; i++) await A.page.mouse.wheel(0, -500);
  await sleep(900);
});

await run.step("A stands up (E) and walks; the bus leaves and both ride along; round the lap both get off", async () => {
  const tg = await targetsOf(A);
  run.check("a seated A is offered 일어나기", tg.some((t) => t.id === "bus_stand"), tg);
  await act(A);
  const up = await waitSlot(A, (n) => n === 0, 5000);
  run.check("A stands (busSeat 0) in the aisle", up, await ride(A));
  // the bus departs; wait for it to be on the road and moving
  const left = await pollUntil(async () => (await tripStatus(A)).status === "inTransit", 200000, 500);
  run.check("the bus left with them aboard", left, await transit(A));
  await sleep(6000);
  const t1 = await transit(A);
  const sA = await serverPlayer(A, sidA);
  const lA = local(t1, { x: sA.x, z: sA.z });
  run.check("A's world pose is inside the moving bus", Math.abs(lA.ahead) < 4.4 && Math.abs(lA.right) < 1.3, { lA, t1: { x: t1.x, z: t1.z } });
  await walkBus(A, 0.2, 0.0, 0.35, 9000);
  await view(A, "right");
  await shot(A, "cabin-5-A-moving-right-pc.png");
  await view(A, "left");
  await shot(A, "cabin-5-A-moving-left-pc.png");
  await shot(B, "cabin-5-B-moving-phone.png");
  const back = await pollUntil(async () => { const t = await tripStatus(A); return t.status !== "inTransit" || !t.boarded; }, 120000, 1000);
  run.check("the lap ended", back, await transit(A));
  const off = await Promise.all([A, B].map((p) => waitSlot(p, (n) => n === -1, 20000)));
  run.check("both are put down outside the door at the stop", off[0] && off[1], off);
  await sleep(1500);
  await shot(A, "cabin-6-A-off-pc.png");
});

await browser.close();
process.exit(run.finish({ sidA, sidB, time: TIME }));
