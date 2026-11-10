import { describe, expect, it } from "vitest";
import { isSoftwareRenderer, rendererOf } from "./gpuProbe";

describe("isSoftwareRenderer", () => {
  it("names the CPU rasterisers Chrome and Firefox fall back to", () => {
    for (const r of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "Google SwiftShader",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Software Rasterizer",
    ])
      expect(isSoftwareRenderer(r), r).toBe(true);
  });

  it("a real GPU, or nothing known, is not software", () => {
    for (const r of [
      "ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)",
      "Apple M2",
      "Mali-G78",
      "",
      null,
      undefined,
    ])
      expect(isSoftwareRenderer(r), String(r)).toBe(false);
  });
});

describe("rendererOf", () => {
  const gl = (plain: string, unmasked: string | null) => {
    const asked: string[] = [];
    return {
      asked,
      RENDERER: 1,
      getParameter: (p: number) => (p === 1 ? plain : p === 2 ? unmasked : null),
      getExtension: (name: string) => {
        asked.push(name);
        return unmasked === null ? null : { UNMASKED_RENDERER_WEBGL: 2 };
      },
    };
  };

  it("takes the plain renderer when it already names the GPU (no deprecated extension asked)", () => {
    const g = gl("ANGLE (AMD, AMD Radeon(TM) Graphics)", "x");
    expect(rendererOf(g)).toBe("ANGLE (AMD, AMD Radeon(TM) Graphics)");
    expect(g.asked).toEqual([]);
  });

  it("asks for the unmasked one when the plain one is only the browser's generic name", () => {
    expect(rendererOf(gl("WebKit WebGL", "Google SwiftShader"))).toBe("Google SwiftShader");
    expect(rendererOf(gl("WebKit WebGL", null))).toBe("WebKit WebGL");
  });
});
