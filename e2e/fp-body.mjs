/**
 * e2e/fp-body.mjs — true first person (owner 2026-11-20): "1인칭 뷰에서 바닥을 내려다보면 실제로는 내 발이 보이는게 정상 아닐까?
 * 의자에 앉아서 1인칭뷰로 내려다보면 그냥 의자가 보이지 내 하반신과 다리는 보이질 않아." and "1인칭뷰에서 바로 옆에 있는 상대방도 잘
 * 보이도록 해".
 *
 * A (PC, or a phone with --phone) and B (PC) in the village. Every view is shot twice — "before" (DEV `__cvFpBodyOff`: the first
 * person as it was, the own body hidden, the eye at the pose's estimate) and "after" — and the after checks:
 *   - the own body is drawn in first person (the group on screen, fpBody.active), its head shrunk for the drawing;
 *   - the camera sits on the head's eye point (within 3 cm), the near plane is FP_NEAR;
 *   - the own name tag is not drawn in first person;
 *   - B, 0.5–2 m beside / in front / on the next seat, is drawn whole and opaque in A's first person (in the frustum, visible,
 *     no fade, the full avatar not a far stand-in);
 * Views: standing and walking on the plaza (looking down), B standing beside, the plaza bench (A and B on the next seats), the
 * fishing chairs (A on P01, B on P03 beside), a cushion in the 대웅전 (A and B on the next cushions), the coaster and the carousel
 * (A's seat set on this client: the ride's own rider eye over the seated body).
 *
 *   CV_CLIENT_URL=http://localhost:5965 node e2e/fp-body.mjs [--phone] [--only=plaza,bench,lake,temple,rides]
 * Shots: D:\ClaudeCode\tmpshots\fp-body\<pc|phone>\ (CV_FP_SHOTS to change).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, r2, sleep, waitIdle, walkTo } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice(7).split(",") : ["plaza", "bench", "lake", "temple", "rides"];
const run = createRun(phone ? "fp-body-phone" : "fp-body-desktop");
const OUT = join(process.env.CV_FP_SHOTS || "D:\\ClaudeCode\\tmpshots\\fp-body", phone ? "phone" : "pc");
mkdirSync(OUT, { recursive: true });

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}

/** Walk like a tap: the game's own planner round what is in the way, leg by leg. */
async function walkPlanned(p, x, z, tol = 0.6) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await p.page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) {
      if (plan.why !== "here") console.log(`      (no plan to ${r2(x)}, ${r2(z)}: ${plan.why})`);
      return { ok: plan.why === "here", at: await pos(p), why: plan.why };
    }
    for (const w of plan.pts) {
      await walkTo(p, w.x, w.z);
      await sleep(300);
      await waitIdle(p, 25000);
    }
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ok: true, at };
  }
  const at = await pos(p);
  return { ok: Math.hypot(at.x - x, at.z - z) <= tol, at };
}

/** The map's own way to a lot (from the plaza), then the spot. */
async function walkWay(p, lotId, x, z) {
  const start = await pos(p);
  if (Math.hypot(start.x, start.z - 14) > 25) await walkPlanned(p, 0, 14, 2);
  const here = await pos(p);
  const way = await p.page.evaluate(async ([id, x, z]) => {
    const m = await window.__imp("/src/village/villagePlaces.ts");
    return m.wayTo(m.mapPlace(id), x, z);
  }, [lotId, here.x, here.z]);
  for (const w of way) await walkPlanned(p, w.x, w.z, 1.2);
  return walkPlanned(p, x, z, 0.8);
}

const seatInfo = (p, i) => p.page.evaluate(async (i) => (await window.__imp("/src/game/activeMap.ts")).VILLAGE_ACTIVE_MAP.seats[i], i);

