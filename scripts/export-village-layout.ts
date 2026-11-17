/**
 * scripts/export-village-layout.ts — 케이슨 마을 배치 데이터를 Blender 스크립트용 JSON으로 쓴다 (케이슨 마을 1단계 Task 1).
 *
 *   npx tsx scripts/export-village-layout.ts [out.json]
 *
 * 기본 출력은 art/village/layout.json (art/는 git이 무시한다; 폴더가 없으면 만든다). 내용은
 * shared/src/village/villageLayout.ts의 `exportVillageLayout()`이다: 걷기 범위, 시작 위치, 분수 광장, 순환 도로, 개울과 다리,
 * 정자, 부지 여섯 곳(이름·표지판 글), 추모관 바깥·안, 경치용 집, 두 구역, 그리고 충돌 상자 목록. 같은 입력이면 출력은 바이트 단위로 같다.
 * 의존성 없음.
 */

import fs from "node:fs";
import path from "node:path";
import { exportVillageLayout } from "../shared/src/village/villageLayout";
import { lotsForLayoutJson } from "../shared/src/village/villageLots";

const REPO = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(REPO, "art", "village", "layout.json");
const USAGE = "usage: npx tsx scripts/export-village-layout.ts [out.json]";

export function main(argv: string[]): number {
  if (argv.length > 1) {
    console.error(USAGE);
    return 1;
  }
  const outFile = path.resolve(argv[0] ?? DEFAULT_OUT);
  // the lot buildings (village-lots contract 8.4, L5): vrb2 lays the ground of each lot from this
  const layout = { ...exportVillageLayout(), lots: lotsForLayoutJson() };
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
  } catch (err) {
    console.error(`FAIL: ${outFile}를 쓰지 못했어요: ${(err as Error).message}`);
    return 1;
  }
  console.log(
    `PASS: 마을 배치 → ${outFile} (부지 ${layout.plots.length}곳, 집 ${layout.sceneryHouses.length}채, 충돌 상자 ${layout.colliders.length}개, 부지 건물 ${(layout.lots as unknown[]).length}채)`,
  );
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
