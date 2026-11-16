/**
 * scripts/gen-house-seats.ts — 집 GLB(house_N.glb)를 약속(shared/src/village/houseAreas.ts)에 맞춰 점검하고, `seat__h<N>_<층>_<k>`
 * 표식에서 앉는 자리 파일을 만든다 (집 실내 P0, 2026-11-16).
 *
 *   npx tsx --tsconfig server/tsconfig.json scripts/gen-house-seats.ts <house_N.glb> [out.ts]
 *
 * 점검(하나라도 틀리면 FAIL, 파일을 쓰지 않음): 필수 노드(floor__/stair__/door__/spawn__/ceil__)가 있고 맨 위 노드인지, 자리 노드가
 * 약속 자리(±5 cm, 방향 ±0.02 rad)에 있는지, col__h<N>_* 상자가 HOUSE_MIN_COLLIDERS개 이상이고 맨 위 노드인지, 자리 표식의 이름·
 * extras·규칙(seatMarkerProblems), 층마다 종류별 자리 수가 HOUSE_SEAT_PLAN과 같은지, 층마다 k가 0부터 빈칸 없이 이어지는지.
 * 출력 기본값: shared/src/village/generated/houses/house_N_seats.ts (`HOUSE_N_SEAT_MARKERS`, 집·층·k 순서).
 * 충돌 상자는 기존 도구로: `scripts/extract-colliders.ts <glb> HOUSE_N_COLLIDERS shared/src/village/generated/houses/house_N_colliders.ts`.
 * 같은 입력이면 출력은 바이트 단위로 같다.
 */

import fs from "node:fs";
import path from "node:path";
import { parseGlb, yawError, type Gltf, type GltfNode } from "./lib/schoolGlb";
import {
  HOUSE_MIN_COLLIDERS,
  HOUSE_NODE_PATTERNS,
  HOUSE_SEAT_EXTRAS,
  HOUSE_SEAT_PLAN,
  compareHouseSeats,
  houseGeneratedFiles,
  housePlacements,
  houseRequiredNodes,
  seatMarkerProblems,
  type HouseFloor,
  type HouseNumber,
  type HouseSeatMarker,
} from "../shared/src/village/houseAreas";

const REPO = path.resolve(__dirname, "..");
const USAGE = "usage: npx tsx --tsconfig server/tsconfig.json scripts/gen-house-seats.ts <house_N.glb> [out.ts]";

type NodeWithExtras = GltfNode & { extras?: Record<string, unknown> };

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The house number from a file name `house_<N>.glb`. */
export function houseNumberFromFile(file: string): HouseNumber | null {
  const m = /^house_(10|[1-9])\.glb$/.exec(path.basename(file));
  return m ? (Number(m[1]) as HouseNumber) : null;
}

/** Check a house GLB against the contract and read its seat markers. */
export function readHouse(gltf: Gltf, n: HouseNumber): { seats: HouseSeatMarker[]; problems: string[] } {
  const nodes = (gltf.nodes ?? []) as NodeWithExtras[];
  const problems: string[] = [];
  const parent = new Set<number>();
  nodes.forEach((nd) => (nd.children ?? []).forEach((c) => parent.add(c)));
  const byName = new Map<string, number>();
  nodes.forEach((nd, i) => {
    if (nd.name) {
      if (byName.has(nd.name)) problems.push(`${nd.name}: 같은 이름의 노드가 둘 이상이에요`);
      byName.set(nd.name, i);
    }
  });
  for (const req of houseRequiredNodes(n)) {
    const i = byName.get(req);
    if (i === undefined) problems.push(`${req}: 필수 노드가 없어요`);
    else if (parent.has(i)) problems.push(`${req}: 맨 위 노드여야 해요 (부모 없음)`);
  }
  for (const p of housePlacements(n)) {
    const i = byName.get(p.node);
    if (i === undefined) continue;
    const nd = nodes[i]!;
    const [x, y, z] = nd.translation ?? [0, 0, 0];
    if (Math.hypot(x! - p.x, z! - p.z) > p.tolerance || Math.abs(y! - p.y) > p.tolerance) {
      problems.push(`${p.node}: 약속 자리 (${p.x}, ${p.z})가 아니라 (${r3(x!)}, ${r3(z!)}, y ${r3(y!)})에 있어요`);
    }
    if (yawError(nd, p.yaw) > 0.02) problems.push(`${p.node}: 방향이 약속(yaw ${p.yaw})과 달라요`);
  }
  const cols = nodes.filter((nd) => nd.name?.startsWith("col__"));
  const own = cols.filter((nd) => HOUSE_NODE_PATTERNS.collider.test(nd.name!) && nd.name!.startsWith(`col__h${n}_`));
  if (own.length < HOUSE_MIN_COLLIDERS) problems.push(`col__h${n}_* 상자가 ${own.length}개 — ${HOUSE_MIN_COLLIDERS}개 이상이어야 해요`);
  for (const c of cols) if (!own.includes(c)) problems.push(`${c.name}: col__h${n}_<층>_<이름> 형식이 아니에요`);

  const seats: HouseSeatMarker[] = [];
  nodes.forEach((nd, i) => {
    const name = nd.name ?? "";
    if (!name.startsWith("seat__")) return;
    const m = HOUSE_NODE_PATTERNS.seat.exec(name);
    if (!m || Number(m[1]) !== n) {
      problems.push(`${name}: seat__h${n}_<층>_<k> 형식이 아니에요`);
      return;
    }
    if (parent.has(i)) problems.push(`${name}: 맨 위 노드여야 해요 (부모 없음)`);
    const ex = nd.extras ?? {};
    const missing = HOUSE_SEAT_EXTRAS.filter((k) => !(k in ex));
    if (missing.length) {
      problems.push(`${name}: extras가 빠졌어요 (${missing.join(", ")})`);
      return;
    }
    const [x, y, z] = nd.translation ?? [0, 0, 0];
    const floor = Number(m[2]) as HouseFloor;
    const k = Number(m[3]);
    const marker: HouseSeatMarker = {
      id: `h${n}_${floor}_${k}`,
      n,
      floor,
      k,
      furn: String(ex.furn) as HouseSeatMarker["furn"],
      kind: String(ex.kind) as HouseSeatMarker["kind"],
      pose: String(ex.pose) as HouseSeatMarker["pose"],
      approach: String(ex.approach) as HouseSeatMarker["approach"],
      x: r3(x!),
      z: r3(z!),
      y: r3(y!),
      yaw: r6(Number(ex.yaw)),
      edge: r3(Number(ex.edge)),
      back: r3(Number(ex.back)),
      width: r3(Number(ex.width)),
      group: String(ex.group),
      both: Boolean(Number(ex.both)),
      exitTurn: r6(Number(ex.exitTurn)),
      lean: r3(Number(ex.lean)),
    };
    problems.push(...seatMarkerProblems(marker));
    if (yawError(nd, marker.yaw) > 0.02) problems.push(`${name}: 노드 회전이 extras의 yaw ${marker.yaw}와 달라요`);
    seats.push(marker);
  });
  seats.sort(compareHouseSeats);
  for (const floor of [1, 2] as const) {
    const on = seats.filter((s) => s.floor === floor);
    on.forEach((s, idx) => {
      if (s.k !== idx) problems.push(`${n}번 집 ${floor}층: 자리 번호가 0부터 빈칸 없이 이어지지 않아요 (${s.id})`);
    });
    const got: Record<string, number> = {};
    for (const s of on) got[s.kind] = (got[s.kind] ?? 0) + 1;
    const want = HOUSE_SEAT_PLAN[n][floor];
    const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
    for (const key of keys) {
      const w = (want as Record<string, number>)[key] ?? 0;
      if ((got[key] ?? 0) !== w) problems.push(`${n}번 집 ${floor}층: ${key} 자리 ${got[key] ?? 0}개 — 설계표는 ${w}개`);
    }
  }
  return { seats, problems };
}

