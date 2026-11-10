import { describe, expect, it } from "vitest";
import {
  ACESFilmicToneMapping,
  Color,
  LinearSRGBColorSpace,
  Mesh,
  NeutralToneMapping,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  type Material,
  type ToneMapping,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { PostChain, outputDefines } from "./postChain";
import { BLOOM } from "./quality";

/** A renderer that only records where each draw went (no WebGL in the unit tests). */
function fakeRenderer(toneMapping: ToneMapping = NeutralToneMapping) {
  let target: WebGLRenderTarget | null = null;
  const draws: { target: WebGLRenderTarget | null; what: string }[] = [];
  const clear = new Color();
  const gl = {
    autoClear: true,
    toneMapping,
    toneMappingExposure: 1.4,
    outputColorSpace: SRGBColorSpace,
    setRenderTarget: (t: WebGLRenderTarget | null) => {
      target = t;
    },
    getRenderTarget: () => target,
    clear: () => {},
    getClearColor: (c: Color) => c.copy(clear),
    getClearAlpha: () => 1,
    setClearColor: (c: Color) => {
      clear.copy(c);
    },
    render: (object: unknown) => {
      const material = (object as Mesh).material as Material;
      const what = object instanceof Scene ? "scene" : material.name || material.type;
      draws.push({ target, what });
    },
  };
  return { gl: gl as unknown as WebGLRenderer, draws, target: () => target };
}

describe("PostChain: the rich tier's frame in three full-screen passes fewer", () => {
  it("draws the scene into ONE half-float target without MSAA, sized to the drawing buffer", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(2560, 1290);
    expect(chain.target.samples).toBe(0);
    expect(chain.target.width).toBe(2560);
    expect(chain.target.height).toBe(1290);
    expect(chain.target.texture.type).toBe(1016); // HalfFloatType
    // the bloom works at half size, as UnrealBloomPass always did
    expect(chain.bloomPass.renderTargetBright.width).toBe(1280);
  });

  it("a frame: the scene, the bloom (never back into the scene's target), then ONE pass to the screen", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(800, 600);
    const r = fakeRenderer();
    const scene = new Scene();
    chain.render(r.gl, scene, new PerspectiveCamera());
    expect(r.draws[0]).toEqual({ target: chain.target, what: "scene" });
    // nothing but the scene ever lands in the scene's target: no additive blend-back, no second resolve
    expect(r.draws.filter((d) => d.target === chain.target)).toHaveLength(1);
    // high pass + 5 mips x 2 blurs + composite
    const bloom = r.draws.slice(1, -1);
    expect(bloom).toHaveLength(1 + 10 + 1);
    expect(bloom.every((d) => d.target !== null)).toBe(true);
    // the last draw is the final pass, to the screen, reading the scene and the bloom's composite
    const last = r.draws[r.draws.length - 1]!;
    expect(last).toEqual({ target: null, what: "PostChain.output" });
    expect(chain.output.uniforms.tScene!.value).toBe(chain.target.texture);
    expect(chain.output.uniforms.tBloom!.value).toBe(chain.bloomPass.renderTargetsHorizontal[0]!.texture);
    expect(chain.output.uniforms.toneMappingExposure!.value).toBe(1.4);
    expect(chain.output.defines).toEqual({ SRGB_TRANSFER: "", NEUTRAL_TONE_MAPPING: "" });
    expect(r.gl.autoClear).toBe(true);
  });

  it("follows the renderer's tone curve (the school's ACES, the village's neutral) without a new material", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(800, 600);
    const material = chain.output;
    chain.render(fakeRenderer(ACESFilmicToneMapping).gl, new Scene(), new PerspectiveCamera());
    expect(chain.output.defines).toEqual({ SRGB_TRANSFER: "", ACES_FILMIC_TONE_MAPPING: "" });
    chain.render(fakeRenderer(NeutralToneMapping).gl, new Scene(), new PerspectiveCamera());
    expect(chain.output.defines).toEqual({ SRGB_TRANSFER: "", NEUTRAL_TONE_MAPPING: "" });
    expect(chain.output).toBe(material);
  });

  it("resizes only on a change (it is asked every frame)", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(1000, 500);
    const tex = chain.target.texture;
    chain.setSize(1000.4, 500.2);
    expect(chain.target.width).toBe(1000);
    expect(chain.target.texture).toBe(tex);
    chain.setSize(800, 400);
    expect(chain.target.width).toBe(800);
    expect((chain.output.uniforms.texel!.value as { x: number }).x).toBeCloseTo(1 / 800, 12);
  });
});

describe("outputDefines (OutputPass's rule)", () => {
  it("the tone curve and the sRGB transfer", () => {
    expect(outputDefines(NeutralToneMapping, SRGBColorSpace)).toEqual({ SRGB_TRANSFER: "", NEUTRAL_TONE_MAPPING: "" });
    expect(outputDefines(ACESFilmicToneMapping, LinearSRGBColorSpace)).toEqual({ ACES_FILMIC_TONE_MAPPING: "" });
  });
});
