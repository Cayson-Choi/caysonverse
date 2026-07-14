import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The server uses tsconfig `paths` to import the shared workspace
// (`@caysonverse/shared/*`). Vitest does not read tsconfig paths, so mirror the
// mapping here as a resolve alias. A string alias matches the exact specifier or
// any `@caysonverse/shared/<subpath>` and rewrites it onto shared/src.
export default defineConfig({
  resolve: {
    alias: {
      "@caysonverse/shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
    },
  },
});
