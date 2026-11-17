/**
 * e2e/lots2-walk.mjs — 마을 부지 건물 v2를 실제 게임에서 (L5v2, 2026-11-17): 학교 · 도서관 · 성당 · 교회 · 절 · 케이슨랜드 정문.
 *
 *   server:  PORT=3113 npx tsx src/index.ts                                                   (server/)
 *   client:  VITE_SERVER_URL=http://localhost:3113 npx vite --port 5713 --strictPort          (client/)
 *   CV_CLIENT_URL=http://localhost:5713 node e2e/lots2-walk.mjs [--out=<폴더>] [--only=pc,times,phone,before] [--rooms=lot_school_class,…]
 *
 * 하는 일 (사장님 2026-11-17: "모든 건물은 안에 들어가서 의자가 있으면 앉아볼 수 있어야", "자동문이 주위의 물체와 겹치잖아 제발 좀 꼼꼼하게
 * 확인해", "게임내에서 끊김이 없도록"):
 *  - pc: 여섯 채가 따로 된 로더로 들어오는지(실패 0), 문짝 다섯 쌍을 닫힘 → 활짝 20단계로 돌려 그 건물의 다른 삼각형과 닿는 곳이 0인지,
 *    방마다: 지도 길로 문까지 걸어가 → 문이 저절로 열리고 → "<건물> 들어가기" → 들어가서(덮개가 걷히고 방이 그려짐) → 방 안을 걸어 다니고
 *    (보이지 않는 벽 없음) → 카메라를 한 바퀴 돌려도 벽 · 천장 밖으로 나가지 않고 → 의자 · 장의자 · 방석 앞에서 "앉기" 버튼으로 앉고
 *    (톡 눌러 걸어가기만, 자동으로 앉지 않음) → 일어나면 앞쪽에 서고 → "밖으로 나가기"로 문 앞으로. 그동안 프레임 간격(끊김).
 *  - times: 해 질 녘 · 밤의 거리 화면 여섯 채와 성당 안.
 *  - phone: 375x812(터치)로 교회와 성당 안 왕복, 앉기 · 일어나기, LOD(자세히 2채까지), 폰 파일.
 *  - before: `?lots=off`(부지 건물 없이) 같은 거리 화면 — 전/후 시트용.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, pos, press, r2, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { act, areaOf, hideHud, showHud } from "./lib/village.mjs";

const run = createRun("lots2-walk");
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = arg("out") ?? run.evidence;
mkdirSync(OUT, { recursive: true });
const ONLY = (arg("only") ?? "pc,times,phone,before").split(",");
const ROOMS = arg("rooms") === "none" ? [] : arg("rooms")?.split(",") ?? ["lot_school_class", "lot_library_reading", "lot_chapel_nave", "lot_church_nave", "lot_temple_hall"];
const TIMES = { day: "2026-11-03T12:30", sunset: "2026-11-03T17:15", night: "2026-11-03T21:00" };
const numbers = { rooms: {}, frames: {} };

let seq = 0;
async function join_(p, time, extra = "", frameLabel = null) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}${extra}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`l2w${++seq}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 10));
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
  if (frameLabel) await startFrames(p); // the walk-in: from the village showing until the lots are in
  await p.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 });
  if (!extra.includes("lots=off")) await p.page.waitForFunction(() => !!window.__cvLots, null, { timeout: 180000 });
  await sleep(2500);
  if (frameLabel) await stopFrames(p, frameLabel);
}

const lots = (p) => p.page.evaluate(() => window.__cvLots?.() ?? null);
const room = (p) => p.page.evaluate(() => window.__cvLotRoom?.() ?? null);
const shared = (p, code, a) => p.page.evaluate(new Function("a", `return (async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); const B = await window.__imp("/shared/src/village/benchSeats.ts"); ${code} })()`), a);

/** Frame intervals (rAF) from now until `stopFrames`: the hitch watch. */
const startFrames = (p) =>
  p.page.evaluate(() => {
    window.__l2f = [];
    let last = performance.now();
    const tick = (t) => {
      window.__l2f.push(t - last);
      if (t - last > 100) (window.__l2fLong ??= []).push([last, t]);
      last = t;
      if (window.__l2f) window.__l2fId = requestAnimationFrame(tick);
    };
    window.__l2fId = requestAnimationFrame(tick);
  });
