/**
 * e2e/lake-held-item.mjs - the held item and the right arm round renting the rod (owner 2026-11-17: "낚시대를 반납하고 나면 팔이
 * 저 모양이야": after the return the right arm stayed stuck out forward, the item held level). For each held item (scepter, wand,
 * rose, none): stand on the rental pad, measure the right arm (upperarm / lowerarm / hand / handslot local rotations) and the
 * hand slot's world scale; rent the rod (the item must be away: the slot folded); return it with the button (or, --auto=1, by
 * walking off west of the lake zone: the server's auto-return); stand still and measure again: the arm must be back in the idle
 * pose (within a few degrees of the first measure) and the slot unfolded (the item in the hand). --fp=1 does it in first person.
 *
 *   CV_CLIENT_URL=http://localhost:5751 node e2e/lake-held-item.mjs --out=<folder> [--device=pc|phone] [--auto=1] [--fp=1]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
import { bigButton, waitButton } from "./lib/lakeMock.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, ".superpowers", "sdd", "evidence", "lake-held-item"));
const dev = opt("device", "pc");
const device = dev === "phone" ? PHONE : DESKTOP;
const AUTO = opt("auto", "0") === "1";
const FP = opt("fp", "0") === "1";
const ITEMS = opt("items", "scepter,wand,rose,none").split(",");
const tag = `${dev}${AUTO ? "-auto" : ""}${FP ? "-fp" : ""}`;
const run = createRun("lake-held-item-" + tag);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);

const browser = await launchBrowser();
const touch = !!device.hasTouch;

/** The right arm of MY avatar (the hand slot nearest my position): local rotations and the slot's world scale. */
const arm = (p) =>
  p.page.evaluate(() => {
    const t = window.__cvThree?.();
    const me = window.__cv?.getPos?.();
    if (!t || !me) return null;
    let best = null;
    let bd = Infinity;
    t.scene.traverse((o) => {
      if (o.name !== "handslotr" && o.name !== "handslot.r") return;
      const w = o.getWorldPosition(new o.position.constructor());
      const d = Math.hypot(w.x - me.x, w.z - me.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    });
    if (!best) return null;
    const out = { dist: bd, bones: {} };
    let b = best;
    for (let k = 0; k < 4 && b; k++, b = b.parent) out.bones[b.name] = b.quaternion.toArray().map((v) => +v.toFixed(4));
    best.updateWorldMatrix(true, false);
    const e = best.matrixWorld.elements;
    out.slotScale = +Math.hypot(e[0], e[1], e[2]).toFixed(4);
    // the item's world direction: the slot's +Y axis
    out.slotUp = [e[4], e[5], e[6]].map((v) => +(v / (out.slotScale || 1)).toFixed(3));
    return out;
  });
/** Largest rotation (degrees) between two measures' bones. */
const angle = (a, b) => {
  let m = 0;
  for (const k of Object.keys(a.bones)) {
    const q = a.bones[k];
    const r = b.bones[k];
    if (!r) continue;
    const dot = Math.abs(q[0] * r[0] + q[1] * r[1] + q[2] * r[2] + q[3] * r[3]);
    m = Math.max(m, (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI);
  }
  return m;
};

async function oneItem(item) {
  const p = await openPlayer(browser, run, { tag: item, device });
  // the look: the default appearance with this held item (the entry screen's own cache)
  await p.page.goto(`${CLIENT_URL}/`, { waitUntil: "domcontentloaded" });
  await p.page.waitForFunction(() => !!window.__imp, null, { timeout: 60000 });
  await p.page.evaluate(async (it) => {
    const mod = await window.__imp("/shared/src/appearance.ts");
    const a = { ...mod.DEFAULT_APPEARANCE, item: it === "none" ? 0 : mod.SLOT_OPTIONS.item.indexOf(it) };
    localStorage.setItem("cv.entry", JSON.stringify({ nickname: "", appearance: a }));
  }, item);
  await joinVillage(p, "손", "2026-11-03T12:30");
  for (const [x, z] of [[40, 0], [80, -9], [100, -12]]) await walkAndWait(p, x, z, 40000, 2);
  await walkAndWait(p, 102, -14.6, 20000, 1);
  if (FP) {
    await p.page.keyboard.press("KeyV");
    await sleep(900);
  }
  await sleep(1800);
  const before = await arm(p);
  await run.shot(p, `${tag}-${item}-1-before.png`);
  const rent = await waitButton(p, "낚싯대 빌리기", 8000);
  if (touch) await p.page.touchscreen.tap(rent.x + rent.w / 2, rent.y + rent.h / 2);
  else await p.page.mouse.click(rent.x + rent.w / 2, rent.y + rent.h / 2);
  await sleep(2500);
  const holding = await arm(p);
  await run.shot(p, `${tag}-${item}-2-rod.png`);
  run.check(`${item}: renting folds the held item away (hand slot scale ~0)`, item === "none" || (holding && holding.slotScale < 0.01), holding?.slotScale);
  if (AUTO) {
    // walk off west of the lake zone (x < 90): the server returns the rod by itself
    await walkAndWait(p, 85, -9, 40000, 2);
    await sleep(2500);
    await walkAndWait(p, 86, -9, 10000, 1.5);
  } else {
    // a little walk with the rod first (the carry pose), then back to the pad and the return button
    await walkAndWait(p, 104, -12.5, 15000, 1);
    await walkAndWait(p, 102, -14.6, 15000, 1);
    await sleep(600);
    const btn = p.page.locator("[data-lake-return]").first();
    if (touch) await btn.tap();
    else await btn.click();
  }
  await sleep(2600);
  const rod = await p.page.evaluate(async () => {
    const net = await window.__imp("/src/lake/lakeNet.ts");
    const proto = await window.__imp("/src/lake/lakeProtocol.ts");
    const v = proto.emptyFishView();
    net.readFishView(net.selfId(), v);
    return v.rod;
  });
  run.check(`${item}: the rod is back (Player.rod 0)`, rod === 0, rod);
  await sleep(1500);
  const after = await arm(p);
  await run.shot(p, `${tag}-${item}-3-after.png`);
  // a walk after the return must use the full arm again too
  await walkAndWait(p, AUTO ? 80 : 100, -10, 15000, 1.5);
  await sleep(1500);
  const after2 = await arm(p);
  const d = before && after ? angle(before, after) : 999;
  const d2 = before && after2 ? angle(before, after2) : 999;
  run.check(`${item}: after the return the right arm is back in the idle pose (<= 12 deg from before renting)`, d <= 12, { deg: +d.toFixed(1), before, after });
  run.check(`${item}: after a walk and a stop, still the idle arm (<= 12 deg)`, d2 <= 12, { deg: +d2.toFixed(1) });
  run.check(`${item}: the held item is back in the hand (slot scale 1, held the same way)`, !!after && Math.abs(after.slotScale - (before?.slotScale ?? 1)) < 0.02, { before: before?.slotScale, after: after?.slotScale, upBefore: before?.slotUp, upAfter: after?.slotUp });
  await p.ctx.close();
}

for (const it of ITEMS) await run.step(`held item: ${it}`, () => oneItem(it));

const code = run.finish();
await browser.close();
process.exit(code);
