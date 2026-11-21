/**
 * e2e/solid-walk.mjs — the walker against the props (owner 2026-11-21: trees on the path, flowerbeds, lamp posts, a hedge and benches
 * walked through: "뭐 이렇게 문제가 많은거야"). In the running game, with the real walk (LocalPlayer's loop, the server taking the moves):
 *
 *   1. every flowerbed and hedge, and a sample of every other prop type, is walked INTO from four sides (a straight click-walk at
 *      its middle from 1.5 m off; on a PC also with the W key held; on a phone the beds from two opposite sides, the samples from
 *      four): the body never ends inside it, and it stops at its face;
 *   2. a click ON a prop walks to a spot beside it (the planner's nearest reachable point), never into it;
 *   3. click-to-walk across the open ground (the plaza, the lanes; in the park the promenade, the plaza and the avenue) arrives.
 *
 *   CV_CLIENT_URL=http://localhost:5581 node e2e/solid-walk.mjs [--park] [--phone] [--quick] [--only=lamp,bench]
 *   (--quick: one side instead of four for the beds, for a fast look)
 */
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos, turnCameraTo } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const park = process.argv.includes("--park");
const phone = process.argv.includes("--phone");
const quick = process.argv.includes("--quick");
const area = park ? "park" : "village";
const run = createRun(`solid-walk-${area}-${phone ? "phone" : "pc"}`);
const R = 0.4;

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
}
/** The planned walk (the game's own way round the colliders) to a free spot; the final position. */
let lastGood = null;
async function goTo(p, x, z, tol = 0.6) {
  for (let attempt = 0; attempt < 4; attempt++) {
    // (a body resting in a nook between two props finds no way out on the planner's grid: it steps back to the last open spot first)
    if (attempt > 0 && lastGood) {
      await p.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z, 0), lastGood);
      await sleep(200);
      await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 20000);
    }
    await p.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 8, slack: 60, margin: 60 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(120);
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 120000);
    await sleep(80);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) {
      lastGood = [x, z];
      return at;
    }
  }
  return pos(p);
}
/** A straight walk at (x, z), no plan (what holding a key toward it does): where the body comes to rest. */
async function walkInto(p, x, z) {
  await p.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z, 0), [x, z]);
  await sleep(250); // (the walk gets going)
  let last = await pos(p);
  let still = 0;
  for (let i = 0; i < 120; i++) {
    await sleep(100);
    const { at, target } = await p.page.evaluate(() => ({ at: window.__cv.getPos(), target: window.__cvClickTarget?.() ?? null }));
    still = Math.hypot(at.x - last.x, at.z - last.z) < 0.005 ? still + 1 : 0;
    last = at;
    if (target === null && still >= 2) break;
    if (still >= 5) break;
  }
  await p.page.evaluate(async () => (await window.__imp("/src/game/clickMove.ts")).clearClickTarget());
  await sleep(60);
  return pos(p);
}
/** The game's own click: the plan for a tap on the ground at (x, z), walked; { ok, reason, x, z } and where the body ends. */
async function clickAt(p, x, z) {
  const plan = await p.page.evaluate(
    async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const P = window.__cv.getPos();
      const r = plan.planClickMove(P.x, P.z, { x, y: 0.02, z, ny: 1 }, am.getActiveMap().geometry.obstacles, am.activeBounds(), false);
      if (r.ok) move.setClickTarget(r.x, r.z, r.y ?? 0, r.via);
      return { ok: r.ok, reason: r.reason ?? null, x: r.x ?? null, z: r.z ?? null };
    },
    [x, z],
  );
  if (plan.ok) {
    await sleep(300);
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 120000);
    await sleep(200);
  }
  return { plan, at: await pos(p) };
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const dist = (b, x, z) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A", device: phone ? PHONE : DESKTOP, settings: { graphics: "high" } });

