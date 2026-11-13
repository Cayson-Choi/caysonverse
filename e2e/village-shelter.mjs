/**
 * e2e/village-shelter.mjs — the bus stop's shelter (2026-11-13, fix/shelter-bench): (1) the stop area has no old shelter;
 * (2) its bench can be sat on, from the road side only (E on a PC, the 앉기 button on a phone); (3) a jump inside the shelter
 * keeps the head under the roof while a jump in the open is the full 1 m hop.
 *
 *   server:  PORT=2861 npx tsx src/index.ts   (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2861 npx vite --port 5461 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5461 node e2e/village-shelter.mjs [--out=<folder>] [--phone]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PHONE, DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const phone = process.argv.includes("--phone");
const run = createRun(phone ? "village-shelter-phone" : "village-shelter");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });
const tag = phone ? "phone" : "pc";

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag, device: phone ? PHONE : DESKTOP });
await p.ctx.addInitScript(() => performance.setResourceTimingBufferSize(5000));

/** Draw the scene once from a test camera (the game camera stays) and save it. */
async function render(file, eye, look, fov = 45) {
  const url = await p.page.evaluate(
    ([eye, look, fov]) => {
      const { gl, scene, camera } = window.__cvThree();
      const cam = camera.clone();
      cam.fov = fov;
      cam.near = 0.05;
      cam.position.set(...eye);
      cam.lookAt(...look);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      gl.render(scene, cam);
      return gl.domElement.toDataURL("image/png");
    },
    [eye, look, fov],
  );
  writeFileSync(join(OUT, file), Buffer.from(url.split(",")[1], "base64"));
}
const shot = (name) => p.page.screenshot({ path: join(OUT, name) });

/** The local avatar's top (m above its feet): the highest vertex of its meshes, skinned (the pose it stands in). */
const avatarTop = () =>
  p.page.evaluate(() => {
    const at = window.__cv.getPos();
    const { scene } = window.__cvThree();
    let group = null;
    scene.traverse((o) => {
      if (!group && o.isGroup && Math.abs(o.position.x - at.x) < 1e-3 && Math.abs(o.position.z - at.z) < 1e-3) group = o;
    });
    if (!group) return null;
    group.updateMatrixWorld(true);
    const v = new scene.position.constructor();
    let top = -Infinity;
    group.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes.position || o.name === "shadow") return;
      if (o.isSkinnedMesh) o.skeleton.update();
      for (let i = 0; i < o.geometry.attributes.position.count; i++) {
        if (o.isSkinnedMesh) o.getVertexPosition(i, v);
        else v.fromBufferAttribute(o.geometry.attributes.position, i);
        v.applyMatrix4(o.matrixWorld);
        top = Math.max(top, v.y - group.position.y);
      }
    });
    return top;
  });

/** Press the jump (Space, or the touch button) and sample the lift for the whole hop: returns { max, samples }. */
async function hop(renderAt) {
  await p.page.evaluate(() => {
    window.__lift = [];
    window.__lt = setInterval(() => window.__imp("/src/game/jump.ts").then((m) => window.__lift.push(m.getLocalLift())), 16);
  });
  if (phone) await p.page.locator(".cv-jump-btn, [data-action='jump'], button[aria-label*='점프']").first().tap();
  else await p.page.keyboard.press("Space");
  if (renderAt) {
    await sleep(renderAt.wait);
    await renderAt.fn();
  }
  await sleep(1000);
  const lift = await p.page.evaluate(() => {
    clearInterval(window.__lt);
    return window.__lift;
  });
  return { max: Math.max(0, ...lift), n: lift.length };
}

