import { mkdirSync } from "node:fs";
import { createRun, entryReady, launchBrowser, openPlayer, PHONE, press, CLIENT_URL } from "./lib/escape.mjs";

const run = createRun("tree-vegetation-smoke");
mkdirSync(run.evidence, { recursive: true });
const browser = await launchBrowser();
const player = await openPlayer(browser, run, { tag: "tree-mobile", device: PHONE });
try {
  await player.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded" });
  await entryReady(player);
  await player.page.locator("input.cv-input").first().fill("나무검사");
  await press(player, player.page.locator(".cv-submit"));
  await player.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await player.page.waitForFunction(() => typeof window.__cvVeg === "function" && window.__cvVeg() !== null && !!window.__cvThree?.(), null, { timeout: 60000 });
  const report = await player.page.evaluate(() => {
    const stats = window.__cvVeg?.() ?? null;
    const scene = window.__cvThree?.().scene;
    const legacy = [];
    let branches = false;
    scene?.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const leaf = materials.some((material) => ["M_leaf_green", "M_leaf_cherry"].includes(material?.name));
      if (leaf && object.name.startsWith("inst__") && object.visible) legacy.push(object.name);
      if (object.name === "veg_street_green_branches" && object.visible) branches = true;
    });
    return { stats, legacyVisible: legacy, branchesVisible: branches };
  });
  if (!report.stats || report.legacyVisible.length || !report.branchesVisible) throw new Error(JSON.stringify(report));
  await player.page.screenshot({ path: `${run.evidence}/tree-mobile.png` });
  console.log(JSON.stringify({ ok: true, report, evidence: run.evidence }));
} finally {
  await browser.close();
}
