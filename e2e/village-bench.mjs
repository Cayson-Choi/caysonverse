/**
 * e2e/village-bench.mjs — 케이슨 마을 벤치에 앉기 (2026-11-10). 두 사람이 광장 벤치 하나에 나란히 앉고, 앞·옆·3/4·뒤·낮은 옆에서
 * 찍는다. A는 반바지 + 마법사 모자(가장 높은 모자), B는 롱스커트 + 우주 헬멧. 앉은 자리(서버), 들썩임(바닥에서 띄운 높이),
 * 일어선 자리(벤치 앞, 충돌 상자 밖)를 확인하고, 추모관 앞 돌 벤치와 추모관 안 벤치에도 앉아 본다.
 *
 *   npm run dev   (다른 창에서; 다른 포트면 CV_CLIENT_URL=http://localhost:<port>)
 *   node e2e/village-bench.mjs [--out=<폴더>]
 *
 * 사진은 두 가지다: 게임 카메라 그대로(`game-*.png`)와, 앉은 사람을 정해진 각도에서 보는 시험용 카메라(`*.png`, 같은 장면을
 * 한 번 더 그린 것 — 게임 카메라는 그대로 둔다).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { DESKTOP, createRun, openPlayer, pos, sleep, walkAndWait } from "./lib/common.mjs";
import { act, hideHud, joinVillage, showHud } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun("village-bench");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });

const LOOKS = {
  shortsWizard: { hat: "wizard", hair: "short", face: "smile", top: "tee", bottom: "shorts", shoes: "sneakers", item: null },
  longskirtHelmet: { hat: "space_helmet", hair: "twintails", face: "wink", top: "gown_top", bottom: "longskirt", shoes: "dress", item: null },
  robeBoots: { hat: "safari", hair: "curly", face: "calm", top: "robe", bottom: "pants", shoes: "tall_boots", item: null },
};
const COLORS = { hatColor: 4, hairColor: 2, skin: 1, topColor: 3, bottomColor: 8, shoesColor: 1, itemColor: 2, voice: 0 };

/** Seed the entry screen's remembered look (cv.entry), computed by the app's own appearance module. */
async function seedLook(p, look) {
  await p.page.goto(`${process.env.CV_CLIENT_URL || "http://localhost:5173"}/`, { waitUntil: "domcontentloaded" });
  await p.page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 30000 });
  await p.page.waitForFunction(
    () => performance.getEntriesByType("resource").some((r) => r.name.split("?")[0].endsWith("/shared/src/appearance.ts")),
    null,
    { timeout: 30000 },
  );
  await p.page.evaluate(
    async ([parts, colors]) => {
      const a = await window.__imp("/shared/src/appearance.ts");
      localStorage.setItem("cv.entry", JSON.stringify({ nickname: "", appearance: a.appearanceFromIds(parts, colors) }));
    },
    [look, COLORS],
  );
}

