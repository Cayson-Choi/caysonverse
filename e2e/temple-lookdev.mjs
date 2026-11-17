/**
 * e2e/temple-lookdev.mjs — B3 look-dev shots (lots v2, 2026-11-17): 마을 절 outside, the 대웅전 room (with the sacred props at
 * their markers) and the polished 케이슨랜드 정문, PC (1600x1000, 2K sets) and phone (390x844 @2x, 1K sets), day and night
 * (client/dev/temple-lookdev.html; the shooter is e2e/school-lookdev.mjs).
 *   node e2e/temple-lookdev.mjs --url http://localhost:5712 --out <dir> [--models ...] [--views ...]
 */
import { shootLookdev } from "./school-lookdev.mjs";

await shootLookdev("temple-lookdev.html", {
  models: "lot_temple,lot_temple_hall,lot_gate",
  views: {
    lot_temple: ["street", "gate", "approach", "hall", "pond"],
    lot_temple_hall: ["entry", "cushion", "buddha", "datjip", "offering"],
    lot_gate: ["street", "plaza", "booth"],
  },
});