await run.step("join", async () => {
  await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(A);
  await A.page.locator("input.cv-input").first().fill(`Sw${Math.floor(Math.random() * 900 + 100)}`);
  await press(A, A.page.locator(".cv-submit"));
  await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await A.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 * SLOW });
  await sleep(12000);
  await until(async () => await A.page.evaluate(() => !!window.__cvLots?.()?.ready), 120000 * SLOW);
  await sleep(3000);
  if (park) {
    const g = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
    await goTo(A, g.x, g.z - 0.5, 1.0);
    await act(A);
    run.check("in the park", await until(async () => (await areaOf(A)) === "park", 30000 * SLOW));
    await sleep(12000);
  }
});

/** The props of this area: { type, name, box, all } (`all`: walked into from four sides whatever --quick says). */
const props = await A.page.evaluate(
  async ({ park }) => {
    const out = [];
    const sq = (x, z, h) => ({ minX: x - h, maxX: x + h, minZ: z - h, maxZ: z + h });
    const add = (type, name, box, bed = false) => out.push({ type, name, box, bed });
    if (park) {
      const P = await window.__imp("/village/parkArea.ts");
      const I = await window.__imp("/village/parkIslands.ts");
      const B = await window.__imp("/village/parkBenches.ts");
      // every bed and hedge
      I.PARK_ISLANDS.forEach((is, i) => {
        // the island's own boxes joined (its bounding box is too generous for a bent bed: the middle rows are used)
        const pts = [];
        for (let k = 0; k < 64; k++) pts.push(I.islandPoint(is, Math.cos((k / 64) * Math.PI * 2) * 0.55, Math.sin((k / 64) * Math.PI * 2) * 0.55));
        add("island", `island ${i} (${is[0]}, ${is[1]})`, { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)) }, true);
        out[out.length - 1].island = i;
      });
      P.PARK_TROUGHS.forEach((t, i) => add("trough", `trough ${i}`, { minX: t.x0, maxX: t.x1, minZ: t.z0, maxZ: t.z1 }, true));
      P.PARK_PLANTERS.forEach((p, i) => add("planter", `planter ${i}`, { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 }, true));
      for (const x of [60, 250]) add("hedge", `south hedge at x ${x}`, { minX: x - 1.5, maxX: x + 1.5, minZ: P.PARK_SOUTH_HEDGE.face, maxZ: -2.2 }, true);
      // a sample of every other type
      const lamps = P.PARK_LAMPS;
      for (const l of [lamps[0], lamps[9], lamps[lamps.length - 1]]) add("lamp", `lamp (${l.x.toFixed(1)}, ${l.z.toFixed(1)})`, sq(l.x, l.z, 0.17));
      for (const [x, z] of [B.PARK_BENCHES[0], B.PARK_BENCHES[3], B.PARK_BENCHES[9]]) add("bench", `bench (${x}, ${z})`, { minX: x - 0.36, maxX: x + 0.36, minZ: z - 1, maxZ: z + 1 });
      for (const bn of [P.PARK_BINS[0], P.PARK_BINS[4]]) add("bin", `bin (${bn.x}, ${bn.z})`, sq(bn.x, bn.z, 0.3));
      add("fountain", "the star fountain", sq(P.PARK_PLAZA.x, P.PARK_PLAZA.z, P.PARK_FOUNTAIN_RADIUS * 0.7));
      add("kiosk", "the snack kiosk and its counter", { minX: P.PARK_KIOSK.x - P.PARK_KIOSK.w / 2, maxX: P.PARK_KIOSK.x + P.PARK_KIOSK.w / 2, minZ: P.PARK_KIOSK.z - P.PARK_KIOSK.d / 2, maxZ: P.PARK_KIOSK.z + P.PARK_KIOSK.d / 2 + 0.66 });
      add("booth", "the carousel's ticket booth", { minX: P.PARK_TICKET_BOOTH.x - 1.7, maxX: P.PARK_TICKET_BOOTH.x + 1.7, minZ: P.PARK_TICKET_BOOTH.z - 1.5, maxZ: P.PARK_TICKET_BOOTH.z + 1.5 });
      const t = [...P.PARK_TREES].sort((a, c) => Math.hypot(a.x - 40, a.z + 112) - Math.hypot(c.x - 40, c.z + 112))[0];
      add("tree", `tree (${t.x}, ${t.z})`, sq(t.x, t.z, 0.2));
    } else {
      const L = await window.__imp("/village/villageLayout.ts");
      const Lots = await window.__imp("/village/villageLots.ts");
      const SP = await window.__imp("/village/streetPoles.ts");
      const V = await window.__imp("/village/generated/villageVegColliders.ts");
      const BS = await window.__imp("/village/benchSeats.ts");
      // every bed and border of the lots
      for (const lot of Lots.VILLAGE_LOTS) (Lots.LOT_BED_SOLIDS[lot.id] ?? []).forEach((r, i) => add("lot bed", `${lot.id} bed ${i}`, Lots.lotBox(lot, r), true));
      // the plaza's raised beds: six round planters (r 1.5), four square ones (2.2 m), the fountain with its four corner beds
      const rad = (d) => (d * Math.PI) / 180;
      [-118, -62, -16, 40, 65, 138].forEach((d) => add("plaza planter", `round planter ${d}`, sq(19 * Math.cos(rad(d)), 19 * Math.sin(rad(d)), 1.0), true));
      [-135, -65, 75, 140].forEach((d) => add("plaza planter", `square planter ${d}`, sq(24.5 * Math.cos(rad(d)), 24.5 * Math.sin(rad(d)), 1.0), true));
      add("fountain", "the plaza fountain and its corner beds", sq(0, 0, 5.6), true);
      // a house's raised vegetable bed (col__garden_house_1) and the kiosk's planters
      for (const id of ["garden_house_1", "garden_house_6"]) {
        const g = L.greyboxColliders(L.VILLAGE_LAYOUT).find((c) => c.id === id);
        if (g) add("house bed", `${id} (the vegetable bed)`, g.box, true);
      }
      add("kiosk planter", "kiosk planter 1", { minX: 46.1, maxX: 48, minZ: -5.85, maxZ: -5.45 }, true);
      // a sample of every other type
      const lamps = SP.lampSpots(L.VILLAGE_LAYOUT);
      for (const l of [lamps[0], lamps[8], SP.LANE_LAMPS[0]]) add("lamp", `lamp (${l.x.toFixed(1)}, ${l.z.toFixed(1)})`, sq(l.x, l.z, 0.17));
      const benches = BS.VILLAGE_BENCHES.filter((x) => x.area === "village");
      for (const id of ["plaza_1", "plaza_5"]) {
        const bn = benches.find((x) => x.id === id);
        if (bn) add("bench", `bench ${bn.id}`, sq(bn.centre.x, bn.centre.z, 0.3));
      }
      add("bench", "the memorial's bench", { minX: -5.95, maxX: -3.65, minZ: -50.73, maxZ: -50.07 });
      add("pavilion", "the pavilion", { minX: -18.5, maxX: -13.5, minZ: 59.5, maxZ: 64.5 });
      // the plants: the moved temple-lane tree and sidewalk cherry, a bush whose box was added, an orchard trunk
      add("tree", "temple lane tree (moved)", sq(-29.27, -31.51, 0.2));
      add("tree", "sidewalk cherry (moved)", sq(-14.15, 37.74, 0.2));
      const bush = V.VILLAGE_VEG_COLLIDERS.filter((o) => o.maxX - o.minX > 0.8);
      for (const o of bush.slice(0, 3)) add("bush", `bush (${((o.minX + o.maxX) / 2).toFixed(1)}, ${((o.minZ + o.maxZ) / 2).toFixed(1)})`, o);
    }
    return out;
  },
  { park },
);
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
if (onlyArg) {
  const only = onlyArg.slice(7).split(",");
  for (let i = props.length - 1; i >= 0; i--) if (!only.includes(props[i].type)) props.splice(i, 1);
}
console.log(`${props.length} props: ${[...new Set(props.map((p) => p.type))].map((t) => `${t} ${props.filter((p) => p.type === t).length}`).join(", ")}`);

