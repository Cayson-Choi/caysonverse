/**
 * 케이슨 마을 교회 — the B2 kit's output (docs/designs/village-lots-v2/tools/parts_lot_church.py, parts_lot_church_nave.py):
 * lot_church.glb, the walk-in 예배당 lot_church_nave.glb and its phone LOD, checked against the lots v2 contract
 * (villageLots.ts). Shared checks: lotB2GlbChecks.ts.
 */
import { describeB2Lot, describeB2Room } from "./lotB2GlbChecks";

describeB2Lot("lot_church", "church", {
  night: ["windows", "belfry", "porch", "lamps"],
  slotKinds: ["bell", "nameplate", "notice_board"],
});

describeB2Room("lot_church_nave", "church", ["lotglass__lot_church_nave_w1", "lotglass__lot_church_nave_e3"]);
