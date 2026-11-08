/**
 * e2e/luma-check.mjs — 밝은 낮 밝기 검사 (방탈출 1단계 Task 22).
 *
 *   node e2e/luma-check.mjs <png...>        (예: node e2e/luma-check.mjs "art/school/renders/style-*.png")
 *   node e2e/luma-check.mjs --night <frame.png[=mask.png]...>   (케이슨 마을의 밤 장면, Task 7A)
 *
 * PNG마다 화면 전체 픽셀의 감마 루마(sRGB 바이트 그대로: Y = (0.2126 R + 0.7152 G + 0.0722 B) / 255)를 구해
 *   평균 ≥ 0.45  그리고  5 백분위 ≥ 0.10   이면 PASS, 아니면 FAIL이다. 하나라도 FAIL이거나 읽지 못하면 종료 코드 1.
 * 이것이 Task 21에서 쓰고 받아들인 기준(구속력 있는 정의)이다. 선형 상대 휘도(WCAG)는 참고 열(lin=)로만 찍고 판정에 쓰지 않는다.
 * 5 백분위는 numpy.percentile처럼 선형 보간한다. 알파는 무시한다.
 *
 *
 * 밤 기준(--night, 케이슨 마을 Task 7A): 밤 장면은 어두워야 하므로 낮 기준을 쓰지 않는다. 대신
 *   화면 전체의 감마 루마 평균 ≥ 0.18  그리고  걸을 수 있는 바닥 픽셀의 감마 루마 중앙값(p50) ≥ 0.15  이면 PASS.
 * 걸을 수 있는 바닥은 장면마다 다르니 마스크 PNG(흰색 = 걷는 바닥, 검은색 = 나머지)로 받는다: `frame.png=mask.png`, 또는
 * 이름 규칙 `<이름>-frame.png` → `<이름>-walk.png` (그 밖에는 `<이름>.png` → `<이름>-walk.png`). 마스크 크기가 화면과 다르면
 * 가장 가까운 픽셀로 맞춘다. 마스크는 e2e/village-daynight.mjs가 같은 시점의 장면을 다시 그려 만든다: 바닥 재질(LM_grass,
 * LM_lawn, LM_plaza, LM_concrete, LM_stone)만 흰색, 나머지(하늘, 물, 건물, 나무, 아바타)는 검은색으로 그린 뒤, 그 픽셀의
 * 시선이 y = 0 바닥과 120 m 안, 걷기 범위 안에서 만나는 곳만 남긴다.
 *
 * 의존성 없음: PNG는 node:zlib로 직접 푼다(비인터레이스, 색 유형 0·2·3·4·6, 비트 깊이 1·2·4·8·16).
 * 따옴표로 감싼 `*`·`?` 패턴은 이 스크립트가 펼친다(PowerShell은 펼쳐 주지 않는다).
 * 순수 함수는 import해서 쓸 수 있다(테스트: server/src/tools/lumaCheck.test.ts).
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

export const MEAN_MIN = 0.45;
export const P5_MIN = 0.1;

// ---------------------------------------------------------------------------------------------------------
// Luminance.

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** An 8-bit sRGB channel value as linear light (0..1). */
export function srgbToLinear(v8) {
  return LINEAR[v8];
}

/** WCAG relative luminance of an 8-bit sRGB colour (0 black .. 1 white), on LINEAR light. Reference only: the pass rule uses `gammaLuma`. */
export function relativeLuminance(r, g, b) {
  return 0.2126 * LINEAR[r] + 0.7152 * LINEAR[g] + 0.0722 * LINEAR[b];
}

/** Gamma luma of an 8-bit sRGB colour (0 black .. 1 white): Rec.709 weights on the sRGB-encoded bytes. This is what the pass rule measures. */
export function gammaLuma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The p-th percentile (0..100) of an ascending list, linearly interpolated (numpy's default). */
export function percentile(sortedAscending, p) {
  const n = sortedAscending.length;
  if (n === 0) return 0;
  const index = ((n - 1) * p) / 100;
  const lo = Math.floor(index);
  const hi = Math.min(lo + 1, n - 1);
  return sortedAscending[lo] + (index - lo) * (sortedAscending[hi] - sortedAscending[lo]);
}

/**
 * Mean and 5th percentile of the GAMMA luma of RGBA pixels (alpha ignored): `mean` / `p5`, which the pass rule uses.
 * `linearMean` / `linearP5` are the same two numbers on linear relative luminance, for reference only.
 */
export function lumaStats(rgba) {
  const count = Math.floor(rgba.length / 4);
  const ys = new Float64Array(count);
  const lin = new Float64Array(count);
  let sum = 0;
  let linSum = 0;
  for (let i = 0; i < count; i += 1) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const y = gammaLuma(r, g, b);
    const l = relativeLuminance(r, g, b);
    ys[i] = y;
    lin[i] = l;
    sum += y;
    linSum += l;
  }
  ys.sort();
  lin.sort();
  return {
    mean: count ? sum / count : 0,
    p5: percentile(ys, 5),
    linearMean: count ? linSum / count : 0,
    linearP5: percentile(lin, 5),
  };
}

