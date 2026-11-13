/**
 * e2e/village-desktop.mjs — 케이슨 마을 PC 종단 점검 (1단계 Task 11). 입장 → 두 번째 사람 → 다리 → 표지판 → 추모관 문 → 안 → 카드·촛불 → 나가기.
 *
 *   npm run dev   (다른 창에서)
 *   node e2e/village-desktop.mjs [--out=<폴더>]
 */
import { DESKTOP } from "./lib/common.mjs";
import { runVillageScenario } from "./lib/village.mjs";

process.exit(await runVillageScenario({ name: "village-desktop", device: DESKTOP }));
