/**
 * scripts/check-school-glb.ts — 학교 GLB(중앙 홀+복도 hub, 상담실 counsel) 점검 (방탈출 1단계 Task 22).
 *
 *   npx tsx --tsconfig server/tsconfig.json scripts/check-school-glb.ts <glb> hub|counsel
 *
 * 확인하는 것 (하나라도 어긋나면 종료 코드 1, 모두 통과하면 0):
 *   - 파일 크기: hub ≤ 3.5 MB, counsel ≤ 5 MB (1 MB = 1024², 캐릭터 점검과 같다)
 *   - 필수 노드: TS 배치 자료(shared/src/school/counselMap.ts·hubMap.ts)에서 읽는다 (scripts/lib/schoolSpec.ts)
 *   - 앵커 위치: counsel의 obj__<앵커> 노드, hub의 door__·pad__ 노드가 TS 앵커에서 0.25 m 이내
 *   - col__* 노드에 회전·부모가 없다, counsel의 obj__* 노드에 회전이 없다
 *   - 삼각형 수: hub ≤ 150k, counsel ≤ 120k. Draco GLB도 읽는다: 풀지 않고, 확장이 JSON에 남기는 accessor count로 센다
 *   - 재질 ≤ 24, 텍스처(GLB 안 이미지) 한 변 ≤ 2048
 *   - extensionsUsed에 KHR_materials_unlit. KHR_draco_mesh_compression은 있어도 없어도 된다(hub는 Draco, counsel은 아니다)
 *   - LM_* 재질이 있으면 GLB 옆(`<방>_lightmap.webp` 또는 `lightmaps/<방>_lightmap.webp`)에 라이트맵 WebP가 있고,
 *     그 재질을 쓰는 모든 primitive에 TEXCOORD_1이 있다
 * 의존성 없음. 순수 부분: scripts/lib/schoolGlb.ts (테스트: server/src/tools/schoolGlb.test.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { checkSchoolGlb, imageSize, parseGlb } from "./lib/schoolGlb";
import type { LightmapFile, SchoolKind } from "./lib/schoolGlb";
import { schoolSpec } from "./lib/schoolSpec";

const USAGE = "usage: npx tsx --tsconfig server/tsconfig.json scripts/check-school-glb.ts <glb> hub|counsel";

/** The light-map WebP that belongs to this room: next to the GLB, or in a `lightmaps/` folder next to it. */
function findLightmap(glbPath: string, kind: SchoolKind): LightmapFile | null {
  const dir = path.dirname(glbPath);
  for (const candidate of [path.join(dir, `${kind}_lightmap.webp`), path.join(dir, "lightmaps", `${kind}_lightmap.webp`)]) {
    if (!fs.existsSync(candidate)) continue;
    const size = imageSize(fs.readFileSync(candidate));
    return { path: candidate, width: size?.width ?? 0, height: size?.height ?? 0 };
  }
  return null;
}

export function main(argv: string[]): number {
  const [glbPath, kindArg] = argv;
  if (!glbPath || (kindArg !== "hub" && kindArg !== "counsel") || argv.length !== 2) {
    console.error(USAGE);
    return 1;
  }
  const kind: SchoolKind = kindArg;
  if (!fs.existsSync(glbPath)) {
    console.error(`FAIL: 파일 없음: ${glbPath}`);
    return 1;
  }
  const data = fs.readFileSync(glbPath);
  let parsed;
  try {
    parsed = parseGlb(data);
  } catch (err) {
    console.error(`FAIL: ${glbPath}를 읽지 못했어요: ${(err as Error).message}`);
    return 1;
  }
  const dir = path.dirname(path.resolve(glbPath));
  const results = checkSchoolGlb({
    kind,
    fileBytes: data.length,
    gltf: parsed.gltf,
    bin: parsed.bin,
    spec: schoolSpec(kind),
    lightmap: findLightmap(glbPath, kind),
    readUri: (uri) => {
      const file = path.resolve(dir, decodeURIComponent(uri));
      return file.startsWith(dir) && fs.existsSync(file) ? fs.readFileSync(file) : null;
    },
  });
  console.log(`${glbPath} (${kind})`);
  let failed = 0;
  for (const r of results) {
    const tag = r.level === "ok" ? "OK  " : r.level === "warn" ? "WARN" : "FAIL";
    if (r.level === "fail") failed += 1;
    console.log(`  ${tag} ${r.label}: ${r.detail}`);
  }
  if (failed > 0) {
    console.error(`FAIL: ${failed}개 점검이 어긋났어요`);
    return 1;
  }
  console.log("PASS");
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