export function render(n: HouseNumber, seats: readonly HouseSeatMarker[]): string {
  const exp = houseGeneratedFiles(n).seatsExport;
  const lines = seats.map(
    (s) =>
      `  { id: ${JSON.stringify(s.id)}, n: ${s.n}, floor: ${s.floor}, k: ${s.k}, furn: ${JSON.stringify(s.furn)}, kind: ${JSON.stringify(s.kind)}, ` +
      `pose: ${JSON.stringify(s.pose)}, approach: ${JSON.stringify(s.approach)}, x: ${s.x}, z: ${s.z}, y: ${s.y}, yaw: ${s.yaw}, ` +
      `edge: ${s.edge}, back: ${s.back}, width: ${s.width}, group: ${JSON.stringify(s.group)}, both: ${s.both}, exitTurn: ${s.exitTurn}, lean: ${s.lean} },`,
  );
  return [
    "// GENERATED by scripts/gen-house-seats.ts — 손으로 고치지 않는다",
    `// house_${n}.glb의 seat__h${n}_<층>_<k> 표식(노드 위치 + extras)에서 뽑은 앉는 자리. 집·층·k 순서 (houseAreas.ts compareHouseSeats).`,
    `// 모델을 고치면 \`npx tsx --tsconfig server/tsconfig.json scripts/gen-house-seats.ts client/public/models/village/houses/house_${n}.glb\`로 다시 만든다.`,
    "",
    'import type { HouseSeatMarker } from "../../houseAreas";',
    "",
    `export const ${exp}: readonly HouseSeatMarker[] = [`,
    ...lines,
    "];",
    "",
  ].join("\n");
}

export function main(argv: string[]): number {
  const [glbPath, out] = argv;
  if (!glbPath || argv.length > 2) {
    console.error(USAGE);
    return 1;
  }
  const n = houseNumberFromFile(glbPath);
  if (n === null) {
    console.error(`FAIL: 파일 이름이 house_<1~10>.glb가 아니에요: ${glbPath}`);
    return 1;
  }
  let result;
  try {
    result = readHouse(parseGlb(fs.readFileSync(glbPath)).gltf, n);
  } catch (err) {
    console.error(`FAIL: ${glbPath}를 읽지 못했어요: ${(err as Error).message}`);
    return 1;
  }
  if (result.problems.length) {
    console.error(`FAIL: ${glbPath} — 약속과 다른 곳 ${result.problems.length}개`);
    for (const p of result.problems) console.error(`  - ${p}`);
    return 1;
  }
  const outFile = path.resolve(out ?? path.join(REPO, houseGeneratedFiles(n).seats));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, render(n, result.seats), "utf8");
  console.log(`PASS: ${n}번 집 — 자리 ${result.seats.length}개, 필수 노드·자리·상자 약속대로 → ${outFile}`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
