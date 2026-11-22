import { describe, expect, it } from "vitest";
import { MeshBasicMaterial, MeshStandardMaterial, ShaderLib, type Material, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from "three";
import { installFade, NEAR_FADE_GLSL, nearFadeOf, setFadeCut, setNearFade } from "./avatarFade";

/** Run a material's onBeforeCompile on the real three.js shader sources of its kind. */
function compile(material: Material, lib: { vertexShader: string; fragmentShader: string }) {
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader as unknown as { fragmentShader: string; uniforms: Record<string, { value: unknown }> };
}

describe("avatarFade near-lens fade (owner 2026-11-20: a rider near the lens is not hidden whole)", () => {
  it("a lit avatar material discards only the fragments near the lens, by its own uniform", () => {
    const m = new MeshStandardMaterial();
    installFade(m);
    const s = compile(m, ShaderLib.physical);
    expect(s.fragmentShader).toContain("uniform vec2 uNearFade;");
    expect(s.fragmentShader).toContain(NEAR_FADE_GLSL);
    // after the declarations: vViewPosition is declared before main()
    expect(s.fragmentShader.indexOf("varying vec3 vViewPosition;")).toBeLessThan(s.fragmentShader.indexOf(NEAR_FADE_GLSL));
    expect(s.uniforms.uNearFade).toBe(nearFadeOf(m));
    expect(nearFadeOf(m).value).toEqual([0, 0]); // off until set
    setNearFade([m], 0.3, 0.7);
    expect(s.uniforms.uNearFade!.value).toEqual([0.3, 0.7]);
    setNearFade([m], 0, 0);
    expect(nearFadeOf(m).value[0]).toBe(0);
  });

  it("an unlit material (no view position) keeps only the crossfade cut", () => {
    const m = new MeshBasicMaterial();
    installFade(m);
    const s = compile(m, ShaderLib.basic);
    expect(s.fragmentShader).not.toContain("uNearFade");
    expect(s.fragmentShader).toContain("uniform float uFadeCut;");
  });

  it("each material has its own near fade (one avatar's never reaches another's)", () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    installFade(a);
    installFade(b);
    setNearFade([a], 0.3, 0.7);
    setFadeCut([a], 0.5);
    expect(nearFadeOf(b).value).toEqual([0, 0]);
  });
});
