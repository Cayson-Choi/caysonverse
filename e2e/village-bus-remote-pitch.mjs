/**
 * e2e/village-bus-remote-pitch.mjs — another rider stays drawn whatever way A tilts the view (owner 2026-11-19: "버스에서 상대편이
 * 하체만 보이는 카메라 뷰에서는 하체가 보이는데 카메라뷰를 위로 올리면 상대가 아예 안보여"). Cause: RemotePlayer hid a bus rider WHOLE
 * when its head point was near A's lens and in front of it, so tilting the view up onto that head lost the rider; now only the part
 * of a body right at the lens thins out (avatarFade.ts near fade). A and B board; four layouts (B behind seated A, across the aisle,
 * standing beside A, a step behind A in the aisle); in each, A's third-person pitch sweeps 1.3 .. -0.75 and the first-person
 * pitch 0.9 .. -0.6 (+ = down) looking at B. At every pitch B's meshes must really be drawn to A's camera (their render calls are
 * counted, not just group.visible), and the shot is saved.
 *
 *   OFF=$(node -e 'const n=Date.now()+150000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2899 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:2899 npx vite --port 5499 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5499 node e2e/village-bus-remote-pitch.mjs --out=<folder> [--phone] [--tag=after] [--scen=queue,behind,across,aisle]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, NOON, setOrbit } from "./lib/village.mjs";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const phone = process.argv.includes("--phone");
const label = arg("tag", "run");
const run = createRun(phone ? "village-bus-remote-pitch-phone" : "village-bus-remote-pitch");
const OUT = arg("out", run.evidence);
mkdirSync(OUT, { recursive: true });
const tag = phone ? "phone" : "pc";

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: `A-${tag}`, device: phone ? PHONE : DESKTOP });
const B = await openPlayer(browser, run, { tag: "B-pc", device: DESKTOP });
const sid = (p) => p.page.evaluate(() => window.__cv.getSessionId());
const ride = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/busRide.ts");
    return { slot: m.selfBusRide.slot, walk: { ahead: m.busWalk.ahead, right: m.busWalk.right }, fp: m.busCamState.firstPerson, active: m.busCamState.active };
  });
const tripStatus = (p) => p.page.evaluate(async () => { const s = await window.__imp("/src/net/transitSync.ts"); return s.transitTripAt(s.transitNowMs()).status; });
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
const seatSpot = (p, id) =>
  p.page.evaluate(async (id) => {
    const c = await window.__imp("/shared/src/village/busCabin.ts");
    const index = c.BUS_SEATS.findIndex((s) => s.id === id);
    const ap = c.seatApproachPoint(c.BUS_SEATS[index]);
    return { a: ap.ahead, r: ap.right, index };
  }, id);
async function setFp(p, want) {
  for (let k = 0; k < 4 && (await ride(p)).fp !== want; k++) {
    const b = p.page.getByRole("button", { name: "1인칭/3인칭 전환" }).first();
    if (p.touch) await b.tap({ timeout: 4000 }).catch(() => {});
    else await b.click({ timeout: 4000 }).catch(() => {});
    await sleep(900);
  }
}

async function sitAt(p, id) {
  const spot = await seatSpot(p, id);
  await walkBus(p, spot.a, spot.r, 0.12, 25000);
  await p.page.evaluate(async (i) => (await window.__imp("/src/net/transitSync.ts")).sendBusSit("seat", i), spot.index);
  run.check(`${p.tag} is seated at ${id}`, await waitSlot(p, (n) => n > 0, 5000), await ride(p));
}
async function standUp(p) {
  await p.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).sendBusStand());
  await waitSlot(p, (n) => n === 0, 5000);
  await sleep(600);
}

await run.step("join, board", async () => {
  await joinVillage(A, "에이", NOON);
  await joinVillage(B, "비비", NOON);
  await pollUntil(async () => (await tripStatus(A)) === "boarding", 420000, 500);
  await Promise.all([A, B].map(async (p, k) => {
    await walkAndWait(p, 38.5, -0.5, 60000, 1);
    await walkAndWait(p, 36.9, -6.0 - k * 0.7, 40000, 0.5);
  }));
  for (const p of [A, B]) {
    if (p !== A) await walkAndWait(p, 36.9, -6.0, 20000, 0.4);
    await sleep(500);
    await act(p);
    run.check(`${p.tag} boarded`, await waitSlot(p, (n) => n >= 0, 8000), await ride(p));
  }
});
const idB = await sid(B);

// Real draws, not only group.visible: count the render calls of B's meshes (onBeforeRender) per frame, and say why a mesh is
// skipped (frustum test on its own bounding sphere, an invisible ancestor, the dither cut).
const probeB = (p) =>
  p.page.evaluate(async () => {
    const T = window.__cvThree();
    const three = await window.__imp("/node_modules/.vite/deps/three.js").catch(() => null);
    const groups = [];
    T.scene.traverse((o) => { if ("restingBody" in o && o.isGroup) groups.push(o); });
    const g = groups[0];
    if (!g) return { err: "no remote group" };
    const meshes = [];
    g.traverse((o) => { if (o.isMesh && !o.isSprite && o.geometry?.attributes?.skinIndex) meshes.push(o); });
    for (const m of meshes) {
      if (!m.userData.__cvCount) {
        m.userData.__cvCount = { n: 0 };
        const prev = m.onBeforeRender;
        m.onBeforeRender = function (...a) { if (a[2] === T.camera || a[2]?.isCamera && !a[2].isOrthographicCamera) m.userData.__cvCount.n++; return prev.apply(this, a); };
      }
      m.userData.__cvCount.n = 0;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    const cam = T.camera;
    const out = { draws: meshes.map((m) => m.userData.__cvCount.n), groupVisible: g.visible };
    const ancestorsVisible = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    out.meshes = meshes.map((m) => {
      const r = { name: m.name, visible: m.visible, chain: ancestorsVisible(m), culled: m.frustumCulled, cut: m.material?.userData?.fadeCut?.value };
      if (three) {
        const f = new three.Frustum().setFromProjectionMatrix(new three.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        const sph = (m.boundingSphere ?? m.geometry.boundingSphere).clone().applyMatrix4(m.matrixWorld);
        r.inFrustum = f.intersectsSphere(sph);
        r.sphere = [sph.center.x, sph.center.y, sph.center.z, sph.radius].map((v) => +v.toFixed(2));
        const head = m.skeleton?.bones?.find((b) => /head/i.test(b.name)) ?? m.skeleton?.bones?.[0];
        if (head) { const w = new three.Vector3(); head.getWorldPosition(w); r.bone = [w.x, w.y, w.z].map((v) => +v.toFixed(2)); }
      }
      return r;
    });
    out.group = [g.position.x, g.position.y, g.position.z].map((v) => +v.toFixed(2));
    const e = g.matrixWorld.elements; out.groupWorld = [e[12], e[13], e[14]].map((v) => +v.toFixed(2));
    out.cam = [cam.position.x, cam.position.y, cam.position.z].map((v) => +v.toFixed(2));
    const d = new (three?.Vector3 ?? Object)(); if (three) { cam.getWorldDirection(d); out.camDir = [d.x, d.y, d.z].map((v) => +v.toFixed(2)); }
    return out;
  });

const sampleB = async () => {
  const out = [];
  for (let k = 0; k < 6; k++) {
    const pr = await probeB(A);
    out.push(pr);
    await sleep(120);
  }
  return out;
};
const drawnIn = (pr) => !!pr && !pr.err && pr.draws.some((n) => n > 0);

const report = {};
/** A's first-person look straight at B's body (yaw), then the given pitch (rad, + = down, as viewState.fpPitch). */
async function fpAt(pitch) {
  await A.page.evaluate(async ([idB, pitch]) => {
    const vs = (await window.__imp("/src/game/viewState.ts")).viewState;
    const d = window.__cv.getRemoteDrawn()[idB];
    const T = window.__cvThree();
    const c = T.camera.position;
    vs.fpYaw = Math.atan2(d.x - c.x, d.z - c.z); // the look is (sin yaw, cos yaw) in x/z
    vs.fpPitch = pitch;
  }, [idB, pitch]);
  await sleep(700);
}
const TP_PITCHES = [1.3, 0.9, 0.5, 0.2, -0.2, -0.5, -0.75];
const FP_PITCHES = [0.9, 0.5, 0.2, 0, -0.3, -0.6];
async function sweep(name, quick) {
  run.check(`${name}: both still on the bus`, (await ride(A)).slot >= 0 && (await ride(B)).slot >= 0, { A: await ride(A), B: await ride(B) });
  await setFp(A, false);
  await view(A, quick);
  await sleep(600);
  for (const pitch of TP_PITCHES) {
    await setOrbit(A, null, pitch);
    await sleep(500);
    const s = await sampleB();
    const k = `${name}-tp-${pitch}`;
    await A.page.screenshot({ path: join(OUT, `${label}-${tag}-${k}.png`) });
    report[k] = s.map((x) => ({ draws: x.draws, gv: x.groupVisible, cam: x.cam, camDir: x.camDir, group: x.group }));
    run.check(`${k}: B drawn in every sample`, s.every(drawnIn), report[k][0]);
  }
  await setFp(A, true);
  for (const pitch of FP_PITCHES) {
    await fpAt(pitch);
    const s = await sampleB();
    const k = `${name}-fp-${pitch}`;
    await A.page.screenshot({ path: join(OUT, `${label}-${tag}-${k}.png`) });
    report[k] = s.map((x) => ({ draws: x.draws, gv: x.groupVisible, cam: x.cam, camDir: x.camDir, group: x.group }));
    run.check(`${k}: B drawn in every sample`, s.every(drawnIn), report[k][0]);
  }
}

