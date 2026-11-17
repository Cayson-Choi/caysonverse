/**
 * 케이슨 마을 학교 — the B1 kit's output (docs/designs/village-lots-v2/tools/parts_lot_school.py): lot_school.glb and its
 * texture manifest checked against the lots v2 contract (villageLots.ts: colliders to the cm, seats, slots, the swing door
 * with its two hinged leaves, node names, budgets, KTX2-only PBR library sets, no money words). Shared checks: lotB1GlbChecks.ts.
 */
import { describeLotGlb } from "./lotB1GlbChecks";

describeLotGlb("lot_school", "school", {
  night: ["windows", "clock", "cupola", "porch", "lamps"],
  slotKinds: ["bell", "clock", "nameplate", "notice_board", "playground", "playground", "playground", "playground"],
});
