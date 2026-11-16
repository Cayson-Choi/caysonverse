/**
 * e2e/shelter-camera.mjs — visual review r4 (houses-m1): at the bus stop shelter and in front of the flower kiosk the
 * third-person camera. Since owner 2026-11-16 ("건물이나 벽에서는 바뀌도록 하자") the shelter and the kiosk are props: for each of the
 * four facing directions it turns the camera, waits, saves the game view and checks that the camera-to-head distance is the
 * player's zoom unless a building or a wall (not a prop) lies between the head and the camera.
 *
 *   server:  PORT=2863 npx tsx src/index.ts   (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2863 npx vite --port 5463 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5463 node e2e/shelter-camera.mjs [--out=<folder>] [--phone] [--before]
 *
 * `--before` removes the shelter's light-box camera box at runtime, to take the "before" pictures.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PHONE, DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const phone = process.argv.includes("--phone");
const before = process.argv.includes("--before");
const run = createRun(phone ? "shelter-camera-phone" : "shelter-camera");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });
const tag = (phone ? "phone" : "pc") + (before ? "_before" : "_after");

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag, device: phone ? PHONE : DESKTOP });

await run.step("join", async () => {
  await joinVillage(p, "카메라");
  if (before) {
    await p.page.evaluate(async () => {
      const boxes = (await window.__imp("/src/game/activeMap.ts")).getActiveMap().geometry.cameraBoxes;
      const i = boxes.findIndex((b) => b.height === 2.6 && Math.abs(b.maxZ - b.minZ - 1.24) < 1e-6);
      if (i >= 0) boxes.splice(i, 1);
      window.__removedLightBox = i;
    });
  }
});

const DIRS = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] };
const SPOTS = [
  ["shelter", 38.5, -5.2],
  ["kiosk", 45.3, -3.85],
];

for (const [name, x, z] of SPOTS) {
  await run.step(`${name}: four facings`, async () => {
    await walkAndWait(p, 38.5, -0.5, 40000, 1);
    await walkAndWait(p, x, z, 40000, 0.6);
    console.log("at", JSON.stringify(await pos(p)));
    await sleep(800);
    for (const [dir, [dx, dz]] of Object.entries(DIRS)) {
      await turnCameraTo(p, x + dx * 10, z + dz * 10);
      await sleep(2500); // the arm settles (snaps in at once, eases out at 6 m/s)
      const at = await pos(p);
      const info = await p.page.evaluate(async () => {
        const c = window.__cvCamera();
        const at = window.__cv.getPos();
        const cc = await window.__imp("/src/game/cameraCollision.ts");
        const { HEAD_HEIGHT } = await window.__imp("/src/game/constants.ts");
        const arm = Math.hypot(c.x - at.x, c.y - HEAD_HEIGHT, c.z - at.z);
        // the spot the zoom asks for, along the drawn camera's own direction: is a building or a wall (not a prop) on the way?
        const k = arm > 1e-6 ? c.distance / arm : 0;
        const want = [at.x + (c.x - at.x) * k, HEAD_HEIGHT + (c.y - HEAD_HEIGHT) * k, at.z + (c.z - at.z) * k];
        const wall = cc.segmentHitFraction(at.x, HEAD_HEIGHT, at.z, want[0], want[1], want[2], cc.armBoxes(), undefined, cc.cameraPad()) < 1;
        const props = cc.segmentHitFraction(at.x, HEAD_HEIGHT, at.z, want[0], want[1], want[2], cc.cameraBoxes(), undefined, cc.cameraPad()) < 1;
        const r = (n) => Math.round(n * 100) / 100;
        return { cam: [c.x, c.y, c.z].map(r), dist: r(c.distance), arm: r(arm), wall, props };
      });
      await p.page.screenshot({ path: join(OUT, `${name}_${dir}_${tag}.png`) });
      console.log(name, dir, JSON.stringify({ at: [at.x, at.z].map((n) => Math.round(n * 100) / 100), ...info }));
      if (!before) {
        // owner 2026-11-16: the arm is the player's zoom; only a building or a wall (here: the parked bus, the café) may shorten it
        run.check(`${name} ${dir}: the arm is the zoom (${info.dist} m) unless a building or wall is in the way`, info.wall || Math.abs(info.arm - info.dist) < 0.05, info);
      }
    }
  });
}

const code = run.finish();
await browser.close();
process.exit(code);
