/**
 * DEV look-dev for 케이슨 마을 도서관 (lot_library and its room lot_library_reading): the shared B1 runner in schoolLookdev.ts.
 *   ?model=lot_library|lot_library_reading  ?time=day|night  ?tier=2k|1k  ?view=<name>
 */
import { runLookdev } from "./schoolLookdev";

void runLookdev("lot_library");