async function stopFrames(p, label) {
  const f = await p.page.evaluate(() => {
    const a = window.__l2f ?? [];
    cancelAnimationFrame(window.__l2fId);
    window.__l2f = null;
    return a;
  });
  const s = [...f].sort((a, b) => a - b);
  const q = (k) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0);
  const out = { frames: f.length, fps: f.length ? +(1000 / (f.reduce((a, b) => a + b, 0) / f.length)).toFixed(1) : 0, p50: r2(q(0.5)), p95: r2(q(0.95)), max: r2(s[s.length - 1] ?? 0), over50: f.filter((x) => x > 50).length, over100: f.filter((x) => x > 100).length };
  numbers.frames[label] = out;
  console.log(`      frames ${label}: ${JSON.stringify(out)}`);
  return out;
}

/** What the frame draws now (three's renderer.info over one frame): triangles and draw calls, with the lots' share. */
const frameLoad = (p) =>
  p.page.evaluate(
    () =>
      new Promise((res) => {
        // the main scene's render call (its shadow passes in it; the post chain's quads apart): three's counters right after it
        const { gl, scene } = window.__cvThree();
        const orig = gl.render;
        let got = null;
        gl.render = function (sc, cam) {
          const r = orig.call(this, sc, cam);
          if (sc === scene && !got) got = { triangles: gl.info.render.triangles, calls: gl.info.render.calls };
          return r;
        };
        const done = () => {
          gl.render = orig;
          const l = window.__cvLots?.();
          // the static count: every visible mesh's triangles once (instances counted), no shadow pass, no frustum (the budget's measure)
          let sceneTris = 0;
          const walk = (o) => {
            if (!o.visible) return;
            if (o.isMesh && o.geometry) {
              const g = o.geometry;
              const t = (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
              sceneTris += o.isInstancedMesh ? t * o.count : t;
            }
            for (const c of o.children) walk(c);
          };
          walk(scene);
          res({ ...(got ?? { triangles: -1, calls: -1 }), sceneTris: Math.round(sceneTris), programs: gl.info.programs?.length ?? 0, textures: gl.info.memory.textures, lots: l?.visible ?? null, levels: l?.levels ?? null });
        };
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0)));
      }),
  );

/** The scene's load at fixed spots (the walk, the camera as it is): the static budget (PC 310k / phone 300k). */
async function sceneLoad(p, tag) {
  const spots = await shared(
    p,
    `const out = [{ name: "plaza", x: 0, z: 14 }];
     for (const l of L.VILLAGE_LOTS) { const a = L.lotDoorPoint(l, l.doors[0]).arrival; out.push({ name: l.id, x: a.x, z: a.z }); }
     return out;`,
  );
  const out = {};
  for (const s of spots) {
    const i0 = await p.page.evaluate(() => window.__l2f?.length ?? 0);
    const w = s.name === "plaza" ? await walkPlanned(p, s.x, s.z, 1.5) : await walkWay(p, s.name, s.x, s.z);
    // the long frames of this leg (where a hitch is: CV_HITCH_LOG=1)
    if (process.env.CV_HITCH_LOG) console.log(`      hitch ${tag} -> ${s.name}: ${JSON.stringify(await p.page.evaluate((i) => (window.__l2f ?? []).slice(i).filter((d) => d > 100).map((d) => Math.round(d)), i0))}`);
    await sleep(2500);
    out[s.name] = { ...(await frameLoad(p)), at: w.at };
    console.log(`      load ${tag} ${s.name}: ${JSON.stringify(out[s.name]).slice(0, 220)}`);
  }
  numbers[`load_${tag}`] = out;
  return out;
}

/** To a lot along the map's own way (from the plaza), then to (x, z). */
async function walkWay(p, lotId, x, z) {
  const start = await pos(p);
  if (Math.hypot(start.x, start.z - 14) > 25) await walkPlanned(p, 0, 14, 2);
  const here = await pos(p);
  const way = await p.page.evaluate(async ([id, x, z]) => { const m = await window.__imp("/src/village/villagePlaces.ts"); return m.wayTo(m.mapPlace(id), x, z); }, [lotId, here.x, here.z]);
  for (const w of way) await walkPlanned(p, w.x, w.z, 1.2);
  return walkPlanned(p, x, z, 0.8);
}