const free = (x, z, r = R + 0.03) =>
  A.page.evaluate(
    async ([x, z, r]) => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const c = await window.__imp("/collision.ts");
      const bd = am.activeBounds();
      return x > bd.minX + r && x < bd.maxX - r && z > bd.minZ + r && z < bd.maxZ - r && !c.isBlocked(x, z, r, am.getActiveMap().geometry.obstacles);
    },
    [x, z, r],
  );

const rows = [];
await run.step("walk into every bed and a sample of every prop, from four sides", async () => {
  for (const p of props) {
    const cx = (p.box.minX + p.box.maxX) / 2, cz = (p.box.minZ + p.box.maxZ) / 2;
    const round = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // east, south, west, north: the next start is a quarter turn on
    // (a phone walks into a bed from its two long sides: a long island's ends are its tips, with no room to start from)
    const wide = p.box.maxX - p.box.minX > p.box.maxZ - p.box.minZ;
    const dirs = p.type === "hedge" ? [round[3]] : phone && p.bed ? (wide ? [round[1], round[3]] : [round[0], round[2]]) : round;
    let tried = 0, inside = 0, stoppedAtFace = 0;
    const notes = [];
    for (const [dx, dz] of quick && p.bed ? dirs.slice(0, 1) : dirs) {
      const half = dx ? (p.box.maxX - p.box.minX) / 2 : (p.box.maxZ - p.box.minZ) / 2;
      let start = null;
      for (const off of [1.5, 1.1, 2.2]) {
        const sx = cx + dx * (half + off), sz = cz + dz * (half + off);
        if (await free(sx, sz)) { start = [sx, sz]; break; }
      }
      if (!start) continue; // a wall, the water or another prop stands on that side
      const at0 = await goTo(A, start[0], start[1]);
      if (Math.hypot(at0.x - start[0], at0.z - start[1]) > 0.7) { notes.push(`start ${dx},${dz} not reached`); continue; }
      tried++;
      const at = await walkInto(A, cx, cz);
      let d = dist(p.box, at.x, at.z);
      // (a planted island is a bent, turned oval: its own outline decides, not the box round its middle. On the bed, a quarter
      // metre in from the kerb, is inside.)
      if (p.island !== undefined) {
        const on = await A.page.evaluate(async ([i, x, z]) => { const I = await window.__imp("/village/parkIslands.ts"); return I.onIsland(I.PARK_ISLANDS[i], x, z, 0.25); }, [p.island, at.x, at.z]);
        d = on ? 0 : Math.max(d, R);
      }
      if (d < R - 0.08) { inside++; notes.push(`from ${dx},${dz}: ended ${d.toFixed(2)} m from it (inside) at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`); }
      if (Math.hypot(at.x - start[0], at.z - start[1]) > 0.3) stoppedAtFace++;
    }
    rows.push({ type: p.type, name: p.name, tried, inside });
    run.check(`${p.type}: ${p.name} — walked into from ${tried} side(s), never inside`, tried > 0 && inside === 0, notes.length ? notes : { tried, moved: stoppedAtFace });
  }
});