/** The lake's big round button (data-lake-btn) once it shows `label`: tapped / clicked at its centre. */
async function pressLake(p, label, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const b = await p.page.evaluate(() => {
      const el = document.querySelector("[data-lake-btn]");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { label: el.getAttribute("aria-label"), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (b && b.label === label) {
      if (p.touch) await p.page.touchscreen.tap(b.x, b.y);
      else await p.page.mouse.click(b.x, b.y);
      return true;
    }
    await sleep(120);
  }
  return false;
}

/** Walk to the seat's approach spot and sit: the lake's big button when `lakeLabel` is given, else the server's Sit as the action sends it. */
async function sitOn(p, i, lakeLabel = null) {
  const g = await p.page.evaluate(async (i) => {
    const am = await window.__imp("/src/game/activeMap.ts");
    const tap = await window.__imp("/src/game/seatTap.ts");
    const seats = am.VILLAGE_ACTIVE_MAP.seats;
    return tap.seatApproachGoal(seats, i, am.getActiveMap().geometry.obstacles, am.activeBounds());
  }, i);
  const s = await seatInfo(p, i);
  let ok = false;
  // (a second try from the seat's own stand spot: a walk the planner cut short, a button the walk went through)
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    if (g && attempt === 0) await walkPlanned(p, g.x, g.z, 0.5);
    else await walkPlanned(p, s.standX, s.standZ, 0.5);
    if (!(lakeLabel && (await pressLake(p, lakeLabel, 5000)))) await p.page.evaluate((i) => window.__cv.sit(i), i);
    ok = await until(async () => (await pos(p)).seatIndex === i, 6000);
    if (!ok) console.log(`      (not seated on ${i}: at ${JSON.stringify(await pos(p))}, goal ${JSON.stringify(g)}, stand ${s.standX},${s.standZ})`);
  }
  await sleep(2600); // the sit-down clip to its end
  return ok;
}
async function standUp(p) {
  if ((await pos(p)).seatIndex < 0) return;
  await p.page.evaluate(() => window.__cv.stand());
  await until(async () => (await pos(p)).seatIndex < 0, 6000);
  await sleep(1800);
}

/** First person, looking along world yaw `faceYaw` (the direction the eye faces, atan2(dx, dz)) and `pitch` down. */
async function fpLook(p, faceYaw, pitch) {
  await p.page.evaluate(async ([faceYaw, pitch]) => {
    const vs = await window.__imp("/src/game/viewState.ts");
    // the look yaw is the camera's azimuth: forward = (-sin yaw, -cos yaw), so facing atan2(dx, dz) is yaw + PI
    const yaw = faceYaw + Math.PI;
    if (vs.viewState.mode !== "fp") vs.enterFp(yaw);
    vs.viewState.fpYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    vs.viewState.fpPitch = pitch;
  }, [faceYaw, pitch]);
  await sleep(900);
}
async function tpBack(p) {
  await p.page.evaluate(async () => {
    const vs = await window.__imp("/src/game/viewState.ts");
    if (vs.viewState.mode === "fp") vs.exitFp(window.__cvOrbitLive());
  });
  await sleep(700);
}
const setOff = (p, off) => p.page.evaluate((off) => (window.__cvFpBodyOff = off), off);

/** What A's first person draws: the own body, the head, the eye. */
const fpState = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/fpBody.ts");
    const { camera } = window.__cvThree();
    const g = window.__cvSelfGroup?.();
    const b = m.fpBody;
    const labels = g ? g.children.filter((c) => c.isSprite && c.visible).length : -1;
    const collapsed = b.collapsed;
    const headScale = b.head ? b.head.scale.x : null;
    // the head's eye point as drawn: the head put back for the measure (the render hook shrinks it again on the next frame)
    m.restoreHead();
    const eye = b.head ? m.headEyeWorld(b.head, camera.position.clone(), b.pull, b.side) : null;
    return {
      groupVisible: !!g?.visible,
      active: b.active,
      collapsed,
      headScale,
      eyeGap: eye ? Math.hypot(eye.x - camera.position.x, eye.y - camera.position.y, eye.z - camera.position.z) : null,
      near: camera.near,
      labelsDrawn: labels,
      cam: [camera.position.x, camera.position.y, camera.position.z].map((n) => Math.round(n * 100) / 100),
    };
  });

