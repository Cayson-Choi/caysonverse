/**
 * 케이슨 마을 성당 — the B2 kit's output (docs/designs/village-lots-v2/tools/parts_lot_chapel.py, parts_lot_chapel_nave.py):
 * lot_chapel.glb, the walk-in nave lot_chapel_nave.glb and its phone LOD, checked against the lots v2 contract
 * (villageLots.ts) and the sacred props' placements (sacred.json). Shared checks: lotB2GlbChecks.ts.
 */
import { describeB2Lot, describeB2Room } from "./lotB2GlbChecks";

describeB2Lot("lot_chapel", "chapel", {
  night: ["windows", "rose", "notice", "porch", "belfry", "lamps", "fountain"],
  slotKinds: ["bell", "garden", "nameplate", "notice_board"],
});

describeB2Room("lot_chapel_nave", "chapel", [
  "lotstatue__lot_chapel_nave_mary",
  "lotstatue__lot_chapel_nave_saint",
  "lotstatue__lot_chapel_nave_saint_b",
  "lotstatue__lot_chapel_nave_crucifix",
  "lotglass__lot_chapel_nave_rose",
  "lotglass__lot_chapel_nave_virgin_3",
  "lotglass__lot_chapel_nave_nativity_1",
  "lotglass__lot_chapel_nave_assumption_2",
]);
