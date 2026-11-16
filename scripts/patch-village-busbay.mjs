/**
 * scripts/patch-village-busbay.mjs — moves the parked bus's collision box (the `col__bus` node) in village.glb
 * (fix/crosswalk-signals, review round 2: the bus stop moved from (34.2, -5.75) to (34.1, -6.5) so the parked bus's tail is clear
 * of the crosswalk's stripes and its nose stays inside the kerb).
 *
 *   node scripts/patch-village-busbay.mjs <village.glb> [--out <other.glb>] [--dry]
 *
 * Idempotent. It only changes the node's translation (x, z); the scale and every other byte stay as they are. The collider
 * list shared/src/village/generated/villageColliders.ts comes from this node (npx tsx scripts/extract-colliders.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readGlb, writeGlb } from "./patch-village-moon.mjs";

export const BUS_CENTRE = { x: 34.1, z: -6.5 };

export function patchBusBay(buf) {
  const { json, bin } = readGlb(buf);
  const node = json.nodes.find((n) => n.name === "col__bus");
  if (!node) throw new Error("no col__bus node");
  const [x, y, z] = node.translation;
  const before = { x, y, z };
  node.translation = [BUS_CENTRE.x, y, BUS_CENTRE.z];
  return { out: writeGlb(json, bin), before, scale: node.scale };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out");
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : input;
  const r = patchBusBay(readFileSync(input));
  console.log("col__bus", r.before, "->", BUS_CENTRE, "scale", r.scale);
  if (!args.includes("--dry")) writeFileSync(out, r.out);
}
