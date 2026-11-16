/**
 * scripts/export-lake-layout.ts — 케이슨 낚시터(A10) 배치 데이터를 Blender 스크립트용 JSON으로 쓴다 (설계 13장, 작업 D1).
 *
 *   npx tsx scripts/export-lake-layout.ts [out.json]
 *
 * 기본 출력은 art/lake/layout.json (art/는 git이 무시한다; 폴더가 없으면 만든다). 내용은
 * shared/src/village/lakeLayout.ts의 `exportLakeLayout()`이다: 구역, 기본값(간판 글 등), 저수지 윤곽, 걷는 땅 한계, 흙길,
 * 데크(잔교·T자·부교·좌대), 관리소·대여 자리·정자, 낚시 자리 30곳(노드 이름 `spot__<id>`, 찌 목표), 좌석 56개(`seat__lake_*`),
 * 벤치·피크닉·가로등·갈대, 시설 충돌 상자(`col__lake_*`)와 땅 충돌 상자. 같은 입력이면 출력은 바이트 단위로 같다.
 * 의존성 없음.
 */

import fs from "node:fs";
import path from "node:path";
import { exportLakeLayout } from "../shared/src/village/lakeLayout";

const REPO = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(REPO, "art", "lake", "layout.json");
const USAGE = "usage: npx tsx scripts/export-lake-layout.ts [out.json]";

export function main(argv: string[]): number {
  if (argv.length > 1) {
    console.error(USAGE);
    return 1;
  }
  const outFile = path.resolve(argv[0] ?? DEFAULT_OUT);
  const layout = exportLakeLayout();
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
  } catch (err) {
    console.error(`FAIL: ${outFile}를 쓰지 못했어요: ${(err as Error).message}`);
    return 1;
  }
  console.log(
    `PASS: 낚시터 배치 → ${outFile} (낚시 자리 ${layout.spots.length}곳, 좌석 ${layout.seats.length}개, 시설 충돌 ${layout.colliders.length}개, 땅 충돌 ${layout.terrainColliders.length}개)`,
  );
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
