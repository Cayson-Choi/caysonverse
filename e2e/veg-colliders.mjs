/**
 * e2e/veg-colliders.mjs — the village's trunks and bushes AS DRAWN, written out as the collider table the game plays on
 * (shared/src/village/generated/villageVegColliders.ts; owner 2026-11-21: bushes and trunks were walked through).
 *
 * The village.glb's own col__tree / col__bush / col__shrub boxes mark where the art script planted them; the game then grows the
 * plants itself (veg/villageVegetation.ts): bushes are found again from the leaf cards, boundary rows are varied, plants are moved off
 * houses and paths. So a box and its plant can stand apart: a bush with no box, a box with no bush. This script asks the running game
 * for every trunk and bush it drew (DEV hooks __cvTrunkList / __cvBushList) and writes
 *   - VILLAGE_VEG_COLLIDERS: a box for every drawn trunk / ground bush the model's boxes do not already hold, and
 *   - VILLAGE_VEG_GHOSTS: the model's plant boxes with no plant drawn in them (taken out of the game's colliders).
 * Run it again after any change to the village's vegetation; e2e/solid-audit.mjs fails when the table is stale.
 *
 *   CV_CLIENT_URL=http://localhost:5581 node e2e/veg-colliders.mjs [--check] [--dump=<file.json>]
 *   (--check: write nothing, exit 1 when the table on disk differs from what the game draws)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, REPO, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const check = process.argv.includes("--check");
const dumpArg = process.argv.find((a) => a.startsWith("--dump="));
const run = createRun("veg-colliders");
const TABLE = join(REPO, "shared", "src", "village", "generated", "villageVegColliders.ts");

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A", device: DESKTOP, settings: { graphics: "high" } });
await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(A);
await A.page.locator("input.cv-input").first().fill(`Vc${Math.floor(Math.random() * 900 + 100)}`);
await press(A, A.page.locator(".cv-submit"));
await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
await A.page.waitForFunction(() => !!window.__cvBushList?.village && !!window.__cvTrunkList?.village, null, { timeout: 240000 * SLOW });
await sleep(1000);
const drawn = await A.page.evaluate(async () => {
  const L = await window.__imp("/village/villageLayout.ts");
  const V = await window.__imp("/village/generated/villageVegColliders.ts");
  const same = (a, b) => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
  const mine = [...V.VILLAGE_VEG_COLLIDERS];
  return {
    trunks: window.__cvTrunkList.village,
    bushes: window.__cvBushList.village,
    // everything solid that is not this table's own
    obstacles: L.villageGeometry.obstacles.filter((o) => !mine.some((m) => same(m, o))),
    // the model's own plant boxes as the game stages them (moved for the A8 houses and off the paths), before this table's ghosts go
    staged: L.VILLAGE_STAGED_COLLIDERS.obstacles,
  };
});
await b.close();
if (dumpArg) writeFileSync(dumpArg.slice(7), JSON.stringify(drawn));

// ───────────────────────────────────────── the table ─────────────────────────────────────────
const r2 = (v) => Math.round(v * 100) / 100;
/** A trunk's box: the trunk itself (never under the model's 0.5 m). A bush's: its mound less the 0.3 m of leaf tips a walker brushes. */
const need = [];
for (const t of drawn.trunks) need.push({ kind: `trunk ${t.kind}`, x: t.x, z: t.z, half: Math.max(0.25, r2(t.r + 0.03)) });
for (const s of drawn.bushes) {
  if (s.y > 0.4 || s.h < 0.45) continue; // on a roof, in a raised planter (its planter is the solid), or ground cover
  need.push({ kind: "bush", x: s.x, z: s.z, half: Math.min(1.2, Math.max(0.4, r2(s.r - 0.3))) });
}
const boxOf = (n) => ({ minX: r2(n.x - n.half), maxX: r2(n.x + n.half), minZ: r2(n.z - n.half), maxZ: r2(n.z + n.half) });
const holds = (o, bx, slack = 0.06) => o.minX <= bx.minX + slack && o.maxX >= bx.maxX - slack && o.minZ <= bx.minZ + slack && o.maxZ >= bx.maxZ - slack;
const inWalk = (n) => Math.abs(n.x) < 100 && Math.abs(n.z) < 100;

