import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRACO_PATH } from "./hub/hubModelPrep";

/**
 * The self-hosted Draco decoder (client/public/draco/, served at DRACO_PATH) is Apache-2.0: its full license text
 * ships in the same folder, so every deployment that serves the decoder also serves the license (final fix B8).
 */
const DRACO_DIR = new URL("../../public/draco/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, DRACO_DIR), "utf8");

describe("the Draco decoder ships with its Apache-2.0 license text (final fix B8)", () => {
  it("LICENSE.txt sits next to the decoder files that DRACO_PATH serves", () => {
    expect(DRACO_PATH).toBe("/draco/");
    const files = readdirSync(DRACO_DIR).sort();
    expect(files).toEqual(["LICENSE.txt", "README.md", "draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"]);
  });

  it("is the whole Apache License 2.0 text, not a link", () => {
    const text = read("LICENSE.txt");
    expect(text).toContain("Apache License");
    expect(text).toContain("Version 2.0, January 2004");
    expect(text).toContain("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION");
    expect(text).toContain("9. Accepting Warranty or Additional Liability.");
    expect(text).toContain("END OF TERMS AND CONDITIONS");
    expect(text.split("\n").length).toBeGreaterThanOrEqual(200);
  });

  it("the folder's README and docs/licenses.md point at it", () => {
    expect(read("README.md")).toContain("[`LICENSE.txt`](LICENSE.txt)");
    const licenses = readFileSync(new URL("../../../docs/licenses.md", import.meta.url), "utf8");
    expect(licenses).toContain("client/public/draco/LICENSE.txt");
  });
});
