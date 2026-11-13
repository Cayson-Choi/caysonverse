#!/usr/bin/env node
/**
 * 케이슨 마을 부하 테스트 런처: village.ts를 **한 프로세스**로 실행한다 — 봇이 `village` 방에 들어가 돌아다니고, 일부는
 * 추모관 문을 드나든다. 넘기는 인자: `--numClients`, `--duration`, `--statusDir`, `--doorShare`(0..1, 문을 쓰는 봇 비율),
 * `--hallStayMs`(추모관에 머무는 시간, 0 = 계속), `--offset`(닉네임 번호), `--endpoint`. 자세한 조합은 docs/loadtest.md 10절.
 *   node run.mjs --endpoint http://localhost:2567 --numClients 29 --duration 150 --doorShare 0 --statusDir <dir>
 *
 * village.ts가 자기 게이트를 판정해 종료 코드로 알린다(통과 0, 실패 1). 이 런처는 인자만 넘긴다.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));

// village.ts runs every bot in ONE process and judges its own gates (exit 0 = pass); this launcher passes the arguments through.
const villageArgs = [];
for (const k of ["endpoint", "numClients", "duration", "statusDir", "doorShare", "hallStayMs", "offset"]) {
  if (argv[k] !== undefined) villageArgs.push(`--${k}`, argv[k]);
}
const villageCli = join(HERE, "..", "node_modules", "tsx", "dist", "cli.mjs");
const village = spawn(process.execPath, [villageCli, join(HERE, "village.ts"), ...villageArgs], { cwd: HERE, env: process.env, stdio: "inherit" });
village.on("error", (e) => {
  console.error(`village.ts 실행 실패: ${e.message}`);
  process.exit(1);
});
village.on("exit", (code) => process.exit(code ?? 1));
