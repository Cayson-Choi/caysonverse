import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The client imports the shared workspace via the tsconfig `paths` alias
// (`@caysonverse/shared/*`). Vitest does not read tsconfig paths, so mirror the
// mapping here (same as vite.config.ts / server's vitest.config.ts). Client unit
// tests are pure-logic only (no DOM/WebGL), so the default `node` environment is
// intentional — no jsdom.
export default defineConfig({
  resolve: {
    alias: {
      "@caysonverse/shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
