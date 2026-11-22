/**
 * e2e/door-shots.mjs — every building door seen OPEN from the player's normal approach (PC): the five lot rooms' oak doors
 * (school, chapel, library, temple, church) held open, and the memorial hall's glass entrance. Shows what is behind the doorway.
 *   CV_CLIENT_URL=http://localhost:5988 node e2e/door-shots.mjs --tag=before [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const tag = arg("tag", "x");
const run = createRun("door-shots");
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const only = arg("only", "")?.split(",").filter(Boolean);
const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A-pc", device: DESKTOP });
await run.step("join", async () => { await joinVillage(A, "Ds", process.env.TIME ?? "2026-11-03T12:30"); });
const doors = await A.page.evaluate(async () => {
  const L = await window.__imp("/shared/src/village/villageLots.ts");
  const G = await window.__imp("/shared/src/village/villageLayout.ts");
  const out = [];
  for (const l of L.VILLAGE_LOTS) for (const d of l.doors) { if (!L.lotRoomOfDoor(d.id)) continue; const p = L.lotDoorPoint(l, d); out.push({ lot: l.id, door: d.id, centre: p.centre, pad: p.pad, kind: "lot" }); }
  const m = G.VILLAGE_LAYOUT.memorial.exterior.doorPad;
  out.push({ lot: "memorial", door: "memorial", centre: { x: m.centre.x, z: m.centre.z + 0.4 }, pad: { x: m.centre.x, z: m.centre.z + 3 }, kind: "hall" });
  return out;
});
console.log(JSON.stringify(doors));
await run.step("shots", async () => {
  const ok = await A.page.waitForFunction(() => { try { return !!window.__cvLots?.()?.ready && window.__cvLots().doors.length >= 5; } catch { return false; } }, null, { timeout: 120000 }).then(() => true, () => false);
  console.log("lots ready", ok);
  await A.page.evaluate(() => window.__cvLotsForce?.(2));
  await sleep(9000);
  for (const d of doors) {
    if (only.length && !only.includes(d.lot)) continue;
    await A.page.evaluate(async ([d]) => {
      if (d.kind === "lot") window.__cvLotsDoor?.(d.door, 1);
      else (await window.__imp("/src/village/PublicAutoDoor.tsx")).autoDoorHold.amount = 1;
    }, [d]);
    const ox = d.pad.x - d.centre.x, oz = d.pad.z - d.centre.z, n = Math.hypot(ox, oz) || 1;
    const dist = Number(arg("dist", 5));
    const eye = { x: d.centre.x + (ox / n) * dist, y: Number(arg("eyey", 1.6)), z: d.centre.z + (oz / n) * dist };
    for (const k of ["a", "b"]) {
      const side = k === "a" ? 0 : 2.2; // a: straight on; b: a little off to the side
      const px = -oz / n, pz = ox / n;
      await A.page.evaluate(([x, y, z, tx, ty, tz]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov: 58 }; }, [eye.x + px * side, eye.y, eye.z + pz * side, d.centre.x, Number(arg("looky", 1.5)), d.centre.z]);
      await sleep(3500);
      await run.shot(A, `${tag}-${d.lot}-${k}.png`);
    }
    await A.page.evaluate(async ([d]) => {
      if (d.kind === "lot") window.__cvLotsDoor?.(d.door, null);
      else (await window.__imp("/src/village/PublicAutoDoor.tsx")).autoDoorHold.amount = null;
    }, [d]);
  }
});
const code = run.finish({});
await b.close();
process.exit(code);
