#!/usr/bin/env node
/**
 * scripts/loadtest-bots.mjs — the 100-player load test on a LOCAL server (perf/no-hitch, 2026-11-17; owner: "100명이 플레이하는데
 * 끊김이나 렉이나 이런게 걸리면 안돼"). Never point it at the real server: it starts its own.
 *
 *   npm run build -w server
 *   node scripts/loadtest-bots.mjs --clients 100 --duration 180 [--port 3119] [--mix 40,15,15,10,10,10] [--out <dir>]
 *        [--server bundle|tsx] [--max-clients 100] [--label x]
 *
 * 1. Starts the server (the production bundle server/dist/index.cjs by default, NODE_ENV=production with the probe allowed;
 *    `--server tsx` runs the sources) with CV_PERF_LOG (server/src/perfProbe.ts: event-loop delay, patch tick times,
 *    message handler time, patch bytes, CPU, RSS every 5 s). `--max-clients` sets CV_VILLAGE_MAX_CLIENTS (players per room).
 * 2. Runs loadtest/mix.ts: N bots walking, chatting, sitting, fishing, going into the memorial and house 1, asking for the bus.
 * 3. Summarises the probe over the time all bots were in (first 10 s after the last join skipped) and judges:
 *      event-loop delay p99 <= 50 ms, patch tick p99 <= 20 ms, RSS max <= 600 MB, 0 disconnects / room errors, all joined.
 *    Writes <out>/loadtest-<label>.json and .md, exit 1 when a gate fails.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values: a } = parseArgs({
  options: {
    clients: { type: "string", default: "100" },
    duration: { type: "string", default: "180" },
    port: { type: "string", default: "3119" },
    mix: { type: "string", default: "40,15,15,10,10,10" },
    out: { type: "string", default: join(REPO, ".superpowers", "sdd", "evidence", "loadtest-bots") },
    server: { type: "string", default: "bundle" },
    "max-clients": { type: "string" },
    label: { type: "string", default: "run" },
  },
});
const OUT = resolve(a.out);
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, `server-perf-${a.label}.jsonl`);
rmSync(LOG, { force: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const endpoint = `http://localhost:${a.port}`;

const env = { ...process.env, PORT: a.port, CV_PERF_LOG: LOG, CV_PERF_EVERY_MS: "5000", CV_PERF_ALLOW_PROD: "1" };
if (a["max-clients"]) env.CV_VILLAGE_MAX_CLIENTS = a["max-clients"];
let server;
if (a.server === "bundle") {
  const bundle = join(REPO, "server", "dist", "index.cjs");
  if (!existsSync(bundle)) {
    console.error("server/dist/index.cjs missing: npm run build -w server");
    process.exit(2);
  }
  server = spawn(process.execPath, [bundle], { cwd: join(REPO, "server"), env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
} else {
  const tsx = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
  server = spawn(process.execPath, [tsx, "src/index.ts"], { cwd: join(REPO, "server"), env, stdio: ["ignore", "pipe", "pipe"] });
}
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  try {
    if ((await fetch(`${endpoint}/healthz`)).ok) break;
  } catch {}
  await sleep(300);
}
console.log(`server up on ${endpoint} (pid ${server.pid}, ${a.server}${a["max-clients"] ? `, ${a["max-clients"]} per room` : ""})`);

const statusDir = join(OUT, `status-${a.label}`);
const tsx = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const botsStart = Date.now();
const bots = spawn(
  process.execPath,
  [tsx, join(REPO, "loadtest", "mix.ts"), "--endpoint", endpoint, "--numClients", a.clients, "--duration", a.duration, "--mix", a.mix, "--statusDir", statusDir],
  { cwd: join(REPO, "loadtest"), stdio: ["ignore", "pipe", "pipe"] },
);
let botOut = "";
bots.stdout.on("data", (d) => {
  botOut += d;
  process.stdout.write(d);
});
bots.stderr.on("data", (d) => (botOut += d));
const botCode = await new Promise((r) => bots.on("exit", r));
await sleep(5500);
server.kill();

const status = JSON.parse(readFileSync(join(statusDir, "mix-status.json"), "utf8"));
const lines = readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const from = status.allJoinedAt + 10000;
const to = status.allJoinedAt + Number(a.duration) * 1000;
const w = lines.filter((l) => l.t >= from && l.t <= to);
const max = (f) => Math.max(...w.map(f));
const mean = (f) => +(w.reduce((s, l) => s + f(l), 0) / Math.max(1, w.length)).toFixed(2);
const summary = {
  label: a.label,
  clients: Number(a.clients),
  perRoom: Number(a["max-clients"] ?? 30),
  rooms: Object.keys(status.rooms).length,
  joined: status.joined,
  disconnects: status.disconnects,
  roomErrors: status.roomErrors,
  windows: w.length,
  eld: { p50Mean: mean((l) => l.eld.p50), p99Max: max((l) => l.eld.p99), max: max((l) => l.eld.max) },
  patch: { p50Mean: mean((l) => l.patch.p50), p95Max: max((l) => l.patch.p95), p99Max: max((l) => l.patch.p99), max: max((l) => l.patch.max), perSec: mean((l) => l.patch.n / 5) },
  msgs: { perSec: mean((l) => l.msgs.n / 5), msPerSec: mean((l) => l.msgs.ms / 5) },
  cpuPct: { mean: mean((l) => l.cpuPct), max: max((l) => l.cpuPct) },
  rssMB: { max: max((l) => l.rssMB) },
  heapMB: { max: max((l) => l.heapMB) },
  serverOutPerClientKBs: mean((l) => l.bytes.perClientPerSec / 1024),
  avgPatchBytes: mean((l) => l.bytes.avgPatch),
  bot: {
    downKBsPerBot: +((status.bytes / Math.max(1, status.joined)) / Math.max(1, status.liveSec) / 1024).toFixed(1),
    avgPatchBytes: Math.round(status.patchBytes / Math.max(1, status.patchMsgs)),
    sits: status.sits, fishSits: status.fishSits, casts: status.fishCasts, hallIn: status.hallIn, houseIn: status.houseIn, busAsks: status.busAsks, gaveUp: status.gaveUp,
    chats: status.chats, emojis: status.emojis, jumps: status.jumps,
  },
  machine: { cpus: (await import("node:os")).cpus().length, load: (await import("node:os")).loadavg() },
};
const gates = [
  ["all joined", summary.joined === summary.clients],
  ["no disconnects / room errors", summary.disconnects === 0 && summary.roomErrors === 0],
  ["event-loop delay p99 <= 50 ms", summary.eld.p99Max <= 50],
  ["patch tick p99 <= 20 ms", summary.patch.p99Max <= 20],
  ["RSS <= 600 MB", summary.rssMB.max <= 600],
];
summary.gates = Object.fromEntries(gates);
writeFileSync(join(OUT, `loadtest-${a.label}.json`), JSON.stringify({ summary, probe: lines, botLog: botOut.slice(-4000), botCode }, null, 1));
const md = [
  `# Bot load test — ${a.label}`,
  "",
  `${summary.clients} bots (${summary.rooms} room(s), ${summary.perRoom} per room), ${a.duration} s, mix ${a.mix}, server ${a.server}; window ${w.length} x 5 s`,
  "",
  "| metric | value |",
  "|---|---|",
  `| joined / disconnects / room errors | ${summary.joined} / ${summary.disconnects} / ${summary.roomErrors} |`,
  `| event-loop delay p50 (mean) / p99 (worst) / max | ${summary.eld.p50Mean} / ${summary.eld.p99Max} / ${summary.eld.max} ms |`,
  `| patch tick p50 / p95 / p99 / max (worst window) | ${summary.patch.p50Mean} / ${summary.patch.p95Max} / ${summary.patch.p99Max} / ${summary.patch.max} ms |`,
  `| messages handled | ${summary.msgs.perSec}/s, ${summary.msgs.msPerSec} ms/s |`,
  `| CPU (one core) mean / max | ${summary.cpuPct.mean} / ${summary.cpuPct.max} % |`,
  `| RSS max / heap max | ${summary.rssMB.max} / ${summary.heapMB.max} MB |`,
  `| patch bytes out per client | ${summary.serverOutPerClientKBs} KB/s (avg patch ${summary.avgPatchBytes} B) |`,
  `| bot download per bot (all messages) | ${summary.bot.downKBsPerBot} KB/s |`,
  `| activities | sits ${summary.bot.sits}, fishing sits ${summary.bot.fishSits} (casts ${summary.bot.casts}), hall ${summary.bot.hallIn}, house ${summary.bot.houseIn}, bus asks ${summary.bot.busAsks}, chats ${summary.bot.chats}, emojis ${summary.bot.emojis}, gave up ${summary.bot.gaveUp} |`,
  "",
  ...gates.map(([n, ok]) => `- ${ok ? "PASS" : "FAIL"} ${n}`),
].join("\n");
writeFileSync(join(OUT, `loadtest-${a.label}.md`), md + "\n");
console.log("\n" + md);
process.exit(gates.every(([, ok]) => ok) && botCode === 0 ? 0 : 1);
