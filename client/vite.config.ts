import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Resolve @caysonverse/shared/* to the shared source (mirrors the tsconfig
// `paths`). The client must only pull BROWSER-SAFE modules through this alias —
// constants.ts / messages.ts as values, or `import type` from schema.ts. The
// schema.ts decorator runtime must never be imported as a value here.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@caysonverse/shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
});