if (!phone)
  await run.step("the W key held toward a prop (the keyboard's walk)", async () => {
    for (const p of props.filter((q) => ["lamp", "bench", "island", "lot bed", "plaza planter"].includes(q.type)).filter((_, i) => i % 5 === 0).slice(0, 4)) {
      const cx = (p.box.minX + p.box.maxX) / 2, cz = (p.box.minZ + p.box.maxZ) / 2;
      let start = null;
      for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
        const half = dx ? (p.box.maxX - p.box.minX) / 2 : (p.box.maxZ - p.box.minZ) / 2;
        if (await free(cx + dx * (half + 2), cz + dz * (half + 2))) { start = [cx + dx * (half + 2), cz + dz * (half + 2)]; break; }
      }
      if (!start) continue;
      await goTo(A, start[0], start[1]);
      await turnCameraTo(A, cx, cz);
      await A.page.keyboard.down("KeyW");
      await sleep(3200);
      await A.page.keyboard.up("KeyW");
      await sleep(300);
      const at = await pos(A);
      const d = dist(p.box, at.x, at.z);
      run.check(`W held toward ${p.name}: stopped at its face`, d >= R - 0.08 && d < 2.2, { at: [at.x.toFixed(2), at.z.toFixed(2)], gap: d.toFixed(2) });
    }
  });

