/**
 * e2e/door-path-shots.mjs — every walk-in building's door with the path that leads to it (owner 2026-11-28: "도서관 문에 맞게
 * 도로가 연결되어야 이쁘지"). Per door: the player's view (third person behind an avatar walking up the path, looking at the door)
 * and a top-down view of the path's end at the threshold. Also prints the door list (centre, outward direction) as JSON.
 *   CV_CLIENT_URL=http://localhost:5628 node e2e/door-path-shots.mjs --tag=before [--out=<folder>] [--only=lot_library,house_3]
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const tag = arg("tag", "x");
const run = createRun("door-path-shots");
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const only = (arg("only", "") ?? "").split(",").filter(Boolean);
/** Views whose straight line out of the door ends inside another building: from the walk's bend instead. */
const EYE = { house_8: { x: -39.4, z: 32.2 } };
const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A-pc", device: DESKTOP });
await run.step("join", async () => { await joinVillage(A, "Dp", process.env.TIME ?? "2026-11-03T12:30"); });
const doors = await A.page.evaluate(async () => {
  const L = await window.__imp("/shared/src/village/villageLots.ts");
  const G = await window.__imp("/shared/src/village/villageLayout.ts");
  const H = await window.__imp("/shared/src/village/houseExterior.ts");
  const out = [];
  for (const l of L.VILLAGE_LOTS) {
    const d = l.doors[0];
    const p = L.lotDoorPoint(l, d);
    out.push({ id: l.id, centre: p.centre, pad: p.pad });
  }
  for (const h of G.VILLAGE_LAYOUT.sceneryHouses) {
    const c = H.houseLocalToWorld(h, 0, H.HOUSE_BODY_FRONT);
    const o = H.houseLocalToWorld(h, 0, H.HOUSE_BODY_FRONT + 3);
    out.push({ id: h.id, centre: c, pad: o });
  }
  const m = G.VILLAGE_LAYOUT.memorial.exterior.doorPad;
  out.push({ id: "memorial", centre: { x: m.centre.x, z: m.centre.z + 0.4 }, pad: { x: m.centre.x, z: m.centre.z + 3 } });
  return out;
});
console.log(JSON.stringify(doors));
await run.step("shots", async () => {
  await A.page.waitForFunction(() => { try { return !!window.__cvLots?.()?.ready; } catch { return false; } }, null, { timeout: 120000 }).catch(() => {});
  await A.page.evaluate(() => window.__cvLotsForce?.(2));
  await sleep(8000);
  for (const d of doors) {
    if (only.length && !only.includes(d.id)) continue;
    const ox = d.pad.x - d.centre.x, oz = d.pad.z - d.centre.z, n = Math.hypot(ox, oz) || 1;
    const ux = ox / n, uz = oz / n;
    const dist = Number(arg("dist", 11));
    // the player's view: camera behind and above an avatar standing ~6 m out on the path (or on the walk's last bend, where a
    // straight line out of the door runs into another house)
    const eye = EYE[d.id] ?? { x: d.centre.x + ux * dist, z: d.centre.z + uz * dist };
    await A.page.evaluate(([x, y, z, tx, ty, tz]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov: 55 }; }, [eye.x, 3.4, eye.z, d.centre.x, 1.3, d.centre.z]);
    await sleep(3000);
    await run.shot(A, `${tag}-${d.id}-view.png`);
    // top-down over the threshold (screen up = into the building)
    const mx = d.centre.x + ux * 4.5, mz = d.centre.z + uz * 4.5;
    await A.page.evaluate(([x, y, z, tx, ty, tz]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov: 50 }; }, [mx + ux * 0.02, 20, mz + uz * 0.02, mx, 0, mz]);
    await sleep(2500);
    await run.shot(A, `${tag}-${d.id}-top.png`);
  }
  await A.page.evaluate(() => { window.__cvShot = null; });
});
const code = run.finish({});
await b.close();
process.exit(code);
