/**
 * 케이슨 마을 도서관 — the B1 kit's output (docs/designs/village-lots-v2/tools/parts_lot_library.py): lot_library.glb and its
 * texture manifest checked against the lots v2 contract (villageLots.ts). Shared checks: lotB1GlbChecks.ts.
 */
import { describeLotGlb } from "./lotB1GlbChecks";

describeLotGlb("lot_library", "library", {
  night: ["windows", "nooks", "lantern", "lamps", "pergola"],
  slotKinds: ["book_return", "nameplate", "notice_board", "reading_nook", "reading_nook", "reading_nook"],
});
