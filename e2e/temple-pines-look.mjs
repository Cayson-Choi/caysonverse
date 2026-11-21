/**
 * e2e/temple-pines-look.mjs — the temple yard's red pines (소나무, 2026-11-21) from fixed camera poses in the real game: the owner's
 * framing by the lotus pond, the whole yard, the bark close up, from below; PC (high) and phone (low), day / dusk / night. Also the
 * pines' own numbers (triangles, draws, texture MB) from `window.__cvTemplePines`.
 *
 *   CV_CLIENT_URL=http://localhost:5631 node e2e/temple-pines-look.mjs --out <dir> --tag before|after
 *        [--device pc|phone] [--times noon,dusk,night] [--poses owner,yard,bark,below]
 *
 * The camera is pinned through the DEV hook's scene (`scene.onBeforeRender`, as e2e/falls-look.mjs); the lots pick their detail
 * from the camera, so the temple's detail (and its pines) show at the pinned eye.
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { CLIENT_URL, DESKTOP, PHONE, entryReady, press, sleep } from "./lib/common.mjs";

const { values: args } = parseArgs({
  options: {
    device: { type: "string", default: "pc" },
    times: { type: "string", default: "noon" },
    poses: { type: "string", default: "owner,yard,bark,below" },
    out: { type: "string" },
    tag: { type: "string", default: "after" },
    query: { type: "string", default: "" },
  },
});
const OUT = args.out ?? join(process.cwd(), "temple-pines-out");
mkdirSync(OUT, { recursive: true });
const TIMES = { noon: "12:00", golden: "16:40", dusk: "17:25", night: "21:00" };

/** Poses (game metres): eye, target, vertical fov. The pines stand at (-44.2,-27), (-53.2,-27.5), (-56.9,-47), (-41.1,-45.6). */
const POSES = {
  // the owner's screenshot: the pine beside the lotus pond, the yard's stone wall behind it, looking a little up
  owner: { eye: [-40.6, 1.9, -38.4], target: [-41.1, 4.6, -45.6], fov: 60 },
  owner2: { eye: [-44.0, 1.9, -38.0], target: [-41.1, 4.6, -45.6], fov: 60 },
  // the whole yard from its entrance side, above head height
  yard: { eye: [-34.0, 7.5, -20.0], target: [-49.5, 3.5, -38.0], fov: 60 },
  yard2: { eye: [-62.0, 6.0, -20.0], target: [-49.0, 3.5, -38.0], fov: 60 },
  // the bark: the trunk of the pine by the pond, close
  bark: { eye: [-40.0, 1.6, -43.4], target: [-41.1, 1.8, -45.6], fov: 55 },
  // from below: under the crown looking up into the limbs
  below: { eye: [-42.4, 1.5, -44.4], target: [-40.6, 7.5, -46.2], fov: 70 },
  top: { eye: [-49.0, 45.0, -36.9], target: [-49.0, 0, -37.0], fov: 50 },
  // the other pines
  north: { eye: [-48.6, 2.0, -18.0], target: [-48.6, 4.5, -27.2], fov: 60 },
  far: { eye: [-49.0, 2.0, -36.0], target: [-56.9, 4.5, -47.0], fov: 60 },
};

let seq = 0;
async function join_(browser, time, device) {
  const ctx = await browser.newContext({ ...(device === "phone" ? PHONE : DESKTOP) });
  await ctx.addInitScript((graphics) => {
    try {
      localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true, graphics }));
    } catch {}
  }, device === "phone" ? "low" : "high");
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/glGetProgramiv|X3595|WebGLProgram: Program Info Log/.test(t)) return;
    errors.push(t.slice(0, 300));
  });
  const q = new URLSearchParams({ time: `2026-11-03T${TIMES[time] ?? time}` });
  for (const kv of args.query.split("&").filter(Boolean)) q.set(...kv.split("="));
  await page.goto(`${CLIENT_URL}/?${q}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  const p = { page, touch: device === "phone" };
  await entryReady(p);
  await page.locator("input.cv-input").first().fill(`솔${++seq}`);
  await press(p, page.locator(".cv-submit"));
  await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(2500);
  // the temple's pines are made once the lots have loaded
  await page.evaluate(() => (window.__pin = { eye: [-34, 7.5, -20], target: [-49.5, 3.5, -38], fov: 60 }));
  await page.evaluate(() => {
    const { scene, camera } = window.__cvThree();
    scene.onBeforeRender = () => {
      const { eye, target, fov } = window.__pin;
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.lookAt(target[0], target[1], target[2]);
      if (camera.fov !== fov) (camera.fov = fov), camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    };
  });
  await page.waitForFunction(() => { let n = 0; window.__cvThree().scene.traverse((o) => { if (/^temple_pine/.test(o.name)) n++; }); return n > 0; }, null, { timeout: 120000 }).catch(() => console.log("no pines found"));
  await sleep(3000);
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = "hidden";
  });
  return { ctx, page, errors };
}

async function pin(page, pose) {
  await page.evaluate((pose) => {
    const { scene, camera } = window.__cvThree();
    scene.onBeforeRender = () => {
      const { eye, target, fov } = window.__pin;
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(target[0], target[1], target[2]);
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.updateMatrixWorld(true);
    };
    window.__pin = pose;
  }, pose);
  // the temple's detail level follows the camera, its textures come in after
  await sleep(4000);
}

/** The pines' triangles / draws / texture bytes (the meshes named temple_pine*), and the frame's totals. */
const pineStats = (page) =>
  page.evaluate(() => {
    const { scene, gl } = window.__cvThree();
    let tris = 0;
    let draws = 0;
    let shown = 0;
    const tex = new Map();
    scene.traverse((o) => {
      if (!o.isMesh || !/^temple_pine/.test(o.name)) return;
      let vis = true;
      for (let e = o; e; e = e.parent) if (!e.visible) vis = false;
      const g = o.geometry;
      const t = (g.index ? g.index.count : g.getAttribute("position").count) / 3;
      const n = o.isInstancedMesh ? o.count : 1;
      tris += t * n;
      draws += 1;
      if (vis) shown += 1;
      for (const key of ["map", "normalMap", "alphaMap"]) {
        const tx = o.material[key];
        const img = tx?.image;
        if (img?.width) tex.set(tx.uuid, img.width * img.height * 4 * (4 / 3));
      }
      const u = o.material.userData?.vegUniforms?.uVegNormal?.value?.image;
      if (u?.width) tex.set(`n${o.material.uuid}`, u.width * u.height * 4 * (4 / 3));
    });
    const info = window.__cvRenderInfo?.() ?? null;
    return { tris, draws, shown, texMB: Math.round(([...tex.values()].reduce((a, b) => a + b, 0) / 1048576) * 10) / 10, frame: info };
  });

const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const results = [];
try {
  for (const time of args.times.split(",")) {
    const { ctx, page, errors } = await join_(browser, time, args.device);
    for (const name of args.poses.split(",")) {
      const pose = POSES[name];
      if (!pose) throw new Error(`no pose ${name}`);
      await pin(page, pose);
      const file = `${args.tag}-${args.device}-${time}-${name}.png`;
      await page.screenshot({ path: join(OUT, file) });
      const s = await pineStats(page);
      results.push({ pose: name, time, device: args.device, file, ...s });
      console.log(JSON.stringify({ file, ...s }));
    }
    if (errors.length) console.log("errors:", JSON.stringify(errors.slice(0, 8)));
    results.push({ time, errors });
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `${args.tag}-${args.device}-stats.json`), JSON.stringify(results, null, 2));