/** B's group in A's scene, found by B's drawn position (RemotePlayer groups carry no id): visible chain + opacity. */
const remoteBody = (p, x, z) =>
  p.page.evaluate(([x, z]) => {
    const { scene, camera } = window.__cvThree();
    const self = window.__cvSelfGroup?.();
    let best = null;
    let bestD = 0.6;
    scene.traverse((o) => {
      if (!o.isSkinnedMesh || o.name !== "avatar__solid") return;
      if (self && self.getObjectById(o.id)) return;
      const wp = o.getWorldPosition(o.position.clone());
      const d = Math.hypot(wp.x - x, wp.z - z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    });
    if (!best) return { found: false };
    let chain = true;
    for (let o = best; o; o = o.parent) if (!o.visible) chain = false;
    const m = best.material;
    // three would draw it: every parent visible, the material opaque, inside the near/far band and the frustum
    const wp = best.getWorldPosition(best.position.clone());
    return { found: true, visibleChain: chain, opacity: m.opacity, transparent: m.transparent, gap: Math.round(Math.hypot(wp.x - camera.position.x, wp.z - camera.position.z) * 1000) / 1000 };
  }, [x, z]);

async function shotPair(p, name) {
  await setOff(p, true);
  await sleep(700);
  await p.page.screenshot({ path: join(OUT, `${name}-before.png`) });
  await setOff(p, false);
  await sleep(900);
  await p.page.screenshot({ path: join(OUT, `${name}-after.png`) });
}

function checkFp(label, s) {
  run.check(`${label}: the own body is drawn in first person, headless`, s.groupVisible && s.active && s.collapsed && s.headScale < 0.01, s);
  run.check(`${label}: the eye is on the head's eye point (< 3 cm)`, s.eyeGap !== null && s.eyeGap < 0.03, s.eyeGap);
  run.check(`${label}: no own label drawn`, s.labelsDrawn === 0, s.labelsDrawn);
}

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
const B = await openPlayer(b, run, { tag: "B-pc", device: DESKTOP });

async function besideCheck(label, bx, bz) {
  const body = await remoteBody(A, bx, bz);
  run.check(`${label}: B is drawn whole and opaque in A's first person`, body.found && body.visibleChain && body.opacity >= 0.999 && !body.transparent, body);
  // the lens is outside B's head and hair (0.69 m round the body's axis at the widest, the curly hair) and the near plane
  run.check(`${label}: A's eye is outside B's head and hair (>= 0.74 m from B's axis)`, body.found && body.gap >= 0.74, body.gap);
}

await run.step("join", async () => {
  await joinVillage(A, "Fa");
  await joinVillage(B, "Fb");
  await sleep(2000);
});

if (ONLY.includes("plaza")) {
  await run.step("plaza: standing, walking, B beside", async () => {
    await walkPlanned(A, 0, 16, 0.6);
    const a0 = await pos(A);
    await walkPlanned(B, a0.x + 0.85, a0.z, 0.3);
    const ab = Math.hypot((await pos(B)).x - (await pos(A)).x, (await pos(B)).z - (await pos(A)).z);
    run.check("B stands right beside A (0.5–1.2 m: the bodies are solid)", ab > 0.5 && ab < 1.2, r2(ab));
    await fpLook(A, Math.PI, 1.4); // facing -z (north, away from B's side), looking down at the feet
    const s = await fpState(A);
    checkFp("standing", s);
    run.check("standing: the near plane is FP_NEAR (0.05)", Math.abs(s.near - 0.05) < 1e-6, s.near);
    await shotPair(A, "01-stand-look-down");
    await fpLook(A, Math.PI, 0.95);
    await shotPair(A, "02-stand-look-ahead-down");
    // B right beside (0.9 m to A's east): A looks at B
    const a = await pos(A);
    const bp = await pos(B);
    await fpLook(A, Math.atan2(bp.x - a.x, bp.z - a.z), 0.12);
    await shotPair(A, "04-B-beside-standing");
    await besideCheck("standing beside (0.9 m)", bp.x, bp.z);
    // B in front, 0.6 m
    await walkPlanned(B, a.x, a.z - 0.75, 0.3);
    const bp2 = await pos(B);
    await fpLook(A, Math.atan2(bp2.x - a.x, bp2.z - a.z), 0.12);
    await shotPair(A, "05-B-in-front");
    await besideCheck(`standing in front (${r2(Math.hypot(bp2.x - a.x, bp2.z - a.z))} m)`, bp2.x, bp2.z);
    await walkPlanned(B, 3, 18, 0.8); // B steps aside: A walks north
    // walking: W held, looking down at the legs
    await fpLook(A, Math.PI, 1.4);
    await A.page.keyboard.down("KeyW");
    await sleep(700);
    const w = await fpState(A);
    await A.page.screenshot({ path: join(OUT, "03-walk-look-down-after.png") });
    await sleep(260);
    await A.page.screenshot({ path: join(OUT, "03b-walk-look-down-after.png") });
    await A.page.keyboard.up("KeyW");
    checkFp("walking", w);
    await sleep(800);
    await tpBack(A);
    await A.page.screenshot({ path: join(OUT, "06-third-person-after.png") });
    const t = await fpState(A);
    run.check("back in third person: the whole avatar, head and all", t.groupVisible && !t.active && t.headScale > 0.5, t);
  });
}

if (ONLY.includes("bench")) {
  await run.step("plaza bench: A and B on the next seats", async () => {
    const okA = await sitOn(A, 0);
    const okB = await sitOn(B, 1);
    run.check("A sits on plaza seat 0, B on seat 1 (the same bench)", okA && okB);
    const s0 = await seatInfo(A, 0);
    // the seat's facing: yaw 0 = +z (the sitter faces atan2 = yaw)
    await fpLook(A, s0.yaw, 1.4);
    const s = await fpState(A);
    checkFp("bench", s);
    await shotPair(A, "10-bench-look-down");
    await fpLook(A, s0.yaw, 0.7);
    await shotPair(A, "11-bench-look-lap");
    const s1 = await seatInfo(A, 1);
    const bd = (await A.page.evaluate(() => window.__cv.getRemoteDrawn()))[await B.page.evaluate(() => window.__cv.getSessionId())];
    await fpLook(A, Math.atan2(s1.x - s0.x, s1.z - s0.z), 0.35);
    await shotPair(A, "12-bench-B-next-seat");
    await besideCheck("on the next seat of the bench", bd?.x ?? s1.x, bd?.z ?? s1.z);
    await standUp(A);
    await standUp(B);
  });
}

if (ONLY.includes("lake")) {
  await run.step("fishing chairs: A on P01, B on P03", async () => {
    // one after the other (the pad and the pier are narrow and the bodies solid: one waiting there blocks the other's way):
    // to the rod pad, the rod (the big button, pressed as the player would: a tap on the phone), onto the pier, the chair
    const toChair = async (p, seat) => {
      for (const [x, z] of [[40, 0], [80, -9], [100, -12]]) await walkPlanned(p, x, z, 2);
      await walkPlanned(p, 102, -14.6, 1);
      await sleep(700);
      await pressLake(p, "낚싯대 빌리기");
      await sleep(1500);
      await walkPlanned(p, 108, -12, 1.5);
      return sitOn(p, seat, "앉아서 낚시");
    };
    const okA = await toChair(A, 186);
    const okB = await toChair(B, 188);
    run.check("A sits on fishing chair P01, B on P03", okA && okB, { okA, okB, a: await pos(A), b: await pos(B) });
    await sleep(1500);
    const c = await seatInfo(A, 186);
    await fpLook(A, c.yaw, 1.4);
    const s = await fpState(A);
    checkFp("fishing chair", s);
    await shotPair(A, "20-fishing-chair-look-down");
    await fpLook(A, c.yaw, 0.35);
    await shotPair(A, "21-fishing-chair-rod");
    const c3 = await seatInfo(A, 188);
    const bd = (await A.page.evaluate(() => window.__cv.getRemoteDrawn()))[await B.page.evaluate(() => window.__cv.getSessionId())];
    await fpLook(A, Math.atan2(c3.x - c.x, c3.z - c.z), 0.3);
    await shotPair(A, "22-fishing-B-beside");
    await besideCheck("on the next fishing chair", bd?.x ?? c3.x, bd?.z ?? c3.z);
    await standUp(A);
    await standUp(B);
  });
}

if (ONLY.includes("bus")) {
  await run.step("the village bus: seated, first person (the seat set on this client)", async () => {
    await A.page.evaluate(async () => {
      const m = await window.__imp("/src/game/busRide.ts");
      m.selfBusRide.slot = 0;
    });
    await sleep(2500);
    await A.page.evaluate(async () => {
      const vs = await window.__imp("/src/game/viewState.ts");
      vs.viewState.fpPitch = 1.3;
    });
    await sleep(1200);
    const s = await fpState(A);
    run.check("bus: the own body sits in the seat, headless", s.groupVisible && s.active && s.collapsed, s);
    run.check("bus: the eye is on the seated head's eye point (< 3 cm)", s.eyeGap !== null && s.eyeGap < 0.03, s.eyeGap);
    await shotPair(A, "50-bus-seat-look-down");
    await A.page.evaluate(async () => {
      const vs = await window.__imp("/src/game/viewState.ts");
      vs.viewState.fpPitch = 0.3;
    });
    await sleep(900);
    await shotPair(A, "51-bus-seat-look-ahead");
    await A.page.evaluate(async () => {
      const m = await window.__imp("/src/game/busRide.ts");
      m.selfBusRide.slot = -1;
    });
    await sleep(2000);
  });
}

if (ONLY.includes("rides")) {
  await run.step("rides: the coaster and the carousel (the seat set on this client)", async () => {
    const g = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
    await walkWay(A, "lot_gate", g.x, g.z - 0.5);
    await walkPlanned(A, g.x, g.z - 0.5, 1.0);
    await act(A);
    await until(async () => (await A.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea())) === "park", 15000);
    await A.page.waitForFunction(() => !document.body.innerText.includes("불러오는 중"), null, { timeout: 90000 }).catch(() => {});
    await sleep(4000);
    for (const [ride, name, pitches] of [[1, "coaster", [1.2, 0.6]], [2, "carousel", [1.2, 0.6, 0.35, 0.9]], [3, "wheel", [1.2]], [4, "moonboat", [1.2]], [5, "droptower", [1.2]]]) {
      await A.page.evaluate(async (ride) => {
        const m = await window.__imp("/land/coasterRide.ts");
        m.selfRide.ride = ride;
        m.selfRide.slot = 0;
      }, ride);
      await sleep(1500);
      for (const [k, pitch] of pitches.entries()) {
        await A.page.evaluate(async (pitch) => {
          const vs = await window.__imp("/src/game/viewState.ts");
          vs.viewState.fpYaw = 0;
          vs.viewState.fpPitch = pitch;
        }, pitch);
        await sleep(900);
        const s = await fpState(A);
        if (k === 0) {
          run.check(`${name}: the own body sits in the seat, headless`, s.groupVisible && s.active && s.collapsed, s);
          // the ride's eye is the seated body's head (never inside its torso)
          run.check(`${name}: the ride's eye is on the seated head's eye point (< 3 cm)`, s.eyeGap !== null && s.eyeGap < 0.03, s.eyeGap);
        }
        await shotPair(A, `4${ride}-${name}-${k === 0 ? "look-down" : "look-ahead" + (k > 1 ? k : "")}`);
      }
      await A.page.evaluate(async () => {
        const m = await window.__imp("/land/coasterRide.ts");
        m.selfRide.slot = -1;
      });
      await sleep(1200);
    }
  });
}

