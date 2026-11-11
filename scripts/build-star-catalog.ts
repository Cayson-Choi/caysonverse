/**
 * scripts/build-star-catalog.ts — 케이슨 마을 밤하늘의 별 파일 `client/public/sky/stars.v1.bin`을 만든다.
 *
 *   npx tsx scripts/build-star-catalog.ts <ybsc5 또는 ybsc5.gz 경로> [out.bin]
 *
 * 입력은 예일 밝은 별 목록 5판(The Bright Star Catalogue, 5th Revised Ed., D. Hoffleit & W. H. Warren Jr., NASA ADC
 * 1991, CDS V/50; 사본 http://tdc-www.harvard.edu/catalogs/ybsc5.gz)의 고정 폭 파일이다. 원본은 저장소에 넣지 않는다
 * (출처·판단은 docs/licenses.md와 client/public/sky/LICENSE.md). 여기서 뽑는 것은 별마다 숫자 네 가지(J2000 적경·적위,
 * V 등급, B−V)와 HR 번호뿐이다. 이름·주석은 싣지 않는다.
 *
 * 고르는 별: V ≤ 5.5이고 마을(북위 36.5°)에서 떠오를 수 있는 별(적위 > −53.5°), 그리고 별자리 선(shared/…/constellations.ts)에
 * 쓰는 별은 등급과 상관없이 모두. 선에 쓴 별이 목록에 없으면 실패한다. 밝은 별부터 순서대로 저장한다(가벼운 화질 단계가
 * 앞에서부터 일부만 그린다).
 *
 * 형식 (리틀 엔디언): 머리 16바이트 = "CVS1" · 별 수 u16 · V ≤ 3.0 / 4.0 / 4.5 / 5.0 / 5.5 누적 개수 u16 × 5.
 * 별마다 8바이트 = HR u16 · 적경 u16 (RA/360° × 65536) · 적위 i16 (Dec/90° × 32767) · 등급 u8 ((V + 2) × 25) ·
 * B−V u8 ((B−V + 0.5) × 70, 없으면 255). client/src/village/sky/starCatalog.ts가 읽는다.
 *
 * 같은 입력이면 출력은 바이트 단위로 같다. 입력과 출력의 SHA-256을 찍는다. 의존성 없음.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { allFigureStars } from "../shared/src/village/constellations";

const REPO = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(REPO, "client", "public", "sky", "stars.v1.bin");
const USAGE = "usage: npx tsx scripts/build-star-catalog.ts <ybsc5[.gz]> [out.bin]";

/** The magnitude cut and the southern limit (a star further south never rises at 36.5° N). */
export const MAG_CUT = 5.5;
export const DEC_MIN = 36.5 - 90;
/** The cumulative counts stored in the header. */
export const CUTS = [3, 4, 4.5, 5, 5.5] as const;

export interface CatalogRow {
  hr: number;
  raDeg: number;
  decDeg: number;
  v: number;
  bv: number | null;
}

/** Parse the fixed-width BSC5 records (byte layout from ybsc5.readme); entries without a position or a V are skipped. */
export function parseBsc5(text: string): CatalogRow[] {
  const rows: CatalogRow[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (l.length < 107) continue;
    const rah = l.slice(75, 77).trim();
    const vs = l.slice(102, 107).trim();
    if (rah === "" || vs === "") continue; // the 14 removed objects (novae, galaxies) have no J2000 position
    const raDeg = (Number(rah) + Number(l.slice(77, 79)) / 60 + Number(l.slice(79, 83)) / 3600) * 15;
    const sign = l[83] === "-" ? -1 : 1;
    const decDeg = sign * (Number(l.slice(84, 86)) + Number(l.slice(86, 88)) / 60 + Number(l.slice(88, 90)) / 3600);
    const bvs = l.slice(109, 114).trim();
    rows.push({ hr: Number(l.slice(0, 4)), raDeg, decDeg, v: Number(vs), bv: bvs === "" ? null : Number(bvs) });
  }
  return rows;
}

/** Choose and pack the stars. Throws when a figure star is missing from the catalogue. */
export function packCatalog(all: CatalogRow[], keep: readonly number[]): { bytes: Buffer; count: number; cuts: number[]; maxErrArcsec: number } {
  const byHr = new Map(all.map((r) => [r.hr, r]));
  const missing = keep.filter((hr) => !byHr.has(hr));
  if (missing.length) throw new Error(`figure stars missing from the catalogue: HR ${missing.join(", ")}`);
  const keepSet = new Set(keep);
  const rows = all.filter((r) => keepSet.has(r.hr) || (r.v <= MAG_CUT && r.decDeg > DEC_MIN));
  rows.sort((a, b) => a.v - b.v || a.hr - b.hr);
  if (rows.length > 0xffff) throw new Error("too many stars for a u16 count");
  const cuts = CUTS.map((c) => rows.filter((r) => r.v <= c).length);
  const buf = Buffer.alloc(16 + rows.length * 8);
  buf.write("CVS1", 0, "ascii");
  buf.writeUInt16LE(rows.length, 4);
  cuts.forEach((n, i) => buf.writeUInt16LE(n, 6 + i * 2));
  let maxErr = 0;
  rows.forEach((r, i) => {
    const o = 16 + i * 8;
    const raQ = Math.round((r.raDeg / 360) * 65536) & 0xffff;
    const decQ = Math.round((r.decDeg / 90) * 32767);
    buf.writeUInt16LE(r.hr, o);
    buf.writeUInt16LE(raQ, o + 2);
    buf.writeInt16LE(decQ, o + 4);
    buf.writeUInt8(Math.max(0, Math.min(255, Math.round((r.v + 2) * 25))), o + 6);
    buf.writeUInt8(r.bv === null ? 255 : Math.max(0, Math.min(254, Math.round((r.bv + 0.5) * 70))), o + 7);
    const ra2 = (raQ / 65536) * 360;
    const dec2 = (decQ / 32767) * 90;
    const dra = ((ra2 - r.raDeg + 540) % 360) - 180;
    maxErr = Math.max(maxErr, Math.hypot(dra * Math.cos((r.decDeg * Math.PI) / 180), dec2 - r.decDeg));
  });
  return { bytes: buf, count: rows.length, cuts, maxErrArcsec: maxErr * 3600 };
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

export function main(argv: string[]): number {
  if (argv.length < 1 || argv.length > 2) {
    console.error(USAGE);
    return 1;
  }
  const input = path.resolve(argv[0]!);
  const outFile = path.resolve(argv[1] ?? DEFAULT_OUT);
  const raw = fs.readFileSync(input);
  const text = (input.endsWith(".gz") ? zlib.gunzipSync(raw) : raw).toString("latin1");
  const all = parseBsc5(text);
  const { bytes, count, cuts, maxErrArcsec } = packCatalog(all, allFigureStars());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, bytes);
  console.log(`input  ${input}  ${raw.length} bytes  sha256 ${sha256(raw)}`);
  console.log(`parsed ${all.length} catalogue entries with a position and V`);
  console.log(`output ${outFile}  ${bytes.length} bytes  sha256 ${sha256(bytes)}`);
  console.log(`stars ${count}; cumulative at V <= ${CUTS.join(" / ")}: ${cuts.join(" / ")}; max position error ${maxErrArcsec.toFixed(1)}"`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
