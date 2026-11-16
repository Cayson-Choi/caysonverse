// fishsheet.mjs - one side view + one 3/4 view per species -> <outDir>/fish_<id>_side.png, _34.png
import { open } from "./render.mjs";
import fs from "node:fs";
const outDir = process.argv[2] || "art/lake/work/fishviews";
fs.mkdirSync(outDir, { recursive: true });
const IDS = ["crucian_carp", "bluegill", "minnow", "prussian_carp", "bass", "carp", "korean_bullhead", "catfish", "mirror_carp", "snakehead", "eel"];
const { page, close } = await open();
for (const id of IDS) {
  // side: near-orthographic (camera 30 m away, fov 2.2 deg) so it overlays the normalized photo 1:1 (1 model unit = 520.8 px)
  for (const [name, cam, fov, W, H] of [["side", [-30, 0, 0], 2.2, 1200, 600], ["34", [-1.0, 0.45, 0.95], 30, 900, 450], ["top", [0, 30, 0.001], 2.2, 1200, 600], ["front", [-0.35, 0.12, 1.6], 30, 600, 450]]) {
    const url = await page.evaluate(([cfg, W, H]) => window.standalone(cfg, W, H), [{ src: "fish", node: "fish_" + id, cam, target: [0, 0, 0], fov }, W, H]);
    fs.writeFileSync(`${outDir}/${id}_${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  }
}
await close();
console.log("done");