await run.step("join", async () => {
  await joinVillage(p, "정류장");
  const seats = await p.page.evaluate(async () => (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.map((s) => ({ ...s })));
  p.seats = seats;
  run.check("22 bench seats in the village and the hall (ten benches, two each, and the shelter's)", seats.filter((s) => s.area === "village" || s.area === "hall").length === 22, seats.length);
  p.shelter = seats.map((s, i) => ({ ...s, i })).filter((s) => s.bench === "shelter");
  run.check("two shelter seats", p.shelter.length === 2, p.shelter.map((s) => s.i));
});

await run.step("the stop area from the owner's angle: no old shelter", async () => {
  await walkAndWait(p, 38.5, -0.5, 40000, 1);
  await sleep(1200);
  await render("stop-owner.png", [36, 4.5, 3], [39.5, 1, -5.5], 50);
  await render("stop-west-top.png", [30, 7, -5], [39, 0.5, -5.5], 50);
  await render("stop-overview.png", [48, 8, 4], [38, 0.5, -5.5], 60);
  await shot(`stop-game-${tag}.png`);
  const urls = await p.page.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => /village(_lm|_lm_night|_signals|_busstop)?\.(glb|webp)/.test(n)));
  run.check("the model files are fetched with ?v=", urls.length > 0 && urls.every((u) => u.includes("?v=")), urls.map((u) => u.replace(/^https?:\/\/[^/]+/, "")));
});

await run.step("sit on the shelter bench", async () => {
  const s = p.shelter[0];
  await walkAndWait(p, s.standX, s.standZ, 30000, 0.3);
  await sleep(600);
  const label = await p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? "");
  run.check("the action button offers 앉기 in front of the bench", label.includes("앉기"), label);
  await shot(`sit-offer-${tag}.png`);
  await act(p);
  const ok = await p.page.waitForFunction((i) => window.__cv.getPos().seatIndex === i, s.i, { timeout: 8000 }).then(() => true, () => false);
  run.check(`seated on seat ${s.i}`, ok, await pos(p));
  await sleep(2200);
  await shot(`sit-game-${tag}.png`);
  const at = await pos(p);
  await render(`sit-front-${tag}.png`, [at.x - 3.2, 1.5, at.z + 0.4], [at.x, 0.8, at.z], 42);
  await render(`sit-side-${tag}.png`, [at.x - 0.6, 1.3, at.z - 3.2], [at.x, 0.8, at.z], 42);
  await render(`sit-behind-${tag}.png`, [at.x + 3.2, 3.2, at.z + 1.2], [at.x - 0.5, 0.7, at.z], 45);
  run.check("a sitter faces the road (west)", Math.abs(Math.sin(at.yaw) + 1) < 0.05, at.yaw);
  await act(p); // E again / the stand button: get up
  const up = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 8000 }).then(() => true, () => false);
  run.check("stood up again", up, await pos(p));
  await sleep(1500);
});

await run.step("jump under the shelter roof and in the open", async () => {
  await walkAndWait(p, 40.6, -4.9, 30000, 0.3);
  await sleep(800);
  const inside = await pos(p);
  const under = await hop({
    wait: 380,
    fn: async () => {
      const at = await pos(p);
      await render(`jump-shelter-side-${tag}.png`, [at.x - 0.4, 1.9, at.z - 4.6], [at.x, 1.8, at.z], 38);
      await shot(`jump-shelter-game-${tag}.png`);
    },
  });
  const top = await avatarTop();
  const head = under.max + top;
  run.check("in the shelter the head stays under the roof's underside (2.55 m)", under.max > 0.1 && head < 2.55, { lift: under.max, avatarTop: top, headTop: head, at: inside });
  await sleep(500);
  await walkAndWait(p, 24, 12, 40000, 0.8);
  await sleep(800);
  const open = await hop({
    wait: 380,
    fn: async () => {
      const at = await pos(p);
      await render(`jump-open-side-${tag}.png`, [at.x - 0.4, 1.9, at.z - 4.6], [at.x, 1.8, at.z], 38);
      await shot(`jump-open-game-${tag}.png`);
    },
  });
  run.check("in the open the hop is the full 1 m", Math.abs(open.max - 1.0) < 0.03, open.max);
});

const code = run.finish();
await browser.close();
process.exit(code);
