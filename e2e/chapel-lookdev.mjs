/**
 * e2e/chapel-lookdev.mjs — B2 look-dev shots of the 성당 (outside and its walk-in nave with the sacred props), PC (2K sets, the
 * PC room) and phone (390x844 @2x, 1K sets, the phone room and *_phone props), day and night (client/dev/chapel-lookdev.html;
 * the shooter is B1's e2e/school-lookdev.mjs).
 *   node e2e/chapel-lookdev.mjs --url http://localhost:5711 --out <dir> [--models ...] [--views ...]
 */
import { shootLookdev } from "./school-lookdev.mjs";

await shootLookdev("chapel-lookdev.html", {
  models: "lot_chapel,lot_chapel_nave",
  views: { lot_chapel: ["street", "corner", "portal", "fountain", "rosearch"], lot_chapel_nave: ["entry", "seat", "altar", "mary", "glass", "rose", "crucifix"] },
});