export function passes(stats) {
  return stats.mean >= MEAN_MIN && stats.p5 >= P5_MIN;
}

// ---------------------------------------------------------------------------------------------------------
// The night bar (케이슨 마을, Task 7A).

export const NIGHT_MEAN_MIN = 0.18;
export const NIGHT_WALK_P50_MIN = 0.15;

/**
 * Night numbers of a frame: the whole frame's gamma-luma mean and p5, and over the WALKABLE pixels (mask white, i.e. its
 * red byte >= 128; the mask is resampled to the frame by nearest neighbour) their share of the frame, median and mean.
 * `walkP50` is null when no pixel is walkable.
 */
export function nightStats(frame, mask) {
  const { width: W, height: H, rgba } = frame;
  const ys = new Float64Array(W * H);
  let sum = 0;
  for (let k = 0; k < W * H; k += 1) {
    const y = gammaLuma(rgba[k * 4], rgba[k * 4 + 1], rgba[k * 4 + 2]);
    ys[k] = y;
    sum += y;
  }
  const walk = [];
  for (let j = 0; j < H; j += 1) {
    const mj = Math.min(mask.height - 1, Math.floor(((j + 0.5) / H) * mask.height));
    for (let i = 0; i < W; i += 1) {
      const mi = Math.min(mask.width - 1, Math.floor(((i + 0.5) / W) * mask.width));
      if (mask.rgba[(mj * mask.width + mi) * 4] >= 128) walk.push(ys[j * W + i]);
    }
  }
  const sorted = Float64Array.from(ys).sort();
  walk.sort((a, b) => a - b);
  const n = W * H;
  return {
    mean: n ? sum / n : 0,
    p5: percentile(sorted, 5),
    walkShare: n ? walk.length / n : 0,
    walkP50: walk.length ? percentile(walk, 50) : null,
    walkMean: walk.length ? walk.reduce((a, b) => a + b, 0) / walk.length : null,
  };
}

export function passesNight(stats) {
  return stats.mean >= NIGHT_MEAN_MIN && stats.walkP50 !== null && stats.walkP50 >= NIGHT_WALK_P50_MIN;
}

/** The walkable mask's file for a frame: `x-frame.png` -> `x-walk.png`, else `x.png` -> `x-walk.png`. */
export function maskPathFor(framePath) {
  if (/-frame\.png$/i.test(framePath)) return framePath.replace(/-frame\.png$/i, "-walk.png");
  return framePath.replace(/\.png$/i, "") + "-walk.png";
}