/** The village's seats, as the client has them. */
const seats = (p) => p.page.evaluate(async () => (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.map((s) => ({ ...s })));

/**
 * Draw the scene once more from a test camera (eye -> look) and save it. The game camera is not touched: a clone of it
 * renders into the canvas and the picture is read back at once, before the next frame overwrites it.
 */
async function render(p, file, eye, look, fov = 38) {
  const url = await p.page.evaluate(
    ([eye, look, fov]) => {
      const { gl, scene, camera } = window.__cvThree();
      const cam = camera.clone();
      cam.fov = fov;
      cam.near = 0.05;
      cam.position.set(eye[0], eye[1], eye[2]);
      cam.lookAt(look[0], look[1], look[2]);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      gl.render(scene, cam);
      return gl.domElement.toDataURL("image/png");
    },
    [eye, look, fov],
  );
  writeFileSync(join(OUT, file), Buffer.from(url.split(",")[1], "base64"));
}

/** Views round a sitter (or the middle of two): front, side, 3/4, back 3/4, low side, from above. */
async function views(p, prefix, centre, yaw, extra = 0, topY = 4.2 + extra) {
  const f = [Math.sin(yaw), Math.cos(yaw)];
  const r = [Math.cos(yaw), -Math.sin(yaw)];
  const at = (a, b, up, d) => [centre.x + (f[0] * a + r[0] * b) * d, up, centre.z + (f[1] * a + r[1] * b) * d];
  const look = [centre.x, 0.8, centre.z];
  const d = 3.4 + extra;
  await render(p, `${prefix}-front.png`, at(1, 0, 1.3, d), look);
  await render(p, `${prefix}-side.png`, at(0.05, 1, 1.0, d), look);
  await render(p, `${prefix}-three-quarter.png`, at(0.75, 0.66, 1.6, d), look);
  await render(p, `${prefix}-back.png`, at(-0.7, 0.7, 1.9, d), look);
  // low, from the side, at the seat's front edge: the calves and the feet against the bench, the skirt's hem
  await render(p, `${prefix}-low-side.png`, at(0.35, 1, 0.45, 1.9 + extra * 0.5), [centre.x + f[0] * 0.1, 0.4, centre.z + f[1] * 0.1]);
  await render(p, `${prefix}-top.png`, [centre.x + f[0] * 0.6, topY, centre.z + f[1] * 0.6], [centre.x, 0.4, centre.z], 45);
}

/** The avatar group standing on (x, z) — its height above the floor is the bench lift. */
const groupAt = (p, x, z) =>
  p.page.evaluate(
    ([x, z]) => {
      const { scene } = window.__cvThree();
      let found = null;
      scene.traverse((o) => {
        if (!found && o.isGroup && Math.abs(o.position.x - x) < 1e-3 && Math.abs(o.position.z - z) < 1e-3) found = o;
      });
      return found ? { x: found.position.x, y: found.position.y, z: found.position.z } : null;
    },
    [x, z],
  );
/** The local avatar's group. */
const selfGroup = async (p) => {
  const at = await pos(p);
  return groupAt(p, at.x, at.z);
};

/** Walk to the front of seat `s` (around the fountain if needed) and press E; waits for the server's seat. */
async function sitOn(p, s, index, via = []) {
  for (const [x, z] of via) await walkAndWait(p, x, z, 30000, 1.0);
  await walkAndWait(p, s.standX, s.standZ, 30000, 0.3);
  await sleep(500);
  const label = await p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? "");
  run.check(`${p.tag}: the action button offers 앉기 in front of the bench`, label.includes("앉기"), label);
  await act(p);
  const ok = await p.page.waitForFunction((i) => window.__cv.getPos().seatIndex === i, index, { timeout: 8000 }).then(() => true, () => false);
  run.check(`${p.tag}: seated on seat ${index} (${s.bench})`, ok, await pos(p));
  await sleep(1800); // the sit-down clip (0.8 s) and the camera glide
}

const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP });
const B = await openPlayer(browser, run, { tag: "B", device: DESKTOP });
const C = await openPlayer(browser, run, { tag: "C", device: DESKTOP });
// window.__imp finds a module among the page's resource timings; the dev server's few hundred modules overflow the
// browser's default buffer of 250 entries, after which a module loaded late (the builder's, the village's) is not listed.
for (const p of [A, B, C]) await p.ctx.addInitScript(() => performance.setResourceTimingBufferSize(5000));
let all = [];

await run.step("1. join: A in shorts + wizard hat, B in a long skirt + space helmet (C comes later)", async () => {
  await seedLook(A, LOOKS.shortsWizard);
  await joinVillage(A, "앉기A");
  await seedLook(B, LOOKS.longskirtHelmet);
  await joinVillage(B, "앉기B");
  all = await seats(A);
  run.check("20 bench seats on the client", all.length === 20, all.length);
});

// plaza_4 (south-east of the fountain, by the spawn): seats 6 and 7
const S0 = 6;
const S1 = 7;
await run.step("2. A sits on a plaza bench (E), alone", async () => {
  const s = all[S0];
  await sitOn(A, s, S0, [[0, 9.2]]);
  const g = await selfGroup(A);
  run.check("A is lifted onto the seat surface (a few cm, not floating)", g && g.y > 0.03 && g.y < 0.09, g);
  await hideHud(A);
  await A.page.screenshot({ path: join(OUT, "game-A-seated.png") });
  await views(A, "A-shorts-wizard", { x: s.x - Math.sin(s.yaw) * 0.4, z: s.z - Math.cos(s.yaw) * 0.4 }, s.yaw);
  await showHud(A);
});

await run.step("3. B sits next to A on the same bench (long skirt); both seen from A's tab", async () => {
  const s = all[S1];
  await sitOn(B, s, S1, [[0, 9.2]]);
  await sleep(1500);
  const remotes = await A.page.evaluate(() => window.__cv.getRemotes().map((r) => ({ nick: r.nickname, seat: r.seatIndex, x: r.x, z: r.z })));
  run.check("A sees B seated on the next seat", remotes.some((r) => r.seat === S1), remotes);
  const bInA = await groupAt(A, s.x, s.z);
  run.check("...lifted onto the seat in A's view too (the remote avatar)", bInA && bInA.y > 0.03 && bInA.y < 0.09, bInA);
  const a = all[S0];
  const mid = { x: (a.x + s.x) / 2 - Math.sin(s.yaw) * 0.4, z: (a.z + s.z) / 2 - Math.cos(s.yaw) * 0.4 };
  await hideHud(A);
  await views(A, "AB-two-on-bench", mid, s.yaw, 1.2);
  await A.page.screenshot({ path: join(OUT, "game-A-with-B.png") });
  await showHud(A);
  await hideHud(B);
  await views(B, "B-longskirt-helmet", { x: s.x - Math.sin(s.yaw) * 0.4, z: s.z - Math.cos(s.yaw) * 0.4 }, s.yaw);
  await showHud(B);
});

