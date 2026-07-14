#!/usr/bin/env node
/**
 * 100봇 부하 테스트 런처: bot.ts를 여러 프로세스(샤드)로 나눠 실행한다.
 *
 * 샤딩은 안전 마진이다: bot.ts의 와일드카드 onMessage 수정(TUI O(n²) 로그 누적 차단,
 * bot.ts 참고) 이후에는 단일 프로세스 100봇도 코어의 ~8%로 안정 동작함을 실측했다.
 * 그래도 프로세스를 나누면 부하 생성기 쪽 이벤트 루프 정체가 서버 측정을 오염시킬
 * 여지가 더 줄고, 프로세스별 종료/집계가 깔끔해서 기본 4샤드로 실행한다.
 *
 * 사용:
 *   node run.mjs --numClients 100 --shards 4 --duration 600 \
 *     --endpoint http://localhost:2567 --statusDir <dir>
 *
 * 각 샤드는 CV_BOT_OFFSET으로 닉네임 번호를 이어받고(봇001…봇100), 자기 통계를
 * <statusDir>/shard-<n>.json 하트비트로 남긴다. duration이 지나면 샤드 프로세스
 * 트리를 종료하고 하트비트들을 합산해 요약을 출력한다.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
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
const numClients = Number(argv.numClients ?? 100);
// Post-fix a single process handles 100 bots at ~8% of a core (see header);
// 4 shards is pure safety margin, not a requirement.
const shards = Number(argv.shards ?? 4);
const durationSec = Number(argv.duration ?? 600);
const endpoint = argv.endpoint ?? "http://localhost:2567";
const statusDir = argv.statusDir ?? join(HERE, "status");

mkdirSync(statusDir, { recursive: true });

const perShard = Math.floor(numClients / shards);
const remainder = numClients - perShard * shards;
const tsxCli = join(HERE, "..", "node_modules", "tsx", "dist", "cli.mjs");

const children = [];
let offset = 0;
for (let s = 0; s < shards; s++) {
  const count = perShard + (s < remainder ? 1 : 0);
  const statusFile = join(statusDir, `shard-${s}.json`);
  const child = spawn(
    process.execPath,
    [tsxCli, join(HERE, "bot.ts"), "--room", "world", "--numClients", String(count), "--endpoint", endpoint, "--delay", "50"],
    {
      cwd: HERE,
      env: { ...process.env, CV_BOT_OFFSET: String(offset), CV_LOADTEST_STATUS: statusFile },
      stdio: ["ignore", "ignore", "pipe"], // stderr = join failures/disconnects
    },
  );
  child.stderr.on("data", (d) => process.stderr.write(`[shard-${s}] ${d}`));
  child.on("error", (e) => console.error(`[shard-${s}] spawn 실패: ${e.message}`));
  children.push({ child, statusFile, shard: s });
  console.log(`[shard-${s}] ${count}봇 시작 (offset=${offset}, pid=${child.pid})`);
  offset += count;
}

/** Kill a shard's whole process tree (tsx spawns a child node on Windows). */
function killTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

function aggregate() {
  const total = {
    joinAttempts: 0,
    joined: 0,
    joinFailures: 0,
    disconnects: 0,
    roomErrors: 0,
    drops: 0,
    reconnects: 0,
    movesSent: 0,
    chatsSent: 0,
    emojisSent: 0,
    bytesReceived: 0,
  };
  for (const { statusFile, shard } of children) {
    try {
      const s = JSON.parse(readFileSync(statusFile, "utf8"));
      for (const key of Object.keys(total)) total[key] += s[key] ?? 0;
    } catch {
      console.error(`[shard-${shard}] 상태 파일을 읽지 못했습니다: ${statusFile}`);
    }
  }
  return total;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`${numClients}봇 / ${shards}샤드 / ${durationSec}s 실행 중... (endpoint: ${endpoint})`);

// Periodic aggregate progress so an operator can see liveness at a glance.
const progress = setInterval(() => {
  const t = aggregate();
  console.log(
    `[진행] joined ${t.joined}/${numClients}  이탈 ${t.disconnects}  오류 ${t.roomErrors}  이동 ${t.movesSent}`,
  );
}, 30_000);

await sleep(durationSec * 1000);
clearInterval(progress);

console.log("실행 시간 종료 — 샤드 종료 중...");
for (const { child } of children) killTree(child.pid);
await sleep(1500); // let the OS reap the trees before the final read

const t = aggregate();
console.log("\n=== 봇 요약 (하트비트 합산, 최대 5s 오차) ===");
console.log(`join 시도: ${t.joinAttempts} / 성공: ${t.joined} / 실패: ${t.joinFailures}`);
console.log(`중도 이탈(테스트 중 절단): ${t.disconnects}`);
console.log(`순단/재접속: ${t.drops} / ${t.reconnects}`);
console.log(`방 오류: ${t.roomErrors}`);
console.log(`전송 — 이동: ${t.movesSent}, 채팅: ${t.chatsSent}, 이모지: ${t.emojisSent}`);
const perClientDownKBs = t.bytesReceived / 1024 / Math.max(1, numClients) / durationSec;
console.log(
  `수신 합계: ${(t.bytesReceived / 1024 / 1024).toFixed(1)}MB` +
    ` (클라이언트당 다운스트림 ≈ ${perClientDownKBs.toFixed(1)}KB/s)`,
);
process.exit(0);
