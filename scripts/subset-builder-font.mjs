#!/usr/bin/env node
/**
 * scripts/subset-builder-font.mjs — 조립실 제목용 글꼴(Jua) 부분집합을 만든다 (캐릭터 3단계 Task 7b).
 *
 *   node scripts/subset-builder-font.mjs [--font <Jua-Regular.ttf>]     (기본값: <repo>/art/fonts/Jua-Regular.ttf)
 *
 * art/ 는 gitignore 대상이고 main 체크아웃에만 있다. 워크트리에서는 --font 로 그 경로를 넘긴다(sync-character-assets.mjs
 * 의 --art 와 같은 방식). 필요한 것: Python + fontTools(pyftsubset). brotli 가 없으므로 WOFF2 가 아니라 WOFF 를 만든다.
 *
 * 하는 일:
 *   1. client/src/ui/builderOptions.ts 의 BUILDER_FONT_TEXT(조립실이 Jua 로 그리는 고정 글자: 제목·묶음 이름·탭·
 *      프리셋 이름·버튼·안내 — manifest slotLabels·프리셋·BUILDER_COPY·목소리·색 라벨에서 모은 것. 부품 카드 이름은
 *      본문 글꼴이라 넣지 않는다)를 Vite 모듈 러너로 읽는다.
 *   2. 글자마다 원본 글꼴에 있는지 본다. 없는 글자(예: "…")는 fallback 으로 적는다 — 브라우저가 다음 글꼴로 그린다.
 *   3. pyftsubset 으로 있는 글자만 남긴 WOFF 를 만든다(힌팅·레이아웃 기능 제거).
 *        → client/public/fonts/jua-builder.woff
 *   4. 글자 목록을 쓴다(builderFont.test.ts 가 문구와 WOFF cmap 에 대어 본다).
 *        → client/src/ui/builderFont.glyphs.json   { glyphs, fallback }
 *   5. 원본 옆의 OFL.txt 를 복사한다. → client/public/fonts/OFL-Jua.txt
 * 같은 입력으로 다시 돌리면 결과 파일이 바이트 단위로 같다(멱등).
 */

import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PYTHON = process.env.PYTHON || "python";
const USAGE = "usage: node scripts/subset-builder-font.mjs [--font <Jua-Regular.ttf>]";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let font = resolve(REPO, "art/fonts/Jua-Regular.ttf");
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--font") {
      const value = argv[i + 1];
      if (!value) fail(`--font needs a .ttf file\n${USAGE}`);
      font = resolve(value);
      i += 1;
    } else {
      fail(`unknown argument ${argv[i]}\n${USAGE}`);
    }
  }
  return font;
}

const srcFont = parseArgs(process.argv.slice(2));
const srcOfl = resolve(dirname(srcFont), "OFL.txt");
const dstWoff = resolve(REPO, "client/public/fonts/jua-builder.woff");
const dstOfl = resolve(REPO, "client/public/fonts/OFL-Jua.txt");
const dstGlyphs = resolve(REPO, "client/src/ui/builderFont.glyphs.json");

for (const file of [srcFont, srcOfl]) if (!existsSync(file)) fail(`missing source file ${file}`);

// 1. 문구 — 클라이언트와 같은 별칭(@caysonverse/shared → shared/src)으로 TS 모듈을 그대로 불러온다.
const { runnerImport } = await import("vite");
const { module: options } = await runnerImport(resolve(REPO, "client/src/ui/builderOptions.ts"), {
  root: resolve(REPO, "client"),
  configFile: false,
  logLevel: "silent",
  resolve: { alias: { "@caysonverse/shared": resolve(REPO, "shared/src") } },
});
const text = options.BUILDER_FONT_TEXT;
if (typeof text !== "string" || text.length === 0) fail("BUILDER_FONT_TEXT is empty");
const codePoints = [...new Set(Array.from(text, (c) => c.codePointAt(0)))].sort((a, b) => a - b);

// 2. 원본 cmap 에 있는 글자.
const probe = spawnSync(
  PYTHON,
  [
    "-c",
    "import sys\nfrom fontTools.ttLib import TTFont\ncmap = TTFont(sys.argv[1]).getBestCmap()\nprint(' '.join(c for c in sys.argv[2:] if int(c) in cmap))",
    srcFont,
    ...codePoints.map(String),
  ],
  { encoding: "utf8" },
);
if (probe.error || probe.status !== 0) fail(`could not read the font with fontTools (${PYTHON}): ${probe.error?.message ?? probe.stderr}`);
const present = new Set(probe.stdout.trim().split(/\s+/).filter(Boolean).map(Number));
const glyphs = codePoints.filter((c) => present.has(c));
const fallback = codePoints.filter((c) => !present.has(c));
if (glyphs.length === 0) fail("the font has none of the builder's characters");

// 3. 부분집합 WOFF.
mkdirSync(dirname(dstWoff), { recursive: true });
const subset = spawnSync(
  PYTHON,
  [
    "-m",
    "fontTools.subset",
    srcFont,
    `--unicodes=${glyphs.map((c) => c.toString(16).toUpperCase().padStart(4, "0")).join(",")}`,
    "--flavor=woff",
    `--output-file=${dstWoff}`,
    "--no-hinting",
    "--desubroutinize",
    "--layout-features=",
    "--name-IDs=0,1,2,3,4,5,6,13,14",
    "--drop-tables+=DSIG",
  ],
  { encoding: "utf8" },
);
if (subset.error || subset.status !== 0) fail(`pyftsubset failed: ${subset.error?.message ?? subset.stderr}`);

// 4. 글자 목록, 5. 라이선스.
const chars = (list) => String.fromCodePoint(...list);
writeFileSync(dstGlyphs, `${JSON.stringify({ font: "Jua-Regular.ttf", glyphs: chars(glyphs), fallback: chars(fallback) }, null, 2)}\n`);
copyFileSync(srcOfl, dstOfl);

const rel = (p) => relative(REPO, p).replaceAll("\\", "/");
console.log(`글자 ${codePoints.length}개 (Jua ${glyphs.length}, 다음 글꼴로 ${fallback.length}: ${JSON.stringify(chars(fallback))})`);
for (const file of [dstWoff, dstGlyphs, dstOfl]) console.log(`  ${rel(file)}  ${statSync(file).size.toLocaleString("en-US")} B`);
