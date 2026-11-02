/**
 * scripts/extract-colliders.ts — GLB의 `col__*` 상자를 충돌 상자(AABB) 목록 TypeScript 파일로 뽑는다 (방탈출 1단계 Task 22).
 *
 *   npx tsx --tsconfig server/tsconfig.json scripts/extract-colliders.ts <glb> <ExportName> <out.ts>
 *
 *   예: ... scripts/extract-colliders.ts client/public/models/school/hub.glb HUB_PROP_COLLIDERS shared/src/school/generated/hubColliders.ts
 *       ... scripts/extract-colliders.ts client/public/models/school/counsel.glb COUNSEL_PROP_COLLIDERS shared/src/school/generated/counselColliders.ts
 *
 * `col__*` 노드는 정육면체 하나에 translation과 scale만 있는 상자다. 바닥 평면의 상자는 translation ± scale/2 (x, z)이고,
 * 0.01로 반올림하고 minX, minZ, maxX, maxZ 순으로 정렬한다. 회전·matrix·부모가 있거나 크기가 0이면 FAIL(종료 코드 1)이고
 * 파일을 쓰지 않는다. `col__*`가 하나도 없어도 FAIL이다. 같은 입력이면 출력은 바이트 단위로 같다.
 * 의존성 없음. 순수 부분: scripts/lib/schoolGlb.ts (테스트: server/src/tools/schoolGlb.test.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { extractColliders, parseGlb, renderColliderModule } from "./lib/schoolGlb";

const REPO = path.resolve(__dirname, "..");
const USAGE = "usage: npx tsx --tsconfig server/tsconfig.json scripts/extract-colliders.ts <glb> <ExportName> <out.ts>";

/** Import path of shared/src/collision as seen from the output file ("../../collision"). */
function collisionImportFrom(outFile: string): string {
  const rel = path.relative(path.dirname(path.resolve(outFile)), path.join(REPO, "shared", "src", "collision")).split(path.sep).join("/");
  // Another drive (or an absolute result): the file is not inside the repo, so use the standard generated location's path.
  if (path.isAbsolute(rel)) return "../../collision";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function main(argv: string[]): number {
  const [glbPath, exportName, outFile] = argv;
  if (!glbPath || !exportName || !outFile || argv.length !== 3) {
    console.error(USAGE);
    return 1;
  }
  if (!fs.existsSync(glbPath)) {
    console.error(`FAIL: 파일 없음: ${glbPath}`);
    return 1;
  }
  let extraction;
  try {
    extraction = extractColliders(parseGlb(fs.readFileSync(glbPath)).gltf);
  } catch (err) {
    console.error(`FAIL: ${glbPath}를 읽지 못했어요: ${(err as Error).message}`);
    return 1;
  }
  const { colliders, problems } = extraction;
  if (colliders.length === 0 && problems.length === 0) problems.push("col__* 노드가 하나도 없어요");
  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    console.error(`FAIL: ${outFile}를 쓰지 않았어요`);
    return 1;
  }
  let text;
  try {
    text = renderColliderModule({
      exportName,
      source: path.basename(glbPath),
      colliders,
      collisionImport: collisionImportFrom(outFile),
    });
  } catch (err) {
    console.error(`FAIL: ${(err as Error).message}`);
    return 1;
  }
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.writeFileSync(outFile, text, "utf8");
  console.log(`PASS: col__* ${colliders.length}개 → ${outFile} (${exportName})`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
