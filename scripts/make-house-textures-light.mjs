// 집 외관 A8 (X3): the light tier's normal maps at 512 px beside X1's 1024 px ones (client/public/models/village/houses/
// house_*_normal.webp -> house_*_normal_512.webp; housesPrep.ts lightVariant). WebP q 92 (X1 kept its normal maps at q >= 90).
//   node scripts/make-house-textures-light.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const dir = join(import.meta.dirname, "..", "client", "public", "models", "village", "houses");
const meta = JSON.parse(readFileSync(join(dir, "house_textures.json"), "utf8"));
for (const m of Object.values(meta.materials)) {
  const src = join(dir, m.maps.normal);
  const out = src.replace(/\.webp$/, "_512.webp");
  const info = await sharp(src).resize(512, 512, { kernel: "lanczos3" }).webp({ quality: 92, effort: 6 }).toFile(out);
  console.log(out, info.size);
}
