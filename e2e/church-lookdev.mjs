/**
 * e2e/church-lookdev.mjs — B2 look-dev shots of the 교회 (outside and its walk-in 예배당), PC and phone, day and night
 * (client/dev/church-lookdev.html; the shooter is B1's e2e/school-lookdev.mjs).
 *   node e2e/church-lookdev.mjs --url http://localhost:5711 --out <dir> [--models ...] [--views ...]
 */
import { shootLookdev } from "./school-lookdev.mjs";

await shootLookdev("church-lookdev.html", {
  models: "lot_church,lot_church_nave",
  views: { lot_church: ["street", "corner", "porch", "steeple"], lot_church_nave: ["entry", "seat", "chancel", "cross", "window"] },
});
