/**
 * scripts/export-house-contract.ts — 집 실내 약속(shared/src/village/houseAreas.ts)을 Blender가 읽는 JSON으로 쓴다 (P0, 2026-11-16).
 *
 *   npx tsx scripts/export-house-contract.ts [out.json]
 *
 * 기본 출력은 docs/designs/houses-interior/contract.json(커밋하는 파일). art/village/tools/houses/*.py와
 * docs/designs/houses-interior/houses_contract.py가 이 파일만 읽는다. houseAreas.ts를 고치면 이 스크립트를 다시 돌린다
 * (shared/src/village/houseAreas.test.ts가 커밋된 파일과 코드가 같은지 확인한다). 같은 입력이면 출력은 바이트 단위로 같다.
 */

import fs from "node:fs";
import path from "node:path";
import { houseContractJson } from "../shared/src/village/houseAreas";

const REPO = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(REPO, "docs", "designs", "houses-interior", "contract.json");

export function main(argv: string[]): number {
  if (argv.length > 1) {
    console.error("usage: npx tsx scripts/export-house-contract.ts [out.json]");
    return 1;
  }
  const out = path.resolve(argv[0] ?? DEFAULT_OUT);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(houseContractJson(), null, 2)}\n`, "utf8");
  console.log(`PASS: 집 실내 약속 → ${out}`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
