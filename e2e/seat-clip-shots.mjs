/**
 * e2e/seat-clip-shots.mjs — before / after photos of a seated avatar's back against each seat's backrest (owner 2026-11-20: "낚시터에서
 * 의자에 앉으면 의자 뒤로 옷이 좀 삐져나오던데 그런게 다른데는 없는지 잘 찾아봐").
 *
 * One PC player in the bulkiest look (curly hair, hoodie, long skirt) sits on each seat of SEATS, and a back view and a side view are
 * taken with the back flattening OFF (`window.__cvNoBackSquash`, the old look) and ON (the fix). Shots: <out>/<seat>-<back|side>-<before|after>.png
 *
 *   CV_CLIENT_URL=http://localhost:5961 node e2e/seat-clip-shots.mjs --out=D:/ClaudeCode/tmpshots/seat-clip [--only=lake:chair_P05,plaza_1]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, launchBrowser, openPlayer, pos, press, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const OUT = outArg ? outArg.slice(6) : "D:/ClaudeCode/tmpshots/seat-clip";
const ONLY = onlyArg ? onlyArg.slice(7).split(",") : null;
const run = createRun("seat-clip-shots");
mkdirSync(OUT, { recursive: true });

// id prefix → where to stand first (a waypoint on open ground) is found by the game's own detour search; the seat is picked by id
const HOUSE_SEATS = ["h1_1_0"]; // house 1's sofa (keypad 1004), after the village seats
const SEATS = [
  "lake:chair_P05",
  "lake:chair_A1",
  "plaza_1:",
  "cafe_terrace_1",
  "lake:bench_1_1",
  "shelter:",
  "house_2_porch",
];

const LOOK = {
  hat: 0, hatColor: 2, hair: 4, hairColor: 1, face: 0, skin: 0, top: 1, topColor: 6, bottom: 3, bottomColor: 7, shoes: 0, shoesColor: 0, item: 0, itemColor: 2, voice: 0,
};

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A-pc", device: DESKTOP });
await A.ctx.addInitScript((look) => {
  try {
    localStorage.setItem("cv.entry", JSON.stringify({ nickname: "sitter", appearance: look }));
  } catch {}
}, LOOK);
await run.step("join", async () => {
  await joinVillage(A, "cl");
});

async function goTo(x, z, tol = 0.5) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await A.page.evaluate(
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
    const t0 = Date.now();
    while (Date.now() - t0 < 40000) {
      await sleep(250);
      const p = await pos(A);
      if (Math.hypot(p.x - x, p.z - z) < tol) return p;
    }
  }
  return pos(A);
}

async function zoomTo(distance) {
  // never into first person (the wheel past the closest third-person distance flips the view): V back if it did
  const mode = () => A.page.evaluate(() => window.__cv.getView().mode);
  const vp = A.page.viewportSize();
  await A.page.mouse.move(vp.width / 2, vp.height / 2);
  for (let k = 0; k < 14; k++) {
    const o = await A.page.evaluate(() => window.__cv.getOrbit());
    if (Math.abs(o.distance - distance) < 0.4) break;
    await A.page.mouse.wheel(0, (distance - o.distance) * 100);
    await sleep(250);
    if ((await mode()) !== "tp") {
      await A.page.keyboard.press("KeyV");
      await sleep(1200);
      break;
    }
  }
}

const shot = async (name) => A.page.screenshot({ path: `${OUT}/${name}.png` });

async function oneSeat(id) {
  await run.step(`seat ${id}`, async () => {
    const info = await A.page.evaluate(async (id) => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const tap = await window.__imp("/src/game/seatTap.ts");
      const seats = am.VILLAGE_ACTIVE_MAP.seats;
      const idx = seats.findIndex((s) => String(s.id).startsWith(id));
      if (idx < 0) return null;
      const g = tap.seatApproachGoal(seats, idx, am.VILLAGE_ACTIVE_MAP.geometry.obstacles, am.VILLAGE_ACTIVE_MAP.bounds);
      const s = seats[idx];
      return { idx, goal: g, yaw: s.yaw, x: s.x, z: s.z, standX: s.standX, standZ: s.standZ, face: s.id };
    }, id);
    if (!info || !info.goal) return run.check(`${id}: a seat with an approach spot`, false, info);
    // the pier needs the walk along it first (the chair's own stand spot), then the approach spot
    await goTo(info.standX, info.standZ, 1.2);
    await goTo(info.goal.x, info.goal.z, 0.5);
    await sleep(600);
    await act(A);
    await sleep(3500);
    let sat = await pos(A);
    console.log("after act", JSON.stringify(sat), JSON.stringify(info.goal), await A.page.locator(".cv-action-btn").allTextContents());
    if (sat.seatIndex !== info.idx) {
      await goTo(info.goal.x, info.goal.z, 0.3);
      await act(A);
      await sleep(3500);
      sat = await pos(A);
    }
    if (!run.check(`${id}: seated`, sat.seatIndex === info.idx, [sat.seatIndex, info.idx])) return;
    await shot(`${String(info.face).replace(/[^a-zA-Z0-9]+/g, "_")}-dbg-seated`);
    await A.page.evaluate(() => (window.__cvNoBackSquash = false));
    if ((await A.page.evaluate(() => window.__cv.getView().mode)) !== "tp") {
      await A.page.keyboard.press("KeyV");
      await sleep(1500);
    }
    console.log("view", await A.page.evaluate(() => window.__cv.getView().mode));
    console.log("orbit", JSON.stringify(await A.page.evaluate(() => window.__cv.getOrbit())));
    await zoomTo(3.4);
    const dx = Math.sin(info.yaw);
    const dz = Math.cos(info.yaw);
    const slug = String(info.face).replace(/[^a-zA-Z0-9]+/g, "_");
    const views = [
      ["back", sat.x + dx * 6, sat.z + dz * 6],
      ["side", sat.x + dz * 6, sat.z - dx * 6],
    ];
    for (const [name, tx, tz] of views) {
      await turnCameraTo(A, tx, tz);
      for (const mode of ["before", "after"]) {
        await A.page.evaluate((m) => (window.__cvNoBackSquash = m === "before"), mode);
        await sleep(1400);
        if (mode === "before") console.log("orbit", name, JSON.stringify(await A.page.evaluate(() => window.__cv.getOrbit())));
        await shot(`${slug}-${name}-${mode}`);
      }
    }
    await A.page.evaluate(() => (window.__cvNoBackSquash = false));
    // up again: the same key the game uses
    await A.page.keyboard.press("KeyW");
    await sleep(2500);
  });
}

for (const id of SEATS) {
  if (ONLY && !ONLY.includes(id)) continue;
  await oneSeat(id);
}
if (!ONLY || ONLY.some((i) => HOUSE_SEATS.includes(i))) {
  await run.step("into house 1 (the keypad)", async () => {
    for (const [x, z] of [[0, 14], [0, -20], [15, -34], [21, -37.15], [21, -39.3]]) await walkAndWait(A, x, z, 40000, 1.2);
    await act(A);
    await A.page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
    for (const c of "1004") await press(A, A.page.locator(`.cv-keypad button[data-key="${c}"]`));
    await press(A, A.page.locator('.cv-keypad button[data-key="ok"]'));
    await sleep(8000);
  });
  for (const id of HOUSE_SEATS) await oneSeat(id);
}

await b.close();
process.exit(run.finish({ client: CLIENT_URL }));
