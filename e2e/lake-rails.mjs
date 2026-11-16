/**
 * e2e/lake-rails.mjs - the lake's railings are walls (owner 2026-11-17: "낚시터에 난간을 그냥 통과해버려"). On the real server: walk
 * onto the pier, then push straight at a rail (W held, the camera turned to face it) at the pier's entrance, the T-end's east
 * edge, a walkway's side and a 좌대's edge: the body stops on the deck's side of each rail. The ways in stay open: from the shore
 * along the pier to the T-end, down the walkway onto 좌대 A. Screenshots at each rail.
 *
 *   CV_CLIENT_URL=http://localhost:5751 node e2e/lake-rails.mjs --out=<folder> [--device=pc|phone]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, ".superpowers", "sdd", "evidence", "lake-rails"));
const dev = opt("device", "pc");
const device = dev === "phone" ? PHONE : DESKTOP;
const run = createRun("lake-rails-" + dev);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "R", device });

/** Face (tx, tz) and hold W for `ms`: where the body ends. */
async function push(tx, tz, ms = 2600) {
  await turnCameraTo(p, tx, tz);
  await p.page.keyboard.down("KeyW");
  await sleep(ms);
  await p.page.keyboard.up("KeyW");
  await sleep(500);
  return pos(p);
}

await run.step("join and walk onto the pier", async () => {
  await joinVillage(p, "난", "2026-11-03T12:30");
  for (const [x, z] of [[40, 0], [80, -9], [100, -12], [104, -12]]) await walkAndWait(p, x, z, 40000, 2);
  const at = await walkAndWait(p, 108.5, -12, 20000, 0.6);
  run.check("on the pier's mouth (the way in is open)", Math.hypot(at.x - 108.5, at.z - (-12)) < 0.6, at);
});

// [name, start (on the deck), push toward, check(at) -> stayed on the deck side]
const RAILS = [
  ["the pier's north entrance rail (z -13.4)", [108.5, -12], [108.5, -16], (a) => a.z > -13.4 + 0.3],
  ["the pier's south entrance rail (z -10.6)", [108.5, -12], [108.5, -8], (a) => a.z < -10.6 - 0.3],
  ["the T-end's east rail between the chairs (x 145.9)", [143, -12], [149, -12], (a) => a.x < 145.9 - 0.3],
  ["walkway A's west rail (x 142.18)", [143, -22], [139, -22], (a) => a.x > 142.18 + 0.3],
  ["좌대 A's east rail (x 146.9)", [145.5, -27.2], [149.5, -27.2], (a) => a.x < 146.9 - 0.3],
];

for (const [name, from, to, ok] of RAILS) {
  await run.step(name, async () => {
    const at0 = await walkAndWait(p, from[0], from[1], 40000, 0.6);
    run.check(`${name}: reached the start on the deck`, Math.hypot(at0.x - from[0], at0.z - from[1]) < 0.8, at0);
    const at = await push(to[0], to[1]);
    await run.shot(p, `${dev}-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png`);
    run.check(`${name}: pushing at it stops on the deck's side`, ok(at), at);
  });
}

await run.step("the ways in: along the T-end and the walkway onto 좌대 A", async () => {
  const a = await walkAndWait(p, 143, -12, 30000, 0.6);
  run.check("onto the T-end", Math.hypot(a.x - 143, a.z + 12) < 0.6, a);
  const b = await walkAndWait(p, 143, -26.8, 30000, 0.6);
  run.check("down walkway A onto 좌대 A", Math.hypot(b.x - 143, b.z + 26.8) < 0.6, b);
});

const code = run.finish();
await browser.close();
process.exit(code);
