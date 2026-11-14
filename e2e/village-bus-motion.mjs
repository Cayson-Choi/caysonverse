/**
 * e2e/village-bus-motion.mjs — 마을버스가 한 바퀴 도는 동안 화면에 그려진 위치·방향을 매 프레임 기록 (fix/bus-smooth).
 *
 * 서버를 CV_DEV_CLOCK_OFFSET_MS로 정시 직전에 맞춰 띄우면(아래 npm 줄) 마을에 들어가자마자 승차 -> 한 바퀴 -> 정류장 복귀가
 * 이어진다. 버스 뿌리(window.__cvBus().root)의 위치·방향을 requestAnimationFrame마다 기록해 JSON으로 저장한다.
 *   --out=<폴더>        결과(<label>.json, 접촉 시트용 프레임)
 *   --label=<이름>      파일 이름 (기본 run)
 *   --throttle=<N>      CPU 감속 배율 (CDP Emulation.setCPUThrottlingRate)
 *   --phone             아이폰 에뮬레이션
 *   --sheet             0.5초마다 고정 카메라(위에서 본 정류장~고리길 전체) 프레임 저장
 *
 *   서버: CV_DEV_CLOCK_OFFSET_MS=<정시 50초 전이 되게> PORT=2895 npx tsx src/index.ts
 *   클라: VITE_SERVER_URL=http://localhost:2895 npx vite --port 5495 --strictPort
 *   CV_CLIENT_URL=http://localhost:5495 node e2e/village-bus-motion.mjs --out=<폴더> --label=after
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (n, fallback) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${fallback}`).slice(n.length + 3);
const out = opt("out", "bus-motion");
const label = opt("label", "run");
const throttle = Number(opt("throttle", "1"));
const phone = args.includes("--phone");
const sheet = args.includes("--sheet");
mkdirSync(out, { recursive: true });
const run = createRun("village-bus-motion");
run.evidence = out;
run.allow("D3D X3595 (bloom shader, known)", /warning X3595: gradient instruction used in a loop/);

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "bus", device: phone ? PHONE : DESKTOP, settings: { graphics: phone ? "low" : "high" } });
await joinVillage(p, "bm");
if (throttle > 1) {
  const cdp = await p.ctx.newCDPSession(p.page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
}

await p.page.waitForFunction(() => !!window.__cvBus, null, { timeout: 60000 });
await p.page.evaluate(
  async ({ sheet }) => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const rec = { t: [], x: [], z: [], yaw: [], status: [], waiting: [], serverMs: [], done: false, frames: [] };
    window.__rec = rec;
    let seenTransit = false;
    let lastShot = -1e9;
    let cam = null;
    const tick = (now) => {
      const root = window.__cvBus?.().root;
      const snap = sync.getTransitState().snapshot;
      if (root && snap) {
        rec.t.push(now);
        rec.x.push(root.position.x);
        rec.z.push(root.position.z);
        rec.yaw.push(root.rotation.y);
        rec.status.push(snap.status);
        rec.waiting.push(snap.waiting ? 1 : 0);
        rec.serverMs.push(sync.transitNowMs());
        if (snap.status === "inTransit") seenTransit = true;
        if (seenTransit && snap.status === "atStop") rec.done = true;
        if (sheet && seenTransit && now - lastShot >= 500) {
          lastShot = now;
          const { gl, scene, camera } = window.__cvThree();
          if (!cam) {
            cam = new camera.constructor();
            cam.fov = 38;
            cam.aspect = 1;
            cam.near = 1;
            cam.far = 400;
            cam.updateProjectionMatrix();
            cam.position.set(0, 120, 0.01);
            cam.lookAt(0, 0, 0);
            cam.updateMatrixWorld(true);
          }
          const keep = { target: gl.getRenderTarget(), ac: gl.autoClear };
          gl.setRenderTarget(null);
          gl.render(scene, cam);
          const cv = document.createElement("canvas");
          cv.width = 640;
          cv.height = 640;
          const g = cv.getContext("2d");
          const w = gl.domElement.width, h = gl.domElement.height;
          // the camera's aspect is 1 but the canvas is w x h: the whole canvas squeezed into the square is the true square view
          g.drawImage(gl.domElement, 0, 0, w, h, 0, 0, 640, 640);
          rec.frames.push({ t: now, ms: sync.transitNowMs(), url: cv.toDataURL("image/jpeg", 0.8) });
          gl.setRenderTarget(keep.target);
        }
      }
      if (!rec.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  { sheet },
);

const t0 = Date.now();
while (Date.now() - t0 < 6 * 60 * 1000) {
  const done = await p.page.evaluate(() => window.__rec.done);
  if (done) break;
  await sleep(2000);
}
const data = await p.page.evaluate(() => {
  const r = window.__rec;
  return { t: r.t, x: r.x, z: r.z, yaw: r.yaw, status: r.status, waiting: r.waiting, serverMs: r.serverMs, frames: r.frames };
});
const frames = data.frames;
delete data.frames;
writeFileSync(join(out, `${label}.json`), JSON.stringify(data));
if (sheet) {
  mkdirSync(join(out, `${label}-frames`), { recursive: true });
  const meta = [];
  frames.forEach((f, i) => {
    writeFileSync(join(out, `${label}-frames`, `f${String(i).padStart(4, "0")}.jpg`), Buffer.from(f.url.split(",")[1], "base64"));
    meta.push({ i, t: f.t, ms: f.ms });
  });
  writeFileSync(join(out, `${label}-frames`, "meta.json"), JSON.stringify(meta));
}
console.log(`recorded ${data.t.length} frames, ${((data.t.at(-1) - data.t[0]) / 1000).toFixed(1)} s`);
await browser.close();
process.exit(run.finish({ label, throttle, phone }));
