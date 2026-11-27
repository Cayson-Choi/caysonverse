import { describe, expect, it } from "vitest";
import { CanvasTexture, LinearMipmapLinearFilter, MeshBasicMaterial, ShaderChunk } from "three";
import { TEXT_MIP_BIAS, biasedMapChunk, crispTextTexture, sharpenTextMaterial } from "./sceneText";

describe("sceneText (the 3D scene's lettering, fix/pine-text)", () => {
  it("mipmaps a text texture, trilinear, at the highest anisotropy", () => {
    const t = crispTextTexture(new CanvasTexture({ width: 4, height: 4 } as never));
    expect(t.generateMipmaps).toBe(true);
    expect(t.minFilter).toBe(LinearMipmapLinearFilter);
    expect(t.anisotropy).toBe(16);
  });

  it("samples the map with a negative mip bias, chained onto the material's own patch and program key", () => {
    expect(biasedMapChunk()).toContain(`texture2D( map, vMapUv, ${TEXT_MIP_BIAS.toFixed(2)} )`);
    expect(biasedMapChunk()).not.toBe(ShaderChunk.map_fragment);
    const m = new MeshBasicMaterial();
    let own = 0;
    m.onBeforeCompile = () => void own++;
    m.customProgramCacheKey = () => "own";
    sharpenTextMaterial(sharpenTextMaterial(m));
    const shader = { fragmentShader: "a\n#include <map_fragment>\nb", vertexShader: "", uniforms: {} };
    m.onBeforeCompile(shader as never, null as never);
    expect(own).toBe(1);
    expect(shader.fragmentShader).toContain(`vMapUv, ${TEXT_MIP_BIAS.toFixed(2)} )`);
    expect(shader.fragmentShader).not.toContain("#include <map_fragment>");
    expect(m.customProgramCacheKey()).toBe(`own|text-bias${TEXT_MIP_BIAS}`);
  });
});
