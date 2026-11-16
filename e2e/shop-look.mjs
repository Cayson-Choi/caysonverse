/**
 * e2e/shop-look.mjs - the fishing shop's interior (lake_shop_interior.glb) as a visitor sees it through the rental window:
 * walk to the rental pad, face the window, screenshot from the pad and from close to the window; then from the south-east
 * at an angle (the side walls). PC 1280x800 or iPhone 13 (375x812). Evidence: --out=<folder>.
 *
 *   CV_CLIENT_URL=http://localhost:5693 node e2e/shop-look.mjs --out=<folder> [--device=pc|phone] [--time=2026-11-03T12:30]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, "art", "shop", "shots"));
const device = opt("device", "pc") === "phone" ? PHONE : DESKTOP;
const time = opt("time", "2026-11-03T12:30");
const tag = `${opt("device", "pc")}-${time.slice(11, 13)}`;
const run = createRun("shop-look-" + tag);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "A", device });
await run.step("join the village", async () => {
  await joinVillage(p, "샵", time);
  run.check("joined", true);
});
await run.step("walk to the shop", async () => {
  for (const [x, z] of [[40, 0], [80, -9], [100, -12], [102, -15.5]]) await walkAndWait(p, x, z, 40000, 2);
  await sleep(6000); // the lake's files and the interior
  const shop = await p.page.evaluate(() => {
    let n = 0;
    const seen = new Set();
    // count the interior's materials as a sanity check (the scene is not exposed; fall back to the network)
    for (const e of performance.getEntriesByType("resource")) if (e.name.includes("lake_shop_interior")) seen.add(e.name), n++;
    return { requests: n };
  });
  run.check("interior requested", shop.requests > 0, shop);
  const glass = await p.page.evaluate(() => {
    const r = window.__cvShopInterior?.();
    if (!r) return null;
    const out = { office: [], others: 0, draws: r.meshes, tris: r.tris };
    r.scene.traverse((o) => {
      if (!o.isMesh) return;
      const names = [].concat(o.material).map((m) => m.name);
      let inOffice = false;
      for (let q = o; q; q = q.parent) if (q.name === "lake_office") inOffice = true;
      if (inOffice && names.some((n) => /glass/i.test(n))) out.office.push(...names);
      else if (names.includes("M_lake_glass")) out.others++;
    });
    return out;
  });
  run.check("office window glass is the clear one, the huts keep theirs", !!glass && glass.office.includes("shop_window_glass") && !glass.office.includes("M_lake_glass") && glass.others > 0, glass);
  run.check("interior draw calls <= 12", !!glass && glass.draws <= 12, glass && { draws: glass.draws, tris: glass.tris });
});
await run.step("look in through the window", async () => {
  await walkAndWait(p, 102, -16.6, 20000, 0.6);
  await turnCameraTo(p, 102, -22);
  await sleep(2500);
  await run.shot(p, `${tag}-01-pad.png`);
  await walkAndWait(p, 101.6, -18.5, 20000, 0.5);
  await turnCameraTo(p, 101.8, -24);
  await sleep(2500);
  await run.shot(p, `${tag}-02-window.png`);
  // first person at the window (the 👁 view, V): what a visitor sees at eye height
  await walkAndWait(p, 101.9, -18.35, 20000, 0.4);
  await walkAndWait(p, 101.9, -18.6, 20000, 0.3);
  await p.page.keyboard.press("KeyV");
  await sleep(2500);
  await run.shot(p, `${tag}-05-fp-window.png`);
  await p.page.keyboard.press("KeyV");
  await sleep(1200);
  await walkAndWait(p, 104.2, -18.7, 20000, 0.5);
  await turnCameraTo(p, 100.5, -23.5);
  await sleep(2500);
  await run.shot(p, `${tag}-03-angle-west.png`);
  await walkAndWait(p, 99.8, -18.7, 20000, 0.5);
  await turnCameraTo(p, 103.8, -23.8);
  await sleep(2500);
  await run.shot(p, `${tag}-04-angle-east.png`);
  run.check("still by the shop", (await pos(p)).z > -19.5);
});
const code = run.finish();
await browser.close();
process.exit(code);
