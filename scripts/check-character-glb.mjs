#!/usr/bin/env node
/**
 * scripts/check-character-glb.mjs — 조립식 캐릭터 GLB 점검 (캐릭터 조립실 설계 5.1·6장).
 *
 *   node scripts/check-character-glb.mjs <character.glb> <character.manifest.json>
 *
 * 확인하는 것:
 *   1. manifest의 모든 부품(slot__id)이 GLB 메시 노드 이름으로 존재한다.
 *   2. 공통 몸 메시(body__head/hands/torso/legs/feet)가 모두 있다.
 *   3. GLB의 동작 클립 목록이 manifest.clips와 정확히 같다.
 *   4. 파일 크기를 출력하고, manifest.maxBytes를 넘으면 실패한다.
 *   5. manifest.hatVariants의 모든 모자용 머리카락 메시(hair__<id>__hat)가 있고,
 *      slots.hair의 모든 머리카락에 모자용 변형이 지정되어 있다.
 *   6. manifest.npcOnly의 모든 부품(slot__id)이 메시로 있고, 조립실 목록(slots)에는 없다.
 *   7. manifest.clipVariants(예: 롱스커트용 보폭 작은 동작)의 원래 클립과 변형 클립이 모두 GLB에 있다.
 *   8. manifest.hatHidesHair(머리를 다 덮는 투구·헬멧: 쓰면 머리카락을 숨김)의 id가 모두 slots.hat에 있다.
 * 통과하면 종료 코드 0, 하나라도 어긋나면 1. 의존성 없음(node 내장만).
 */

import { readFileSync, statSync } from "node:fs";

const [glbPath, manifestPath] = process.argv.slice(2);
if (!glbPath || !manifestPath) {
  console.error("usage: node scripts/check-character-glb.mjs <glb> <manifest>");
  process.exit(1);
}

const BODY = ["body__head", "body__hands", "body__torso", "body__legs", "body__feet"];
const problems = [];

let glb;
let manifest;
try {
  glb = readFileSync(glbPath);
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (err) {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
}

// GLB: 12-byte header, then the JSON chunk (length, type 'JSON', payload).
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8"));
const meshNodes = new Set((gltf.nodes ?? []).filter((n) => n.mesh !== undefined).map((n) => n.name));
const clips = (gltf.animations ?? []).map((a) => a.name).sort();

for (const name of BODY) if (!meshNodes.has(name)) problems.push(`missing body mesh ${name}`);
for (const [slot, ids] of Object.entries(manifest.slots ?? {})) {
  for (const id of ids) {
    if (!meshNodes.has(`${slot}__${id}`)) problems.push(`missing part mesh ${slot}__${id}`);
  }
}
for (const id of manifest.slots?.hair ?? []) {
  if (!manifest.hatVariants?.[id]) problems.push(`hair ${id} has no hatVariants entry`);
}
for (const [id, mesh] of Object.entries(manifest.hatVariants ?? {})) {
  if (!meshNodes.has(mesh)) problems.push(`missing hat variant mesh ${mesh} (hair ${id})`);
}
for (const [slot, ids] of Object.entries(manifest.npcOnly ?? {})) {
  for (const id of ids) {
    if (!meshNodes.has(`${slot}__${id}`)) problems.push(`missing npcOnly mesh ${slot}__${id}`);
    if ((manifest.slots?.[slot] ?? []).includes(id)) problems.push(`npcOnly part ${slot}__${id} is also listed in slots`);
  }
}
for (const [part, map] of Object.entries(manifest.clipVariants ?? {})) {
  for (const [base, variant] of Object.entries(map)) {
    if (!clips.includes(base)) problems.push(`clipVariants.${part}: base clip ${base} not in GLB`);
    if (!clips.includes(variant)) problems.push(`clipVariants.${part}: variant clip ${variant} not in GLB`);
  }
}
for (const id of manifest.hatHidesHair ?? []) {
  if (!(manifest.slots?.hat ?? []).includes(id)) problems.push(`hatHidesHair: ${id} is not a hat in slots.hat`);
}
const want = [...(manifest.clips ?? [])].sort();
if (JSON.stringify(want) !== JSON.stringify(clips)) {
  problems.push(`clips differ: glb=[${clips.join(", ")}] manifest=[${want.join(", ")}]`);
}

const bytes = statSync(glbPath).size;
console.log(`size: ${(bytes / 1024 / 1024).toFixed(2)} MB (${bytes} bytes)`);
console.log(`meshes: ${[...meshNodes].sort().join(", ")}`);
console.log(`clips: ${clips.join(", ")}`);
if (manifest.maxBytes && bytes > manifest.maxBytes) {
  problems.push(`size ${bytes} exceeds maxBytes ${manifest.maxBytes}`);
}

if (problems.length) {
  for (const p of problems) console.error(`FAIL: ${p}`);
  process.exit(1);
}
console.log("PASS");
