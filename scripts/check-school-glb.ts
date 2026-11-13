/**
 * scripts/check-school-glb.ts — 케이슨 마을 GLB(village) 점검 (케이슨 마을 1단계 Task 6), 추모관 실내 GLB(memorial) 점검 (Task 8).
 * (파일 이름의 "school"은 옛 이름이다.)
 *
 *   npx tsx --tsconfig server/tsconfig.json scripts/check-school-glb.ts <glb> village|memorial
 *
 * 확인하는 것 (하나라도 어긋나면 종료 코드 1, 모두 통과하면 0):
 *   - 파일 크기: village ≤ 8 MB (1 MB = 1024², 캐릭터 점검과 같다)
 *   - 필수 노드: TS 배치 자료(shared/src/village/villageLayout.ts)에서 읽는다 (scripts/lib/schoolSpec.ts)
 *   - col__* 노드에 회전·부모가 없다
 *   - village: 배치 자료(shared/src/village/villageLayout.ts)의 col__ 상자가 모두 있고 위치·크기가 같다(0.01 m),
 *     카메라 상자 높이가 배치 자료의 camera 표시와 맞는다(1.6 m), 밤 굽기용 light__ 노드가 있다, M_window·M_lamp·M_water·M_glow_plot 재질이
 *     있고 LM_이 아니다, GPU 인스턴스 노드는 확장이 extensionsUsed에 있고 TRANSLATION·ROTATION·SCALE 수가 같다
 *   - memorial: 칸마다 anchor__cubby_<벽>_<줄>_<칸> 노드가 배치 자료(cubbyAnchors)의 입구 가운데에서 2 cm 안에 있고 방 안쪽을 본다,
 *     방 벽 넷(col__hall_wall_n·s·e·w)과 칸 벽 둘(col__cubby_n·e)이 배치 자료 상자 그대로(카메라 높이), 안쪽 문 발판과
 *     들어온 자리에 col__ 상자가 없다, ceil__hall 판의 아랫면이 천장(3.4 m)이고 방을 다 덮는다, M_lamp·M_garden이 있고 LM_이 아니다.
 *     크기 ≤ 6 MB, 삼각형 ≤ 200k
 *   - 삼각형 수: village ≤ 260k (EXT_mesh_gpu_instancing 인스턴스 수만큼 곱한다).
 *     Draco GLB도 읽는다: 풀지 않고, 확장이 JSON에 남기는 accessor count로 센다
 *   - 재질 ≤ 24, 텍스처(GLB 안 이미지) 한 변 ≤ 2048
 *   - extensionsUsed에 KHR_materials_unlit. KHR_draco_mesh_compression은 있어도 없어도 된다
 *   - LM_* 재질이 있으면 GLB 옆(`<방>_lightmap.webp`, `<방>_lm.webp` 또는 `lightmaps/<방>_lightmap.webp`)에 라이트맵 WebP가 있고,
 *     그 재질을 쓰는 모든 primitive에 TEXCOORD_1이 있다
 *   - village: 옆의 마을버스 village_bus.glb도 점검한다(마을과 늘 함께 그려지는 파일, 버스 검토). 노드 village_bus 하나,
 *     재질 M_bus·M_bus_glass·M_bus_led·M_bus_ground가 primitive 하나씩(그리기 4번), LM_ 없음, ≤ 1.5 MB, 삼각형 ≤ 40k,
 *     텍스처 한 변 ≤ 1024, 그리고 마을 + 버스 삼각형 ≤ 300k(마을 260k + 버스 40k). 버스 파일이 옆에 없으면 WARN
 * 의존성 없음. 순수 부분: scripts/lib/schoolGlb.ts (테스트: server/src/tools/schoolGlb.test.ts, villageBus.test.ts).
 */

import fs from "node:fs";
import path from "node:path";
import { checkSchoolGlb, checkVillageBus, checkVillageSceneTriangles, imageSize, parseGlb } from "./lib/schoolGlb";
import type { LightmapFile, SchoolKind } from "./lib/schoolGlb";
import { schoolSpec } from "./lib/schoolSpec";

const USAGE = "usage: npx tsx --tsconfig server/tsconfig.json scripts/check-school-glb.ts <glb> village|memorial";
const KINDS: readonly SchoolKind[] = ["village", "memorial"];

/** The light-map WebP that belongs to this room: next to the GLB, or in a `lightmaps/` folder next to it. */
function findLightmap(glbPath: string, kind: SchoolKind): LightmapFile | null {
  const dir = path.dirname(glbPath);
  const candidates = [
    path.join(dir, `${kind}_lightmap.webp`),
    path.join(dir, `${kind}_lm.webp`),
    path.join(dir, "lightmaps", `${kind}_lightmap.webp`),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const size = imageSize(fs.readFileSync(candidate));
    return { path: candidate, width: size?.width ?? 0, height: size?.height ?? 0 };
  }
  return null;
}

export function main(argv: string[]): number {
  const [glbPath, kindArg] = argv;
  const kind = KINDS.find((k) => k === kindArg);
  if (!glbPath || !kind || argv.length !== 2) {
    console.error(USAGE);
    return 1;
  }
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
  let results;
  try {
    results = checkSchoolGlb({
      kind,
      fileBytes: data.length,
      gltf: parsed.gltf,
      bin: parsed.bin,
      spec: schoolSpec(kind),
      lightmap: findLightmap(glbPath, kind),
      readUri: (uri) => {
        let decoded: string;
        try {
          decoded = decodeURIComponent(uri);
        } catch {
          return null; // a malformed %-escape: the image cannot be read, which the texture check reports as a FAIL
        }
        const file = path.resolve(dir, decoded);
        return file.startsWith(dir + path.sep) && fs.existsSync(file) ? fs.readFileSync(file) : null;
      },
    });
  } catch (err) {
    // A glTF that is malformed in a way the checks cannot get past: say so in one line, no stack trace.
    console.error(`FAIL: ${glbPath}를 점검하지 못했어요: ${(err as Error).message}`);
    return 1;
  }
  if (kind === "village") {
    // The bus parked at the stop is its own file but always drawn with the village: its budget, and the two together.
    const busPath = path.join(path.dirname(glbPath), "village_bus.glb");
    if (fs.existsSync(busPath)) {
      try {
        const busData = fs.readFileSync(busPath);
        const bus = parseGlb(busData);
        results.push(...checkVillageBus(bus.gltf, busData.length, bus.bin));
        results.push(checkVillageSceneTriangles(parsed.gltf, bus.gltf));
      } catch (err) {
        results.push({ level: "fail", label: "버스 파일", detail: `${busPath}를 읽지 못했어요: ${(err as Error).message}` });
      }
    } else {
      results.push({ level: "warn", label: "버스 파일", detail: `${busPath}가 없어서 버스와 마을 + 버스 삼각형은 세지 않았어요` });
    }
  }
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