// ---------------------------------------------------------------------------------------------------------
// PNG decoding (node:zlib only).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decodes a PNG to 8-bit RGBA ({ width, height, rgba }; 16-bit keeps the high byte). Throws a readable error on anything unsupported. */
export function decodePng(input) {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 8 || PNG_SIGNATURE.some((v, i) => buf[i] !== v)) throw new Error("PNG 파일이 아니에요");
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = 0;
  let palette = null;
  const idat = [];
  let pos = 8;
  let sawEnd = false;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const start = pos + 8;
    if (start + length + 4 > buf.length) throw new Error("PNG가 잘렸어요");
    if (type === "IHDR") {
      width = buf.readUInt32BE(start);
      height = buf.readUInt32BE(start + 4);
      depth = buf[start + 8];
      colorType = buf[start + 9];
      interlace = buf[start + 12];
    } else if (type === "PLTE") {
      palette = buf.subarray(start, start + length);
    } else if (type === "IDAT") {
      idat.push(buf.subarray(start, start + length));
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    pos = start + length + 4;
  }
  if (!sawEnd && idat.length === 0) throw new Error("PNG에 이미지 데이터가 없어요");
  const channels = CHANNELS[colorType];
  if (!channels || width <= 0 || height <= 0) throw new Error("PNG 머리말(IHDR)이 이상해요");
  if (![1, 2, 4, 8, 16].includes(depth)) throw new Error(`PNG 비트 깊이 ${depth}는 지원하지 않아요`);
  if (interlace !== 0) throw new Error("인터레이스(Adam7) PNG는 지원하지 않아요 (interlace)");
  if (colorType === 3 && !palette) throw new Error("팔레트 PNG에 PLTE가 없어요");

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  if (raw.length < (stride + 1) * height) throw new Error("PNG 이미지 데이터가 모자라요");

  // Undo the per-row filters in place.
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? pixels[dst + i - bpp] : 0;
      const b = y > 0 ? pixels[dst - stride + i] : 0;
      const c = y > 0 && i >= bpp ? pixels[dst - stride + i - bpp] : 0;
      let add;
      if (filter === 0) add = 0;
      else if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`PNG 필터 ${filter}는 알 수 없어요`);
      pixels[dst + i] = (raw[src + i] + add) & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  const maxValue = (1 << Math.min(depth, 8)) - 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      let r;
      let g;
      let b;
      let a = 255;
      if (colorType === 2 || colorType === 6) {
        const step = depth === 16 ? 2 : 1; // 16-bit: take the high byte
        const p = row + x * channels * step;
        r = pixels[p];
        g = pixels[p + step];
        b = pixels[p + 2 * step];
        if (colorType === 6) a = pixels[p + 3 * step];
      } else if (colorType === 0 || colorType === 4) {
        if (depth >= 8) {
          const step = depth >> 3;
          r = pixels[row + x * channels * step];
          if (colorType === 4) a = pixels[row + x * channels * step + step];
        } else {
          const bit = x * depth;
          const v = (pixels[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxValue;
          r = Math.round((v * 255) / maxValue);
        }
        g = r;
        b = r;
      } else {
        // Palette.
        let index;
        if (depth === 8) index = pixels[row + x];
        else {
          const bit = x * depth;
          index = (pixels[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & maxValue;
        }
        if (index * 3 + 2 >= palette.length) throw new Error("PNG 팔레트 번호가 범위 밖이에요");
        r = palette[index * 3];
        g = palette[index * 3 + 1];
        b = palette[index * 3 + 2];
      }
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------------------------------------
// CLI.

/** Expands `*` and `?` in the file-name part of `arg`; a pattern with no match (or a plain name) is returned as is. */
export function expandArg(arg) {
  const dir = path.dirname(arg);
  const base = path.basename(arg);
  if (!/[*?]/.test(base)) return [arg];
  const escaped = base.replace(/[.+^$(){}|[\]\\]/g, "\\$&");
  const regex = new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => regex.test(n));
  } catch {
    names = [];
  }
  names.sort();
  return names.length ? names.map((n) => path.join(dir, n)) : [arg];
}

export function main(argv) {
  if (argv[0] === "--night") return mainNight(argv.slice(1));
  if (argv.length === 0) {
    console.error("usage: node e2e/luma-check.mjs <png...>  |  --night <frame.png[=mask.png]...>");
    return 1;
  }
  let ok = true;
  for (const file of argv.flatMap(expandArg)) {
    try {
      const { rgba } = decodePng(fs.readFileSync(file));
      const stats = lumaStats(rgba);
      const good = passes(stats);
      ok = ok && good;
      console.log(
        `${good ? "PASS" : "FAIL"}  ${file}  mean=${stats.mean.toFixed(3)} (>= ${MEAN_MIN})  p5=${stats.p5.toFixed(3)} (>= ${P5_MIN})` +
          `  [linear ref: mean=${stats.linearMean.toFixed(3)} p5=${stats.linearP5.toFixed(3)}]`,
      );
    } catch (err) {
      ok = false;
      console.log(`FAIL  ${file}  ${err.message}`);
    }
  }
  return ok ? 0 : 1;
}

/** `--night`: every frame against the night bar, with its walkable mask (`frame=mask`, or the name rule). */
export function mainNight(argv) {
  if (argv.length === 0) {
    console.error("usage: node e2e/luma-check.mjs --night <frame.png[=mask.png]...>");
    return 1;
  }
  let ok = true;
  const items = argv.flatMap((arg) => {
    const eq = arg.indexOf("=");
    if (eq > 0) return [[arg.slice(0, eq), arg.slice(eq + 1)]];
    return expandArg(arg)
      .filter((f) => !/-walk\.png$/i.test(f))
      .map((f) => [f, maskPathFor(f)]);
  });
  for (const [file, maskFile] of items) {
    try {
      const stats = nightStats(decodePng(fs.readFileSync(file)), decodePng(fs.readFileSync(maskFile)));
      const good = passesNight(stats);
      ok = ok && good;
      const p50 = stats.walkP50 === null ? "none" : stats.walkP50.toFixed(3);
      console.log(
        `${good ? "PASS" : "FAIL"}  ${file}  night: mean=${stats.mean.toFixed(3)} (>= ${NIGHT_MEAN_MIN})  walk p50=${p50} (>= ${NIGHT_WALK_P50_MIN})` +
          `  [p5=${stats.p5.toFixed(3)} walkable ${(stats.walkShare * 100).toFixed(1)}% of the frame, mask ${maskFile}]`,
      );
    } catch (err) {
      ok = false;
      console.log(`FAIL  ${file}  ${err.message}`);
    }
  }
  return ok ? 0 : 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) process.exit(main(process.argv.slice(2)));
