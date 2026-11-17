/**
 * e2e/library-lookdev.mjs — B1 look-dev shots of the library (outside and its reading room), PC and phone, day and night
 * (client/dev/library-lookdev.html; the shooter is e2e/school-lookdev.mjs).
 *   node e2e/library-lookdev.mjs --url http://localhost:5710 --out <dir> [--models ...] [--views ...]
 */
import { shootLookdev } from "./school-lookdev.mjs";

await shootLookdev("library-lookdev.html", {
  models: "lot_library,lot_library_reading",
  views: { lot_library: ["street", "entrance", "nook", "pergola", "garden"], lot_library_reading: ["entry", "fireplace", "nook_seat", "tables"] },
});
