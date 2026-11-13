import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Content hash of every file under public/models, keyed by its URL path ("/models/village/village.glb" -> "1a2b3c4d5e").
 * Model URLs carry ?v=<hash> (client/src/village/modelUrl.ts), so a deploy that changes a model makes browsers fetch
 * the new file at once instead of reusing a day-old cached copy, and unchanged models stay cached.
 */
function modelHashes(): Record<string, string> {
  const root = fileURLToPath(new URL("./public", import.meta.url));
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(glb|webp|png|jpg|jpeg|ktx2|bin)$/i.test(name))
        out["/" + relative(root, p).split(sep).join("/")] = createHash("md5").update(readFileSync(p)).digest("hex").slice(0, 10);
    }
  };
  walk(join(root, "models"));
  return out;
}

// Resolve @caysonverse/shared/* to the shared source (mirrors the tsconfig
// `paths`). The client must only pull BROWSER-SAFE modules through this alias —
// constants.ts / messages.ts as values, or `import type` from schema.ts. The
// schema.ts decorator runtime must never be imported as a value here.
export default defineConfig({
  plugins: [react()],
  define: { __MODEL_HASHES__: JSON.stringify(modelHashes()) },
  resolve: {
    alias: {
      "@caysonverse/shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
});
