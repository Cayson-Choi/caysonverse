#!/usr/bin/env node
/**
 * scripts/dump-uv-cells.mjs — KayKit GLB 아틀라스 칸(UV cell) 실측 덤프 (v2 Task 13).
 *
 * 왕실 캐릭터 팔레트 교체(royalPalette.ts)의 재도색 칸·보호 칸 표는 "이 스크립트의
 * 출력"으로 확정한다 — 사전 리서치 좌표를 신뢰하지 않고 재검증하는 단일 근거.
 *
 *   node scripts/dump-uv-cells.mjs [--grid 8] [--png-out DIR] [models/*.glb ...]
 *
 * 인자 없이 실행하면 client/public/models/{knight,barbarian,mage,rogue}.glb 전부.
 * 출력(모델별):
 *   1. 임베디드 아틀라스 PNG 정보(크기·컬러타입) + --png-out 지정 시 파일 추출
 *   2. grid×grid 칸별 중심 픽셀 색상표 (팔레트 레시피의 색 근거)
 *   3. 노드 목록(이름/메시/부모/비단위 TRS) — 무기·망토 노드 실측
 *   4. 메시(=노드 이름)별 사용 칸 집합: (col,row):정점수 — 재도색/보호 칸의 근거
 *   5. 칸→메시 역인덱스 — 피부 칸 공유(도적 Head·Leg 등) 충돌 검출
 *   6. hips 본 translation Y 범위(Idle/Walking_A/Sit_Chair_Down/Sit_Chair_Idle)
 *      — 공주 페플럼 "착석 시 숨김" 포즈 임계값의 실측 근거
 *
 * 의존성 없음(node 내장만): GLB 컨테이너·glTF 접근자·PNG(비인터레이스, 컬러타입
 * 0/2/3/6, 비트깊이 1/2/4/8) 디코더를 자체 구현. 좌표 규약: flipY=false 기준으로
 * v=0 이 PNG 최상단 행 — 따라서 row 는 이미지 위→아래, col 은 왼→오른쪽.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { basename, join } from "node:path";

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let GRID = 8;
let PNG_OUT = null;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--grid") GRID = Number(args[++i]);
  else if (args[i] === "--png-out") PNG_OUT = args[++i];
  else files.push(args[i]);
}
if (files.length === 0) {
  for (const name of ["knight", "barbarian", "mage", "rogue"]) {
    files.push(new URL(`../client/public/models/${name}.glb`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  }
}

// ── GLB 컨테이너 ─────────────────────────────────────────────────────────────
function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("glTF magic 아님");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length + (length % 4 === 0 ? 0 : 4 - (length % 4));
  }
  return { json, bin };
}

const COMPONENT = {
  5120: { size: 1, read: (v, o) => v.readInt8(o), norm: 127 },
  5121: { size: 1, read: (v, o) => v.readUInt8(o), norm: 255 },
  5122: { size: 2, read: (v, o) => v.readInt16LE(o), norm: 32767 },
  5123: { size: 2, read: (v, o) => v.readUInt16LE(o), norm: 65535 },
  5125: { size: 4, read: (v, o) => v.readUInt32LE(o), norm: 0 },
  5126: { size: 4, read: (v, o) => v.readFloatLE(o), norm: 0 },
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** 접근자 → number[] (count×components, normalized 반영). */
function readAccessor(json, bin, index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const comp = COMPONENT[acc.componentType];
  const perElem = TYPE_COMPONENTS[acc.type];
  const stride = view.byteStride ?? comp.size * perElem;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Array(acc.count * perElem);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < perElem; c++) {
      let v = comp.read(bin, base + i * stride + c * comp.size);
      if (acc.normalized && comp.norm) v /= comp.norm;
      out[i * perElem + c] = v;
    }
  }
  return out;
}