await run.step("a click ON a prop walks beside it, never into it", async () => {
  for (const p of props.filter((q, i) => ["lamp", "bench", "island", "trough", "lot bed", "plaza planter", "bush", "tree", "bin"].includes(q.type) && i % 3 === 0).slice(0, 10)) {
    const cx = (p.box.minX + p.box.maxX) / 2, cz = (p.box.minZ + p.box.maxZ) / 2;
    // from a few metres off (a click is on what the screen shows), on whichever side is open
    let start = null;
    for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const half = dx ? (p.box.maxX - p.box.minX) / 2 : (p.box.maxZ - p.box.minZ) / 2;
      if (await free(cx + dx * (half + 3), cz + dz * (half + 3))) { start = [cx + dx * (half + 3), cz + dz * (half + 3)]; break; }
    }
    if (!start) continue;
    const at0 = await goTo(A, start[0], start[1]);
    if (Math.hypot(at0.x - start[0], at0.z - start[1]) > 0.8) continue;
    const { plan, at } = await clickAt(A, cx, cz);
    const d = dist(p.box, at.x, at.z);
    // a planned walk ends beside it (the nearest spot a body stands on, or up to its face); it is never refused as "not ground"
    // (refused only when the body already stands against it: the walk toward it has nowhere to go)
    let against = !plan.ok && plan.reason === "unreachable" && !(await free(at.x + Math.sign(cx - at.x) * 0.6, at.z + Math.sign(cz - at.z) * 0.6, R));
    // (an island: its own outline says whether the body stands at its kerb already, tip or side)
    if (!plan.ok && plan.reason === "unreachable" && p.island !== undefined) {
      against = await A.page.evaluate(async ([i, x, z]) => { const I = await window.__imp("/village/parkIslands.ts"); return I.onIsland(I.PARK_ISLANDS[i], x, z, -1.3); }, [p.island, at.x, at.z]);
    }
    run.check(`click on ${p.name}: walks up to it, the body ends outside it`, (plan.ok || against) && d >= R - 0.08 && d < 3.2, { plan, against, at: [at.x.toFixed(2), at.z.toFixed(2)], gap: d.toFixed(2) });
  }
});

await run.step("click-to-walk across the open ground arrives", async () => {
  const spots = park
    ? [[40, -150], [40, -128], [52, -112], [150, -112], [75, -112], [28, -100], [2, -60], [2, -24], [40, -171]]
    : [[0, 12], [14, 0], [0, -14], [-14, 0], [0, -33], [-30.5, -34.5], [0, -44], [22, 22], [0, 30]];
  for (const [x, z] of spots) {
    const { plan, at } = await clickAt(A, x, z);
    run.check(`click-to-walk to (${x}, ${z}) arrives`, plan.ok && Math.hypot(at.x - plan.x, at.z - plan.z) < 0.6, { plan, at: [at.x.toFixed(2), at.z.toFixed(2)] });
  }
});

const byType = {};
for (const r of rows) {
  (byType[r.type] ??= { props: 0, walks: 0, inside: 0 }).props++;
  byType[r.type].walks += r.tried;
  byType[r.type].inside += r.inside;
}
console.log("\nprop type | props walked into | walks | ended inside");
for (const [t, v] of Object.entries(byType)) console.log(`${t} | ${v.props} | ${v.walks} | ${v.inside}`);
await b.close();
process.exit(run.finish({ byType }));