if (ONLY.includes("temple")) {
  await run.step("대웅전: A and B on the next cushions", async () => {
    const info = await A.page.evaluate(async () => {
      const L = await window.__imp("/shared/src/village/villageLots.ts");
      const r = L.LOT_ROOMS.find((x) => x.unit.id === "lot_temple_hall");
      const d = L.lotDoorPoint(r.lot, r.door);
      return { lot: r.lot.id, area: r.area, pad: d.pad, arrival: d.arrival };
    });
    for (const p of [A, B]) {
      await walkWay(p, info.lot, info.arrival.x, info.arrival.z);
      await walkPlanned(p, info.pad.x, info.pad.z, 0.6);
      await sleep(1500);
      await act(p);
      await p.page.waitForFunction((a) => window.__imp("/src/village/villageArea.ts").then((m) => m.localArea() === a), info.area, { timeout: 20000 }).catch(() => {});
      await p.page.waitForFunction(() => !!window.__cvLotRoom, null, { timeout: 60000 }).catch(() => {});
      await sleep(3000);
    }
    const idx = await A.page.evaluate(async () => {
      const seats = (await window.__imp("/src/game/activeMap.ts")).VILLAGE_ACTIVE_MAP.seats;
      return [seats.findIndex((s) => s.id === "lotin:lot_temple_cushion_6:1"), seats.findIndex((s) => s.id === "lotin:lot_temple_cushion_7:1")];
    });
    const okA = await sitOn(A, idx[0]);
    const okB = await sitOn(B, idx[1]);
    run.check("A and B sit on the next cushions in the 대웅전", okA && okB, idx);
    const c = await seatInfo(A, idx[0]);
    await fpLook(A, c.yaw, 1.4);
    const s = await fpState(A);
    checkFp("temple cushion", s);
    await shotPair(A, "30-temple-cushion-look-down");
    await fpLook(A, c.yaw, 0.75);
    await shotPair(A, "31-temple-cushion-lap");
    const c2 = await seatInfo(A, idx[1]);
    const bd = (await A.page.evaluate(() => window.__cv.getRemoteDrawn()))[await B.page.evaluate(() => window.__cv.getSessionId())];
    await fpLook(A, Math.atan2(c2.x - c.x, c2.z - c.z), 0.45);
    await shotPair(A, "32-temple-B-next-cushion");
    await besideCheck("on the next cushion", bd?.x ?? c2.x, bd?.z ?? c2.z);
    await standUp(A);
    await standUp(B);
  });
}

await b.close();
process.exit(run.finish());
