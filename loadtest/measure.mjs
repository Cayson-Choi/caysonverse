#!/usr/bin/env node
/**
 * Samples a Windows process's CPU% and RSS (via PowerShell `Get-Process`) every
 * `--interval` seconds for `--duration` seconds, writing a CSV and printing an
 * avg/p95 CPU + peak RSS summary at the end. Plain Node, no dependencies — see
 * docs/loadtest.md for how this fits into the 100-bot run.
 *
 * Usage:
 *   node measure.mjs --pid <serverPid> --duration 600 --out path/to/measure.csv [--interval 5]
 *
 * CPU% is computed the same way `@colyseus/loadtest`'s own dashboard computes
 * ITS process's CPU (see the vendored `elapUserMS + elapSystMS` calc): the
 * delta of Get-Process's cumulative `.CPU` (core-seconds) over the delta of
 * wall-clock time, ×100 — so 100% means "one full vCPU saturated", matching the
 * design gate's "<50% of 1 vCPU" framing.
 */

import { spawn } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

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
const pid = Number(argv.pid);
const durationSec = Number(argv.duration ?? 600);
const intervalSec = Number(argv.interval ?? 5);
const outCsv = argv.out ?? "measure.csv";

if (!Number.isInteger(pid) || pid <= 0) {
  console.error(
    "사용법: node measure.mjs --pid <서버PID> --duration <초> --out <csv경로> [--interval 5]",
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One PowerShell round-trip: "<cumulativeCpuSeconds>,<workingSetBytes>" or null if the PID is gone. */
function sampleProcess(targetPid) {
  return new Promise((resolve) => {
    const ps = spawn("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p = Get-Process -Id ${targetPid} -ErrorAction SilentlyContinue; if ($p) { "$($p.CPU),$($p.WorkingSet64)" }`,
    ]);
    let stdout = "";
    ps.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    ps.on("close", () => {
      const line = stdout.trim();
      if (!line) return resolve(null);
      const [cpuStr, rssStr] = line.split(",");
      const cpuSeconds = Number(cpuStr);
      const rssBytes = Number(rssStr);
      if (!Number.isFinite(cpuSeconds) || !Number.isFinite(rssBytes)) return resolve(null);
      resolve({ cpuSeconds, rssBytes });
    });
    ps.on("error", () => resolve(null));
  });
}

function summarize(samples) {
  if (samples.length === 0) {
    console.log("샘플이 없습니다 (프로세스를 한 번도 찾지 못함).");
    return;
  }
  const cpus = samples.map((s) => s.cpuPercent).sort((a, b) => a - b);
  const rsses = samples.map((s) => s.rssMB);
  const avgCpu = cpus.reduce((a, b) => a + b, 0) / cpus.length;
  const p95Cpu = cpus[Math.min(cpus.length - 1, Math.floor(cpus.length * 0.95))];
  const peakRss = Math.max(...rsses);
  console.log("\n=== 측정 요약 ===");
  console.log(`샘플 수: ${samples.length} (간격 ${intervalSec}s)`);
  console.log(`평균 CPU: ${avgCpu.toFixed(1)}%`);
  console.log(`p95 CPU: ${p95Cpu.toFixed(1)}%`);
  console.log(`최대 RSS: ${peakRss.toFixed(1)}MB`);
  console.log(`CSV: ${outCsv}`);
}

async function main() {
  mkdirSync(dirname(outCsv), { recursive: true });
  writeFileSync(outCsv, "elapsedSec,cpuPercent,rssMB\n");

  const startMs = Date.now();
  let prev = await sampleProcess(pid);
  let prevWallMs = Date.now();
  if (!prev) {
    console.error(`측정 시작 실패: PID ${pid}를 찾을 수 없습니다.`);
    process.exit(1);
  }

  const samples = [];
  const deadline = startMs + durationSec * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalSec * 1000);
    const nowWallMs = Date.now();
    const cur = await sampleProcess(pid);
    if (!cur) {
      console.error(`[측정] PID ${pid} 프로세스가 사라져 샘플링을 중단합니다.`);
      break;
    }
    const dCpuSec = cur.cpuSeconds - prev.cpuSeconds;
    const dWallSec = (nowWallMs - prevWallMs) / 1000;
    const cpuPercent = dWallSec > 0 ? (dCpuSec / dWallSec) * 100 : 0;
    const rssMB = cur.rssBytes / (1024 * 1024);
    const elapsedSec = Math.round((nowWallMs - startMs) / 1000);

    samples.push({ elapsedSec, cpuPercent, rssMB });
    appendFileSync(outCsv, `${elapsedSec},${cpuPercent.toFixed(2)},${rssMB.toFixed(2)}\n`);
    console.log(`[${elapsedSec}s] CPU ${cpuPercent.toFixed(1)}%  RSS ${rssMB.toFixed(1)}MB`);

    prev = cur;
    prevWallMs = nowWallMs;
  }

  summarize(samples);
}

main();