// ── PNG 디코더 (비인터레이스, 컬러타입 0/2/3/6) ─────────────────────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG 시그니처 아님");
  let width = 0, height = 0, bitDepth = 8, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (interlace !== 0) throw new Error("인터레이스 PNG 미지원");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const bitsPerPixel = bitDepth * channels;
  const bytesPerLine = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8)); // 필터 기준 픽셀 바이트
  const lines = Buffer.alloc(height * bytesPerLine);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (bytesPerLine + 1)];
    const src = raw.subarray(y * (bytesPerLine + 1) + 1, (y + 1) * (bytesPerLine + 1));
    const cur = lines.subarray(y * bytesPerLine, (y + 1) * bytesPerLine);
    const prev = y > 0 ? lines.subarray((y - 1) * bytesPerLine, y * bytesPerLine) : null;
    for (let x = 0; x < bytesPerLine; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = src[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
  }
  /** 픽셀 → [r,g,b,a] (비트깊이 <8 은 인덱스/그레이만 해당). */
  function getPixel(x, y) {
    const line = y * bytesPerLine;
    let sample;
    if (bitDepth === 8) sample = (c) => lines[line + x * channels + c];
    else if (bitDepth === 16) sample = (c) => lines[line + (x * channels + c) * 2];
    else {
      const bitOff = x * bitsPerPixel;
      const byte = lines[line + (bitOff >> 3)];
      const shift = 8 - bitDepth - (bitOff & 7);
      const raw0 = (byte >> shift) & ((1 << bitDepth) - 1);
      sample = () => raw0;
    }
    if (colorType === 3) {
      const idx = sample(0);
      const a = trns && idx < trns.length ? trns[idx] : 255;
      return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], a];
    }
    if (colorType === 0) {
      const g = bitDepth < 8 ? Math.round((sample(0) * 255) / ((1 << bitDepth) - 1)) : sample(0);
      return [g, g, g, 255];
    }
    if (colorType === 2) return [sample(0), sample(1), sample(2), 255];
    if (colorType === 4) return [sample(0), sample(0), sample(0), sample(1)];
    return [sample(0), sample(1), sample(2), sample(3)];
  }
  return { width, height, colorType, bitDepth, getPixel };
}

const hex = (rgb) => "#" + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");

