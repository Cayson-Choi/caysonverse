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
import { renderScale } from "./renderScale";

/** A renderer that only records where each draw went (no WebGL in the unit tests). */
function fakeRenderer(toneMapping: ToneMapping = NeutralToneMapping) {
  let target: WebGLRenderTarget | null = null;
  const draws: { target: WebGLRenderTarget | null; what: string; scale: number }[] = [];
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
      draws.push({ target, what, scale: renderScale() });
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
    expect(r.draws[0]).toEqual({ target: chain.target, what: "scene", scale: 1 });
    // nothing but the scene ever lands in the scene's target: no additive blend-back, no second resolve
    expect(r.draws.filter((d) => d.target === chain.target)).toHaveLength(1);
    // high pass + 5 mips x 2 blurs + composite
    const bloom = r.draws.slice(1, -1);
    expect(bloom).toHaveLength(1 + 10 + 1);
    expect(bloom.every((d) => d.target !== null)).toBe(true);
    expect(bloom[0]).toEqual({ target: chain.bloomPass.renderTargetBright, what: "PostChain.bright", scale: 1 });
    expect(chain.highPass.uniforms.tDiffuse!.value).toBe(chain.target.texture);
    // the last draw is the final pass, to the screen, reading the scene and the bloom's composite
    const last = r.draws[r.draws.length - 1]!;
    expect(last).toEqual({ target: null, what: "PostChain.output", scale: 1 });
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

describe("PostChain.setScale: the frame governor's step, with nothing re-made", () => {
  const vec = (m: { uniforms: Record<string, { value: unknown }> }, k: string) => {
    const v = m.uniforms[k]!.value as { x: number; y: number };
    return [v.x, v.y];
  };

  it("draws the scene into the bottom-left part of the SAME target, and both passes read only that part", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(2560, 1290);
    const tex = chain.target.texture;
    const bright = chain.bloomPass.renderTargetBright.texture;
    chain.setScale(1 / 1.5);
    // no new target, no new bloom target: a step allocates nothing (the canvas is not resized either)
    expect(chain.target.texture).toBe(tex);
    expect(chain.target.width).toBe(2560);
    expect(chain.bloomPass.renderTargetBright.texture).toBe(bright);
    expect(chain.bloomPass.renderTargetBright.width).toBe(1280);
    // the region: 1707 x 860, the scene's viewport and its clear held to it
    expect([chain.region.x, chain.region.y]).toEqual([1707, 860]);
    expect(chain.target.viewport.toArray()).toEqual([0, 0, 1707, 860]);
    expect(chain.target.scissor.toArray()).toEqual([0, 0, 1707, 860]);
    expect(chain.target.scissorTest).toBe(true);
    // the bright pass and the final pass read the region, never past its last texel
    expect(vec(chain.output, "uvScale")).toEqual([1707 / 2560, 860 / 1290]);
    expect(vec(chain.highPass, "uvScale")).toEqual([1707 / 2560, 860 / 1290]);
    expect(vec(chain.output, "uvMax")).toEqual([1706.5 / 2560, 859.5 / 1290]);
    // FXAA's neighbours stay one texel of the target apart
    expect(vec(chain.output, "texel")).toEqual([1 / 2560, 1 / 1290]);
  });

  it("scale 1 is the whole target, exactly as before (no scissor)", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(800, 600);
    chain.setScale(0.5);
    chain.setScale(1);
    expect(chain.target.viewport.toArray()).toEqual([0, 0, 800, 600]);
    expect(chain.target.scissorTest).toBe(false);
    expect(vec(chain.output, "uvScale")).toEqual([1, 1]);
  });

  it("a window resize keeps the scale (the region follows the new size)", () => {
    const chain = new PostChain(BLOOM);
    chain.setScale(0.5); // before any size: applied once there is one
    chain.setSize(1000, 600);
    expect([chain.region.x, chain.region.y]).toEqual([500, 300]);
    chain.setSize(2000, 1000);
    expect(chain.scale).toBe(0.5);
    expect([chain.region.x, chain.region.y]).toEqual([1000, 500]);
    expect(chain.target.viewport.toArray()).toEqual([0, 0, 1000, 500]);
  });

  it("is held to a sane range", () => {
    const chain = new PostChain(BLOOM);
    chain.setScale(3);
    expect(chain.scale).toBe(1);
    chain.setScale(0);
    expect(chain.scale).toBe(0.25);
    chain.setScale(Number.NaN);
    expect(chain.scale).toBe(1);
  });

  it("the scene pass is drawn with the render scale in force (screen-pixel sizes shrink with it), and only that pass", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(800, 600);
    chain.setScale(0.75);
    const r = fakeRenderer();
    chain.render(r.gl, new Scene(), new PerspectiveCamera());
    expect(r.draws[0]!.scale).toBe(0.75);
    expect(r.draws.slice(1).every((d) => d.scale === 1)).toBe(true);
    expect(renderScale()).toBe(1);
  });
});

describe("outputDefines (OutputPass's rule)", () => {
  it("the tone curve and the sRGB transfer", () => {
    expect(outputDefines(NeutralToneMapping, SRGBColorSpace)).toEqual({ SRGB_TRANSFER: "", NEUTRAL_TONE_MAPPING: "" });
    expect(outputDefines(ACESFilmicToneMapping, LinearSRGBColorSpace)).toEqual({ ACES_FILMIC_TONE_MAPPING: "" });
  });
});