// the model's plant boxes (generated/villageColliders.ts names them in its comments)
const src = readFileSync(join(REPO, "shared", "src", "village", "generated", "villageColliders.ts"), "utf8");
const plantSized = (o) => {
  const w = r2(o.maxX - o.minX), d = r2(o.maxZ - o.minZ);
  return w === d && (w === 0.5 || w === 0.9 || w === 1);
};
const modelPlantCount = (src.match(/col__(tree|bush|shrub)_/g) ?? []).length;
const ghosts = [];
for (const o of drawn.staged) {
  if (!plantSized(o)) continue;
  const cx = (o.minX + o.maxX) / 2, cz = (o.minZ + o.maxZ) / 2, h = (o.maxX - o.minX) / 2;
  const near = need.some((n) => Math.abs(n.x - cx) <= h + 0.25 && Math.abs(n.z - cz) <= h + 0.25);
  if (!near) ghosts.push(o);
}
const sameBox = (a, b2) => a.minX === b2.minX && a.maxX === b2.maxX && a.minZ === b2.minZ && a.maxZ === b2.maxZ;
// (the game's obstacles were built with the table on disk: its old ghosts are missing from them, so the staged boxes are counted again)
const solid = [...drawn.obstacles, ...drawn.staged].filter((o) => !ghosts.some((g) => sameBox(g, o)));
const add = [];
for (const n of need) {
  if (!inWalk(n)) continue;
  const bx = boxOf(n);
  if (solid.some((o) => holds(o, bx))) continue;
  // a trunk a lot's own box stands on (the schoolyard's two trees: the lot model's collider is the truth there, villageLots.ts)
  if (n.kind !== "bush" && solid.some((o) => o.maxX - o.minX <= 1.2 && o.maxZ - o.minZ <= 1.2 && n.x > o.minX - 0.05 && n.x < o.maxX + 0.05 && n.z > o.minZ - 0.05 && n.z < o.maxZ + 0.05)) continue;
  add.push({ ...bx, kind: n.kind });
}
add.sort((a, c) => a.minX - c.minX || a.minZ - c.minZ);
ghosts.sort((a, c) => a.minX - c.minX || a.minZ - c.minZ);
const line = (o, note) => `  { minX: ${o.minX}, maxX: ${o.maxX}, minZ: ${o.minZ}, maxZ: ${o.maxZ} },${note ? ` // ${note}` : ""}`;
const text = `// GENERATED by e2e/veg-colliders.mjs — 손으로 고치지 않는다
// The village's trunks and bushes as the game DRAWS them (veg/villageVegetation.ts), where the model's own col__tree / col__bush /
// col__shrub boxes do not hold them; and the model's plant boxes nothing is drawn in. After a change to the vegetation:
//   CV_CLIENT_URL=http://localhost:<vite> node e2e/veg-colliders.mjs     (then e2e/solid-audit.mjs proves it)

import type { AABB } from "../../collision";

/** A box for every drawn trunk (its own girth) and ground bush (its mound less the leaf tips) the model has no box for. */
export const VILLAGE_VEG_COLLIDERS: readonly AABB[] = [
${add.map((o) => line(o, o.kind)).join("\n")}
];

/** The model's plant boxes that stand where no plant is drawn (the plant was moved, varied or never grown): not colliders. */
export const VILLAGE_VEG_GHOSTS: readonly AABB[] = [
${ghosts.map((o) => line(o)).join("\n")}
];
`;
console.log(`drawn: ${drawn.trunks.length} trunks, ${drawn.bushes.length} bushes (${need.length} on the ground); model plant boxes ${modelPlantCount}`);
console.log(`table: ${add.length} boxes added (${add.filter((a) => a.kind === "bush").length} bushes, ${add.filter((a) => a.kind !== "bush").length} trunks), ${ghosts.length} ghost boxes`);
// the plants as drawn, for the sweep on the client (veg/vegOffPaths.test.ts: every drawn trunk and bush against every paved surface and its collider)
const DRAWN = join(REPO, "client", "src", "village", "veg", "drawnPlants.generated.json");
const drawnText =
  JSON.stringify(
    {
      note: "GENERATED by e2e/veg-colliders.mjs: every trunk (where it passes the waist of a walker) and every bush on the ground the village draws. Not edited by hand.",
      trunks: drawn.trunks.map((t) => ({ x: r2(t.x), z: r2(t.z), r: r2(t.r), kind: t.kind })).sort((a, c) => a.x - c.x || a.z - c.z),
      bushes: drawn.bushes.filter((s) => s.y <= 0.4 && s.h >= 0.45).map((s) => ({ x: r2(s.x), y: r2(s.y), z: r2(s.z), h: r2(s.h), r: r2(s.r) })).sort((a, c) => a.x - c.x || a.z - c.z),
    },
    null,
    1,
  ) + "\n";
const read = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const before = read(TABLE);
const norm = (s) => s.replace(/\r\n/g, "\n");
if (check) {
  const ok = norm(before) === norm(text) && norm(read(DRAWN)) === norm(drawnText);
  console.log(ok ? "PASS  the table on disk is what the game draws" : "FAIL  the table on disk is stale: run e2e/veg-colliders.mjs");
  process.exit(ok ? 0 : 1);
}
writeFileSync(TABLE, text);
writeFileSync(DRAWN, drawnText);
console.log(norm(before) === norm(text) ? "unchanged" : `wrote ${TABLE}`);
process.exit(0);
