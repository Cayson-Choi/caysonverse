import { describe, expect, it } from "vitest";
import { MeshBasicMaterial } from "three";
import { GLASS_CLEAR_ALPHA, isHallGlass, patchHallGlassMaterial } from "./hallGlass";

describe("the hall's glass (review 2026-11-15 round 5: the east cubby doors did not read as glass)", () => {
  it("shades the east bank's door glass and the window / door glass, nothing else", () => {
    expect(isHallGlass("M_glass_e")).toBe(true);
    expect(isHallGlass("M_glass")).toBe(true);
    expect(isHallGlass("LM_oak")).toBe(false);
  });

  it("patches once: transparent, no depth write, its own program, the reflections spliced into the shader", () => {
    const m = new MeshBasicMaterial();
    patchHallGlassMaterial(m);
    const first = m.onBeforeCompile;
    patchHallGlassMaterial(m);
    expect(m.onBeforeCompile).toBe(first);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.customProgramCacheKey()).toBe("hall-glass");
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "void main() {\n#include <project_vertex>\n}",
      fragmentShader: "void main() {\n#include <opaque_fragment>\n}",
    };
    first.call(m, shader as never, undefined as never);
    expect(shader.vertexShader).toContain("vGlassWorld =");
    expect(shader.fragmentShader).toContain("fres");
    expect(shader.fragmentShader).toContain("gl_FragColor = vec4( col");
    expect(shader.uniforms.uGlassClear!.value).toBe(GLASS_CLEAR_ALPHA);
    expect(GLASS_CLEAR_ALPHA).toBeLessThan(0.15); // head-on the cubby inside stays in plain view
  });
});