/** Walk like a tap: the game's own planner round what is in the way (clickPlan), then each leg. */
async function walkPlanned(p, x, z, tol = 0.5) {
  const t0 = Date.now();
  for (let attempt = 0; attempt < 3 && Date.now() - t0 < 90000; attempt++) {
    const plan = await p.page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) {
      if (plan.why === "here") return { ok: true, at: await pos(p), why: plan.why };
      console.log(`      (no plan to ${r2(x)}, ${r2(z)}: ${plan.why})`);
      return { ok: false, at: await pos(p), why: plan.why };
    }
    for (const w of plan.pts) {
      await walkTo(p, w.x, w.z);
      await sleep(300);
      await waitIdle(p, 20000);
    }
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ok: true, at };
  }
  const at = await pos(p);
  return { ok: Math.hypot(at.x - x, at.z - z) <= tol, at };
}

async function render(p, file, eye, look, fov = 55) {
  const url = await p.page.evaluate(
    async ([eye, look, fov]) => {
      const { gl, scene, camera } = window.__cvThree();
      const cam = camera.clone();
      cam.fov = fov;
      cam.near = 0.05;
      cam.far = 2000;
      cam.position.set(...eye);
      cam.lookAt(...look);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      for (let i = 0; i < 5; i++) {
        gl.render(scene, cam);
        await new Promise((r) => requestAnimationFrame(r));
      }
      gl.render(scene, cam);
      return gl.domElement.toDataURL("image/jpeg", 0.88);
    },
    [eye, look, fov],
  );
  writeFileSync(join(OUT, file), Buffer.from(url.split(",")[1], "base64"));
}

/** Street views of the six (lot frame: in front of the door side, and a corner). */
async function streetShots(p, tag) {
  const shots = await shared(
    p,
    `const out = [];
     for (const l of L.VILLAGE_LOTS) {
       const W = (x, y, z) => { const q = L.lotLocalToWorld(l, x, z); return [q.x, y, q.z]; };
       const d = l.depth / 2;
       out.push({ f: l.id + "_street", eye: W(0, 1.7, d + 16), look: W(0, 4, 0) });
       out.push({ f: l.id + "_corner", eye: W(-0.6 * l.front, 2.4, d + 8), alt: W(0.6 * l.front, 2.4, d + 8), look: W(0, 4, 0) });
     }
     // a test eye never inside a building or a wall: slid back AWAY from its target (outward, never deeper into the building
     // it looks at: the library's corner eye landed in its own wing that way) until it is clear of every camera box (and 0.5 m more)
     const G = await window.__imp("/shared/src/village/villageLayout.ts");
     const boxes = G.villageGeometry.cameraBoxes;
     const inside = (p) => boxes.some((b) => p[0] > b.minX - 0.5 && p[0] < b.maxX + 0.5 && p[2] > b.minZ - 0.5 && p[2] < b.maxZ + 0.5 && p[1] < (b.height ?? 4) + 0.3 && p[1] > (b.minY ?? -1) - 0.3);
     for (const o of out) {
       // a corner in a neighbour (the library's left one is in house 10): the other corner
       if (o.alt && inside(o.eye) && !inside(o.alt)) o.eye = o.alt;
       for (let k = 0; k < 60 && inside(o.eye); k++) o.eye = [o.eye[0] - (o.look[0] - o.eye[0]) * 0.03, o.eye[1], o.eye[2] - (o.look[2] - o.eye[2]) * 0.03];
     }
     return out;`,
  );
  // the game picks each lot's detail by where the player and ITS camera are, not this test camera: a shot from across the
  // village drew the far shells (one albedo, no goods), which is what the release-4 sheet showed. Every lot in full detail
  // for the shots (its near maps given time to come), then back to the game's own choice.
  await p.page.evaluate(() => window.__cvLotsForce?.(2));
  await sleep(8000);
  for (const s of shots) await render(p, `${tag}_${s.f}.jpg`, s.eye, s.look);
  await p.page.evaluate(() => window.__cvLotsForce?.(null));
}

