/**
 * scripts/export-exterior-windows.ts — 집 외관 A8 창 표를 설계값(design 3.5)으로 다시 쓴다.
 *
 *   npx tsx scripts/export-exterior-windows.ts [out.json]
 *
 * 기본 출력은 shared/src/village/generated/exterior_windows.json (`source: "design"`). 집 빌드(build_houses.py, X4)가 실제로 뚫은
 * 개구부로 같은 파일을 `source: "build"`로 덮어쓰고, 실내 약속(houses interior)이 이 파일을 읽어요. 같은 입력이면 출력은 바이트 단위로 같다.
 */

import fs from "node:fs";
import path from "node:path";
import { designExteriorWindowTable } from "../shared/src/village/exteriorWindows";

const REPO = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(REPO, "shared", "src", "village", "generated", "exterior_windows.json");

export function main(argv: string[]): number {
  if (argv.length > 1) {
    console.error("usage: npx tsx scripts/export-exterior-windows.ts [out.json]");
    return 1;
  }
  const out = path.resolve(argv[0] ?? DEFAULT_OUT);
  const t = designExteriorWindowTable();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(t, null, 2)}\n`, "utf8");
  console.log(`PASS: 창 표(설계값) → ${out} (집 ${Object.keys(t.houses).length}채)`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