const SCEN = arg("scen", "behind,across,aisle,queue").split(",");
// 0) Both stand in the aisle, B a step behind A: A's third-person arm passes B's head (owner 2026-11-19: only B's lower body
//    shows with the view tilted down, and B is gone with it tilted up).
if (SCEN.includes("queue"))
  await run.step("B stands a step behind A in the aisle", async () => {
    if ((await ride(A)).slot > 0) await standUp(A);
    // B first (the aisle is not passed): B back to -0.3, A in front of B at 0.5
    await walkBus(B, -0.3, 0, 0.12, 20000);
    await walkBus(A, 0.5, 0, 0.12, 20000);
    run.check("A a step in front of B in the aisle", Math.abs((await ride(A)).walk.ahead - (await ride(B)).walk.ahead - 0.8) < 0.3, { A: await ride(A), B: await ride(B) });
    await sweep("queue", "front");
  });

// 1) B sits right behind A (A at L2, B at L3): A's third-person arm reaches back over B.
if (SCEN.includes("behind"))
  await run.step("A at L2, B right behind at L3", async () => {
    await sitAt(B, "L3");
    await sitAt(A, "L2");
    await sweep("behind", "front");
    await standUp(B);
  });
// 2) B across the aisle (R2), A (at L2) looks out of the right windows over B.
if (SCEN.includes("across"))
  await run.step("B across the aisle at R2", async () => {
    if ((await ride(A)).slot <= 0) await sitAt(A, "L2");
    await sitAt(B, "R2");
    await sweep("across", "right");
    await standUp(B);
  });
// 3) B stands in the aisle right beside seated A.
if (SCEN.includes("aisle"))
  await run.step("B stands in the aisle beside A", async () => {
    if ((await ride(A)).slot <= 0) await sitAt(A, "L2");
    const spot = await seatSpot(B, "L2");
    await walkBus(B, spot.a, spot.r + 0.75, 0.15, 20000);
    await sweep("aisle", "right");
  });
writeFileSync(join(OUT, `${label}-remote-pitch-report-${tag}.json`), JSON.stringify(report, null, 2));
run.finish(report);
await browser.close();