/** The camera stays in the room: inside its walls (a little in), under its ceiling, while the view goes round. */
async function cameraStaysIn(p, r) {
  const bad = [];
  for (let k = 0; k < 12; k++) {
    await p.page.evaluate(async ([yaw, pitch]) => {
      const v = (await window.__imp("/src/game/viewState.ts")).viewState;
      v.orbitGoal = { yaw, pitch };
    }, [(k * Math.PI * 2) / 12, k % 3 === 0 ? 0.15 : 0.6]);
    await sleep(700);
    const c = await p.page.evaluate(() => {
      const { camera } = window.__cvThree();
      return { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    });
    const b = r.bounds;
    if (c.x < b.minX + 0.02 || c.x > b.maxX - 0.02 || c.z < b.minZ + 0.02 || c.z > b.maxZ - 0.02 || c.y > r.ceiling) bad.push({ k, c: { x: r2(c.x), y: r2(c.y), z: r2(c.z) } });
  }
  return bad;
}

/** One room, door to door: walk there, the door opens, in, round, sit, stand, out. */
async function roomTrip(p, unit, tag) {
  const info = await shared(
    p,
    `const r = L.LOT_ROOMS.find((x) => x.unit.id === a);
     const d = L.lotDoorPoint(r.lot, r.door);
     const door = L.lotRoomDoor(r);
     const seats = B.VILLAGE_SEATS.map((s, i) => ({ ...s, index: i })).filter((s) => s.area === r.area);
     return { lot: r.lot.id, area: r.area, door: r.door.id, pad: d.pad, arrival: d.arrival, inside: door, bounds: r.bounds, ceiling: r.ceiling, origin: r.origin, seats, name: r.lot.name };`,
    unit,
  );
  const trip = { unit };
  // 1. the way there (the map's own way, from the plaza), then the pad
  await walkWay(p, info.lot, info.arrival.x, info.arrival.z);
  const atDoor = await walkPlanned(p, info.pad.x, info.pad.z, 0.6);
  run.check(`${tag} ${unit}: walked to the door's pad`, atDoor.ok, atDoor.at);
  // the camera behind the visitor, out on the street side (the orbit keeps its yaw while walking: it may be on the wall's side)
  await p.page.evaluate(async (yaw) => {
    (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw, pitch: 0.35 };
  }, info.arrival.yaw);
  await sleep(1600);
  const lt = await lots(p);
  const phase = lt?.doors?.find((d) => d.id === info.door)?.phase;
  run.check(`${tag} ${unit}: the oak doors open by themselves as one comes near`, phase === "open" || phase === "opening", phase);
  const t = await targets(p);
  run.check(`${tag} ${unit}: "${info.name.split(" ").pop()} 들어가기" is offered`, t.some((x) => x.id === `lotenter:${info.door}` && x.label.endsWith("들어가기")), t);
  await p.page.screenshot({ path: join(OUT, `${tag}_${unit}_1door.png`) });
  // 2. in
  await startFrames(p);
  await act(p);
  const inside = await p.page.waitForFunction((a) => window.__imp("/src/village/villageArea.ts").then((m) => m.localArea() === a), info.area, { timeout: 20000 }).then(() => true, () => false);
  run.check(`${tag} ${unit}: in through the door (area ${info.area})`, inside, await areaOf(p));
  const drawn = await p.page.waitForFunction(() => !!window.__cvLotRoom, null, { timeout: 60000 }).then(() => true, () => false);
  await p.page.waitForFunction(() => document.querySelector(".cv-house-cover")?.getAttribute("data-phase") !== "loading", null, { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  const rs = await room(p);
  run.check(`${tag} ${unit}: the room is drawn (its model, its sacred pieces, its lights)`, drawn && !!rs && rs.unit === unit, rs);
  await stopFrames(p, `${tag}_${unit}_enter`);
  trip.room = rs;
  trip.load = await frameLoad(p);
  const at = await pos(p);
  run.check(`${tag} ${unit}: standing on the room's arrival spot, facing in`, Math.hypot(at.x - info.inside.arrival.x, at.z - info.inside.arrival.z) < 0.9, at);
  await p.page.screenshot({ path: join(OUT, `${tag}_${unit}_2inside.png`) });
  // 3. the camera never leaves the room
  const out = await cameraStaysIn(p, info);
  run.check(`${tag} ${unit}: the camera stays inside the walls and under the ceiling all the way round`, out.length === 0, out);
  // 4. round the room (no invisible walls): to the far side and back near the door
  await startFrames(p);
  const cx = (info.bounds.minX + info.bounds.maxX) / 2;
  const free = await p.page.evaluate(async ([b, cx]) => {
    const am = await window.__imp("/src/game/activeMap.ts");
    const { isBlocked } = await window.__imp("/shared/src/collision.ts");
    const obs = am.getActiveMap().geometry.obstacles;
    const pts = [];
    for (const fz of [0.55, 0.85, 0.3]) for (const fx of [0.5, 0.25, 0.75, 0.15, 0.85]) {
      const x = b.minX + (b.maxX - b.minX) * fx;
      const z = b.minZ + (b.maxZ - b.minZ) * fz;
      if (!isBlocked(x, z, 0.45, obs, 0) && x > b.minX + 0.5 && x < b.maxX - 0.5 && z > b.minZ + 0.5 && z < b.maxZ - 0.5) { pts.push({ x, z }); break; }
    }
    return pts;
  }, [info.bounds, cx]);
  for (const f of free) {
    const w = await walkPlanned(p, f.x, f.z, 0.6);
    run.check(`${tag} ${unit}: walked across the room to (${r2(f.x)}, ${r2(f.z)})`, w.ok, w.at);
  }
  await p.page.screenshot({ path: join(OUT, `${tag}_${unit}_3round.png`) });
  // 5. sit: a tap on the seat walks there only; the 앉기 button sits
  const seat = info.seats.find((s) => /pew_l2:2|chair_5:1|cushion_6:1|chair_3:1|nook_1:1/.test(s.id)) ?? info.seats[Math.floor(info.seats.length / 2)];
  // (to the spot itself: a pew's places are 1.12 m apart, and E sits on the nearest)
  let toSeat = await walkPlanned(p, seat.standX, seat.standZ, 0.35);
  await walkTo(p, seat.standX, seat.standZ);
  await sleep(300);
  await waitIdle(p, 8000);
  toSeat = { ...toSeat, at: await pos(p) };
  await sleep(700);
  run.check(`${tag} ${unit}: walked up to ${seat.id} (its stand spot, in front)`, Math.hypot(toSeat.at.x - seat.standX, toSeat.at.z - seat.standZ) < 0.45, toSeat.at);
  const label = await p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? document.querySelector("[data-testid=interact-hint]")?.textContent ?? "");
  const offered = await p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/interactTargets.ts");
    return m.currentInteraction ? m.currentInteraction() : null;
  }).catch(() => null);
  run.check(`${tag} ${unit}: not seated by walking up (sit is the button's)`, (await pos(p)).seatIndex === -1);
  await act(p);
  const sat = await p.page.waitForFunction((i) => window.__cv.getPos().seatIndex === i, seat.index, { timeout: 8000 }).then(() => true, () => false);
  run.check(`${tag} ${unit}: sat on ${seat.id} with the 앉기 button / E`, sat, { now: await pos(p), label, offered });
  await sleep(1800);
  await hideHud(p);
  await p.page.screenshot({ path: join(OUT, `${tag}_${unit}_4seated.png`) });
  await showHud(p);
  // 6. stand: in front of the seat (never behind a pew's back)
  await act(p);
  const stood = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 8000 }).then(() => true, () => false);
  await sleep(1200);
  const up = await pos(p);
  // in front of the seat itself (its board's centre, not the sitter's root): a chair at a desk is stood up from where it was pulled back to
  const centre = await shared(p, `const r = L.LOT_ROOMS.find((x) => x.unit.id === a[0]); const s = r.spec.seats.find((q) => q.id === a[1]); const c = L.lotRoomPoint(r, s.x, s.z); return { ...c, back: s.backDepth };`, [unit, seat.id.split(":")[1]]);
  const ahead = (up.x - centre.x) * Math.sin(seat.yaw) + (up.z - centre.z) * Math.cos(seat.yaw);
  run.check(`${tag} ${unit}: stood up in front of the seat (never behind its back)`, stood && (seat.kind === "floor" || ahead > 0), { up, ahead: r2(ahead), stand: { x: seat.standX, z: seat.standZ } });
  // 7. out
  const toExit = await walkPlanned(p, info.inside.exitPad.x, info.inside.exitPad.z + 0.3, 0.6);
  run.check(`${tag} ${unit}: back at the way out`, toExit.ok, toExit.at);
  await sleep(500);
  const tt = await targets(p);
  run.check(`${tag} ${unit}: "밖으로 나가기" is offered at the door`, tt.some((x) => x.label === "밖으로 나가기"), tt);
  await act(p);
  const outside = await p.page.waitForFunction(() => window.__imp("/src/village/villageArea.ts").then((m) => m.localArea() === "village"), null, { timeout: 20000 }).then(() => true, () => false);
  await sleep(2500);
  const back = await pos(p);
  run.check(`${tag} ${unit}: out in front of the door`, outside && Math.hypot(back.x - info.arrival.x, back.z - info.arrival.z) < 1.2, back);
  await stopFrames(p, `${tag}_${unit}_round_and_out`);
  numbers.rooms[`${tag}_${unit}`] = trip;
}