await run.step("4. C (robe + tall boots) joins and sits on the next bench", async () => {
  await seedLook(C, LOOKS.robeBoots);
  await joinVillage(C, "앉기C");
  const s = all[S0 + 2]; // plaza_5, west of plaza_4
  await sitOn(C, s, S0 + 2, [[0, 9.2]]);
  await hideHud(C);
  await views(C, "C-robe-boots", { x: s.x - Math.sin(s.yaw) * 0.4, z: s.z - Math.cos(s.yaw) * 0.4 }, s.yaw);
  await showHud(C);
});

await run.step("5. A gets up (W): in front of the bench, clear of it; B stays seated", async () => {
  const s = all[S0];
  await A.page.keyboard.down("KeyW");
  await sleep(120);
  await A.page.keyboard.up("KeyW");
  const ok = await A.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 8000 }).then(() => true, () => false);
  run.check("A stood up", ok);
  // mid-way through the stand-up, then once it is over
  await sleep(250);
  await hideHud(A);
  // from A's free side (B sits on the other): -x of the bench's frame
  const side = (d, up) => [s.x - Math.cos(s.yaw) * d + Math.sin(s.yaw) * 0.6, up, s.z + Math.sin(s.yaw) * d + Math.cos(s.yaw) * 0.6];
  await render(A, "A-standing-up-mid.png", side(3, 1.0), [s.x, 0.7, s.z]);
  await sleep(1500);
  const at = await pos(A);
  const ahead = (at.x - s.x) * Math.sin(s.yaw) + (at.z - s.z) * Math.cos(s.yaw);
  run.check("A ends on the seat's dismount spot", Math.hypot(at.x - s.standX, at.z - s.standZ) < 0.05, { at, stand: [s.standX, s.standZ] });
  run.check("...in front of the bench", ahead > 0, { ahead });
  const g = await selfGroup(A);
  run.check("A stands on the ground again (no lift left)", g && Math.abs(g.y) < 1e-3, g);
  await render(A, "A-stood-up-side.png", side(3.2, 1.1), [s.x, 0.7, s.z]);
  await A.page.screenshot({ path: join(OUT, "game-A-stood-up.png") });
  await showHud(A);
  const remotes = await A.page.evaluate(() => window.__cv.getRemotes().map((r) => r.seatIndex));
  run.check("B is still seated", remotes.includes(S1), remotes);
});

await run.step("6. the memorial's forecourt bench (stone, no back)", async () => {
  const i = all.findIndex((s) => s.bench === "memorial_forecourt");
  const s = all[i];
  await sitOn(A, s, i, [[-20, 5], [-14, -20], [0, -33], [0, -46]]);
  await hideHud(A);
  await views(A, "A-forecourt", { x: s.x - Math.sin(s.yaw) * 0.4, z: s.z - Math.cos(s.yaw) * 0.4 }, s.yaw);
  await A.page.screenshot({ path: join(OUT, "game-A-forecourt.png") });
  await showHud(A);
  await A.page.keyboard.press("KeyE"); // E stands up too
  await A.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 8000 });
  await sleep(1500);
});

await run.step("7. inside the memorial hall: the oak bench, facing the memorial table", async () => {
  await walkAndWait(A, 0, -50.8, 30000, 1.0); // the door pad, just east of the forecourt bench
  await act(A);
  await A.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
  await A.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
  await sleep(2500);
  const i = all.findIndex((s) => s.bench === "hall");
  const s = all[i];
  await sitOn(A, s, i, [[300, 1.5], [302.6, 0.5], [302.6, -2.6]]);
  await hideHud(A);
  await views(A, "A-hall", { x: s.x - Math.sin(s.yaw) * 0.4, z: s.z - Math.cos(s.yaw) * 0.4 }, s.yaw, -0.6, 3.1); // under the 3.4 m ceiling
  await A.page.screenshot({ path: join(OUT, "game-A-hall.png") });
  await showHud(A);
});

await browser.close();
process.exit(run.finish({ out: OUT }));