// ── 모델별 덤프 ──────────────────────────────────────────────────────────────
for (const file of files) {
  const { json, bin } = parseGlb(readFileSync(file));
  const model = basename(file);
  console.log(`\n${"═".repeat(74)}\n═══ ${model} ═══`);

  // 1) 임베디드 이미지 → 디코드(+선택 추출)
  const images = (json.images ?? []).map((img, i) => {
    const view = json.bufferViews[img.bufferView];
    const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const png = decodePng(bytes);
    console.log(
      `image[${i}] name=${img.name ?? "?"} mime=${img.mimeType} ${png.width}x${png.height}` +
        ` colorType=${png.colorType} bitDepth=${png.bitDepth} bytes=${view.byteLength}`,
    );
    if (PNG_OUT) {
      mkdirSync(PNG_OUT, { recursive: true });
      const out = join(PNG_OUT, `${model.replace(/\.glb$/, "")}-image${i}.png`);
      writeFileSync(out, bytes);
      console.log(`  → ${out}`);
    }
    return png;
  });

  // 2) 칸별 중심 색상표 (첫 이미지 = 본체 아틀라스)
  const atlas = images[0];
  if (atlas) {
    console.log(`\n칸 중심 색상 (grid ${GRID}x${GRID}, row=이미지 위→아래 / v=0 상단):`);
    for (let row = 0; row < GRID; row++) {
      const cells = [];
      for (let col = 0; col < GRID; col++) {
        const x = Math.floor(((col + 0.5) * atlas.width) / GRID);
        const y = Math.floor(((row + 0.5) * atlas.height) / GRID);
        cells.push(hex(atlas.getPixel(x, y)));
      }
      console.log(`  row${row}: ${cells.join(" ")}`);
    }
  }

  // 3) 노드 목록 (부모·TRS 포함 — 무기/망토의 기본 상태 실측)
  const parents = new Map();
  json.nodes.forEach((node, i) => (node.children ?? []).forEach((c) => parents.set(c, i)));
  console.log("\n노드 (mesh 보유 또는 비단위 TRS만):");
  json.nodes.forEach((node, i) => {
    const trs = [];
    if (node.translation) trs.push(`t=[${node.translation.map((v) => v.toFixed(3)).join(",")}]`);
    if (node.rotation) trs.push(`r=[${node.rotation.map((v) => v.toFixed(3)).join(",")}]`);
    if (node.scale) trs.push(`s=[${node.scale.map((v) => v.toFixed(3)).join(",")}]`);
    if (node.mesh === undefined && trs.length === 0) return;
    const parent = parents.has(i) ? json.nodes[parents.get(i)].name : "(root)";
    const mesh = node.mesh !== undefined ? ` mesh=${node.mesh}` : "";
    const skin = node.skin !== undefined ? ` skin=${node.skin}` : "";
    console.log(`  [${i}] ${node.name}${mesh}${skin} parent=${parent} ${trs.join(" ")}`);
  });

  // 4) 메시별 사용 칸 (노드 이름 기준 — 같은 mesh 를 여러 노드가 참조할 수 있음)
  console.log(`\n메시별 사용 칸 (grid ${GRID}x${GRID}, (col,row):UV점수):`);
  const cellMeshes = new Map(); // "col,row" → Set<meshName>
  for (const node of json.nodes) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh];
    mesh.primitives.forEach((prim, p) => {
      if (prim.attributes.TEXCOORD_0 === undefined) return;
      const uv = readAccessor(json, bin, prim.attributes.TEXCOORD_0);
      const counts = new Map();
      for (let i = 0; i < uv.length; i += 2) {
        const col = Math.min(GRID - 1, Math.max(0, Math.floor(uv[i] * GRID)));
        const row = Math.min(GRID - 1, Math.max(0, Math.floor(uv[i + 1] * GRID)));
        const key = `${col},${row}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (!cellMeshes.has(key)) cellMeshes.set(key, new Set());
        cellMeshes.get(key).add(node.name);
      }
      const total = uv.length / 2;
      const parts = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `(${k}):${n}`);
      const mat = prim.material !== undefined ? json.materials[prim.material].name : "-";
      console.log(`  ${node.name} prim${p} mat=${mat} verts=${total}\n    ${parts.join(" ")}`);
    });
  }

  // 5) 칸→메시 역인덱스 (공유 칸 = 보호 목록 후보 검출)
  console.log("\n칸→메시 역인덱스 (2개 이상 메시가 공유하는 칸만):");
  const shared = [...cellMeshes.entries()]
    .filter(([, set]) => set.size >= 2)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [key, set] of shared) console.log(`  (${key}): ${[...set].join(", ")}`);

  // 6) hips 본 translation Y 범위 — 페플럼 착석 숨김 임계값의 실측 근거
  const hipsIndex = json.nodes.findIndex((n) => /^hips$/i.test(n.name ?? ""));
  if (hipsIndex >= 0 && json.animations) {
    console.log("\nhips translation Y 범위 (clip: minY..maxY / rest):");
    const rest = json.nodes[hipsIndex].translation?.[1];
    console.log(`  rest(bind) Y = ${rest !== undefined ? rest.toFixed(4) : "?"}`);
    for (const name of ["Idle", "Walking_A", "Sit_Chair_Down", "Sit_Chair_Idle", "Sit_Chair_StandUp"]) {
      const clip = json.animations.find((a) => a.name === name);
      if (!clip) continue;
      const chan = clip.channels.find(
        (c) => c.target.node === hipsIndex && c.target.path === "translation",
      );
      if (!chan) {
        console.log(`  ${name}: (hips translation 트랙 없음)`);
        continue;
      }
      const out = readAccessor(json, bin, clip.samplers[chan.sampler].output);
      let min = Infinity, max = -Infinity;
      for (let i = 1; i < out.length; i += 3) {
        if (out[i] < min) min = out[i];
        if (out[i] > max) max = out[i];
      }
      console.log(`  ${name}: ${min.toFixed(4)}..${max.toFixed(4)}`);
    }
  }
}