const browser = await launchBrowser();
/** CV_TRACE_PROGRAMS=1: where a deleted WebGL program is asked about (the "glGetProgramiv: Program object expected" warning). */
async function tracePrograms(p) {
  if (!process.env.CV_TRACE_PROGRAMS) return;
  await p.ctx.addInitScript(() => {
    window.__badProg = [];
    const gpp = WebGL2RenderingContext.prototype.getProgramParameter;
    WebGL2RenderingContext.prototype.getProgramParameter = function (prog, pname) {
      if (prog && !this.isProgram(prog)) window.__badProg.push((new Error().stack || "").split(String.fromCharCode(10)).slice(2, 9).map((l) => l.trim()).join(" | "));
      return gpp.call(this, prog, pname);
    };
  });
}
async function dumpPrograms(p) {
  if (!process.env.CV_TRACE_PROGRAMS) return;
  console.log("BADPROG", JSON.stringify(await p.page.evaluate(() => (window.__badProg ?? []).slice(0, 4)), null, 1));
}

if (ONLY.includes("pc")) {
  await run.step("pc (1280x800, noon): the six load, the doors swing clear, every room door to door", async () => {
    const p = await openPlayer(browser, run, { tag: "pc", device: DESKTOP });
    await tracePrograms(p);
    // (CV_PC_TIME=sunset|night: the same PC step at another hour — the lightmap's before/after)
    await join_(p, TIMES[process.env.CV_PC_TIME ?? "day"], "", "pc_join");
    const l = await lots(p);
    run.check("pc: the six lot buildings loaded, none failed", l && l.stats.lots.length === 6 && l.failed.length === 0, { lots: l?.stats.lots, failed: l?.failed, loadMs: l?.loadMs, textures: l?.textures });
    numbers.pcLots = l;
    const dc = await p.page.evaluate(() => window.__cvLotsDoorCheck?.());
    run.check("pc: every swing door sweeps shut → open (20 steps) without touching anything of its building", dc && dc.checked >= 10 && dc.hits.length === 0, { checked: dc?.checked, hits: dc?.hits?.slice(0, 4), perDoor: dc?.perDoor });
    numbers.doorCheck = dc;
    if (!process.env.CV_NO_STREET) await streetShots(p, "pc_day");
    if (process.env.CV_NO_TOUR) {
      for (const unit of ROOMS) await roomTrip(p, unit, "pc");
      await dumpPrograms(p);
      await p.ctx.close();
      return;
    }
    await startFrames(p);
    const load = await sceneLoad(p, "pc");
    await stopFrames(p, "pc_lots_tour");
    const worst = Math.max(...Object.values(load).map((v) => v.triangles));
    // (a frame's triangles count every shadow-cascade pass too; the static budget — 310_000 — is the files' scene triangles, see the report)
    const lotsWorst = Math.max(...Object.values(load).map((v) => v.lots?.triangles ?? 0));
    run.check("pc: the lots draw at most their shells + the nearest lot's detail + one pool (LOD)", lotsWorst <= 13_200 + 20_000 + 40_000 + 3_700, { lotsWorst, frame: Object.fromEntries(Object.entries(load).map(([k, v]) => [k, [v.triangles, v.calls, v.lots?.triangles, v.lots?.draws]])) });
    for (const unit of ROOMS) await roomTrip(p, unit, "pc");
    await dumpPrograms(p);
    await p.ctx.close();
  });
}

