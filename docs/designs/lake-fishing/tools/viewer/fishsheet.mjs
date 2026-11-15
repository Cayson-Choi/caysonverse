// fishsheet.mjs - one side view + one 3/4 view per species -> <outDir>/fish_<id>_side.png, _34.png
import { open } from "./render.mjs";
import fs from "node:fs";
const outDir = process.argv[2] || "art/lake/work/fishviews";
fs.mkdirSync(outDir, { recursive: true });
const IDS = ["crucian_carp", "bluegill", "minnow", "prussian_carp", "bass", "carp", "korean_bullhead", "catfish", "mirror_carp", "snakehead", "eel"];
const { page, close } = await open();
for (const id of IDS) {
  for (const [name, cam] of [["side", [-1.55, 0.05, 0]], ["34", [-1.0, 0.55, 0.9]], ["top", [0, 1.7, 0.01]]]) {
    const url = await page.evaluate(([cfg]) => window.standalone(cfg, 900, 450), [{ src: "fish", node: "fish_" + id, cam, target: [0, 0, 0], fov: 30 }]);
    fs.writeFileSync(`${outDir}/${id}_${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  }
}
await close();
console.log("done");
