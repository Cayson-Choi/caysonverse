/**
 * e2e/street-look.mjs — the lamp posts and street banners (street/, 2026-11-16): first-person looks at a banner pole, a lamp
 * post's head and base, and the plaza from street distance, by day and by night, the new ones or the model's own (`--old`:
 * the DEV flag `?street=old`). HUD hidden.
 *
 *   CV_CLIENT_URL=http://localhost:5781 node e2e/street-look.mjs [--out=<dir>] [--tag=after] [--old]
 *        [--times=12:30,21:00] [--devices=desktop,phone] [--views=street,banner,lamp,base,lake]
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";

const run = createRun("street-look");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OLD = args.includes("--old");
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const DATE = opt("date", "2026-11-16");
const TAG = opt("tag", OLD ? "before" : "after");
const TIMES = opt("times", "12:30,21:00").split(",");
const DEVICES = opt("devices", "desktop").split(",");

const deg = (r) => (r * 180) / Math.PI;
// azimuth (deg clockwise from north = -z) and radius -> [x, z]
const polar = (az, r) => [r * Math.sin((az * Math.PI) / 180), -r * Math.cos((az * Math.PI) / 180)];
// the plaza ring (streetLayout.ts PLAZA_RING: r 29, 7 posts from 14.5 deg)
const ring = (k) => polar(14.5 + (k * 360) / 7, 29);
const MEM = ring(0);
const LAKE = ring(2);
const VIL = ring(6);
// each view: where the avatar stands, what it looks at (x, y, z); `tp`: the third-person camera (the owner's angle);
// `top`: the overview from above
const VIEWS = {
  street: { via: [[14, 2]], at: [13, -10], look: [0, 3.0, -26] },
  banner: { via: [[-14, 2]], at: polar(333, 24.5), look: [VIL[0], 3.35, VIL[1]] },
  lake: { via: [[14, 2]], at: polar(108, 25), look: [LAKE[0], 3.35, LAKE[1]] },
  lamp: { via: [[14, 2]], at: polar(17, 26.6), look: [MEM[0], 4.4, MEM[1]] },
  base: { at: polar(17, 26.6), look: [MEM[0], 0.35, MEM[1]] },
  edge: { tp: true, via: [[0, 20]], at: polar(150, 22), look: [...polar(168, 40)] },
  top: { top: true, at: [0, 14] },
};
const NAMES = opt("views", "street,banner,lake,lamp,base,edge,top").split(",").filter((v) => v in VIEWS);

let nickSeq = 0;
async function joinVillage(p, time) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`${DATE}T${time}`)}${OLD ? "&street=old" : ""}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`등${++nickSeq}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 90000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(3000);
}
const hideHud = (p) =>
  p.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = "hidden";
  });

const all = {};
const browser = await launchBrowser();
try {
  for (const dev of DEVICES) {
    for (const time of TIMES) {
      const P = await openPlayer(browser, run, { tag: dev, device: dev === "phone" ? PHONE : DESKTOP, settings: { graphics: dev === "phone" ? "low" : "high" } });
      await run.step(`${dev} ${time}`, async () => {
        await joinVillage(P, time);
        // what of the baked posts is left in the village clone: triangles standing within 0.3 m of a post's axis
        const left = await P.page.evaluate(async () => {
          const L = await window.__imp("/src/village/street/streetLayout.ts");
          const root = window.__cvVillage().root;
          root.updateMatrixWorld(true);
          const hits = {};
          const v = [0, 0, 0].map(() => ({ x: 0, y: 0, z: 0 }));
          root.traverse((o) => {
            if (!o.isMesh || o.isInstancedMesh || /^(village_sky|village_water|village_backdrop|col__)/.test(o.name)) return;
            const g = o.geometry;
            const pos = g.getAttribute("position");
            const idx = g.index;
            const n = idx ? idx.count : pos.count;
            const e = o.matrixWorld.elements;
            for (let t = 0; t < n; t += 3) {
              let inAll = true;
              let maxY = -1e9;
              for (let k = 0; k < 3; k++) {
                const i = idx ? idx.getX(t + k) : t + k;
                const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
                const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
                maxY = Math.max(maxY, wy);
                if (![...L.LAMP_POSTS, ...L.OLD_PLAZA_LAMPS].some((p) => Math.hypot(wx - p.x, wz - p.z) < 0.3 && wy < p.lightY + 0.5)) inAll = false;
              }
              if (inAll && maxY > 0.1) hits[o.name] = (hits[o.name] ?? 0) + 1;
            }
          });
          return hits;
        });
        run.check("no baked lamp-post triangles left in the village", OLD || Object.keys(left).length === 0, left);
        for (const name of NAMES) {
          const v = VIEWS[name];
          for (const w of v.via ?? []) await walkAndWait(P, w[0], w[1], 60000, 1.5);
          const me = await walkAndWait(P, v.at[0], v.at[1], 90000, 0.9);
          await hideHud(P);
          if (v.top) {
            await P.page.evaluate(async () => {
              const vs = await window.__imp("/src/game/viewState.ts");
              vs.enterOverview();
            });
            await sleep(2500);
            await P.page.evaluate(async () => {
              const vs = await window.__imp("/src/game/viewState.ts");
              vs.viewState.ovCenterX = 0;
              vs.viewState.ovCenterZ = 0;
              vs.viewState.ovHeight = 62;
            });
            await sleep(2500);
            const base = `${TAG}-${dev}-${time.replace(":", "")}-${name}`;
            await run.shot(P, `${base}.png`);
            await P.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).dropOverview());
            await sleep(800);
            continue;
          }
          if (v.tp) {
            await P.page.evaluate(async () => {
              const vs = await window.__imp("/src/game/viewState.ts");
              if (vs.viewState.mode === "fp") vs.exitFp(window.__cv.getOrbit());
            });
            await sleep(1200);
            await turnCameraTo(P, v.look[0], v.look[1]);
            await sleep(2500);
            const base = `${TAG}-${dev}-${time.replace(":", "")}-${name}`;
            await run.shot(P, `${base}.png`);
            continue;
          }
          await P.page.evaluate(async ([look, me]) => {
            const vs = await window.__imp("/src/game/viewState.ts");
            if (vs.viewState.mode !== "fp") vs.enterFp(0);
            const cam = window.__cvThree().camera.position;
            const dx = look[0] - me.x;
            const dz = look[2] - me.z;
            const az = Math.atan2(dx, -dz); // clockwise from north (-z)
            vs.viewState.fpYaw = -az;
            vs.viewState.fpPitch = -Math.atan2(look[1] - (cam.y || 1.5), Math.hypot(dx, dz)); // + looks down
          }, [v.look, me]);
          await P.page.waitForFunction(() => window.__cv.getView().blend >= 0.995, null, { timeout: 15000 }).catch(() => {});
          await sleep(2500);
          // second pass on the pitch, now that the eye height is the first-person one
          await P.page.evaluate(async ([look]) => {
            const vs = await window.__imp("/src/game/viewState.ts");
            const c = window.__cvThree().camera.position;
            vs.viewState.fpPitch = -Math.atan2(look[1] - c.y, Math.hypot(look[0] - c.x, look[2] - c.z));
          }, [v.look]);
          await sleep(1500);
          const base = `${TAG}-${dev}-${time.replace(":", "")}-${name}`;
          await run.shot(P, `${base}.png`);
          if (name === "banner") {
            // the wind: a second frame a moment later (the fabric must have moved)
            await sleep(700);
            await run.shot(P, `${base}-wind.png`);
          }
          all[base] = await P.page.evaluate(() => ({ street: window.__cvStreet?.() ?? null, cam: window.__cvThree().camera.position.toArray().map((n) => Math.round(n * 100) / 100), errors: window.__cvErrors?.length ?? 0 }));
          console.log(`   ${base}: ${JSON.stringify(all[base])}`);
        }
      });
      await P.ctx.close();
    }
  }
} finally {
  await browser.close();
}
void deg;
writeFileSync(join(OUT, `${TAG}-stats.json`), JSON.stringify(all, null, 2));
process.exit(run.finish({ all }));