if (ONLY.includes("times")) {
  for (const [name, time] of [["sunset", TIMES.sunset], ["night", TIMES.night]]) {
    await run.step(`times: ${name}`, async () => {
      const p = await openPlayer(browser, run, { tag: name, device: DESKTOP });
      await join_(p, time);
      await streetShots(p, `pc_${name}`);
      await roomTrip(p, "lot_chapel_nave", `pc_${name}`);
      await p.ctx.close();
    });
  }
}

if (ONLY.includes("phone")) {
  await run.step("phone (375x812, touch): LOD, two rooms door to door", async () => {
    const p = await openPlayer(browser, run, { tag: "phone", device: PHONE });
    await join_(p, TIMES.day, "", "phone_join");
    const l = await lots(p);
    run.check("phone: the six loaded at the light tier", l && l.tier === "low" && l.device === "phone" && l.failed.length === 0, { tier: l?.tier, textures: l?.textures });
    numbers.phoneLots = l;
    if (process.env.CV_NO_TOUR) {
      // (the rooms only: the lightmaps' before/after on the phone)
      for (const unit of ["lot_church_nave", "lot_chapel_nave"]) await roomTrip(p, unit, "phone");
      await p.ctx.close();
      return;
    }
    // CV_PROFILE=1: a CPU profile of the walk and the long frames' spans (where a hitch spends its time)
    const cdp = process.env.CV_PROFILE ? await p.ctx.newCDPSession(p.page) : null;
    if (cdp) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 250 });
      await cdp.send("Profiler.start");
    }
    const t0 = cdp ? await p.page.evaluate(() => performance.now()) : 0;
    await startFrames(p);
    const load = await sceneLoad(p, "phone");
    const long = await p.page.evaluate(() => window.__l2fLong ?? []);
    await stopFrames(p, "phone_lots_tour");
    if (cdp) {
      const { profile } = await cdp.send("Profiler.stop");
      writeFileSync(join(OUT, "phone_profile.json"), JSON.stringify({ profile, t0, long }));
    }
    const worst = Math.max(...Object.values(load).map((v) => v.triangles));
    // (a frame's triangles count every shadow-cascade pass too; the static budget — 300_000 — is the files' scene triangles, see the report)
    const lotsWorst = Math.max(...Object.values(load).map((v) => v.lots?.triangles ?? 0));
    run.check("phone: the lots draw at most their shells + the nearest lot's detail + one pool (LOD)", lotsWorst <= 13_200 + 20_000 + 14_000 + 3_700, { lotsWorst, frame: Object.fromEntries(Object.entries(load).map(([k, v]) => [k, [v.triangles, v.calls, v.lots?.triangles, v.lots?.draws]])) });
    // (CV_PHONE_TOUR_ONLY=1: the walk round the six only — the hitch comparison runs)
    if (!process.env.CV_PHONE_TOUR_ONLY) for (const unit of ["lot_church_nave", "lot_chapel_nave"]) await roomTrip(p, unit, "phone");
    const l2 = await lots(p);
    run.check("phone: at most two lots in detail", Object.values(l2?.levels ?? {}).filter((v) => v > 0).length <= 2, l2?.levels);
    await p.ctx.close();
  });
}

if (ONLY.includes("before")) {
  await run.step("before: the same street views without the lot buildings (?lots=off)", async () => {
    const p = await openPlayer(browser, run, { tag: "before", device: DESKTOP });
    await join_(p, TIMES.day, "&lots=off", "before_join");
    await streetShots(p, "before_day");
    // the same walk round the six plots without the buildings: the hitch baseline of the village itself
    await startFrames(p);
    await sceneLoad(p, "before");
    await stopFrames(p, "before_lots_tour");
    await p.ctx.close();
  });
}

await browser.close();
writeFileSync(join(OUT, "lots2-walk-numbers.json"), JSON.stringify(numbers, null, 1));
process.exit(run.finish({ numbers }));
