import { describe, expect, it, vi } from "vitest";
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  LinearSRGBColorSpace,
  Mesh,
  NeutralToneMapping,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  type Camera,
  type Material,
  type Object3D,
  type ToneMapping,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from "three";
import { GAUSS_SPREAD, GAUSS_TAPS, PostChain, bloomSigma, gaussianTapWeights, outputDefines } from "./postChain";
import { BLOOM } from "./quality";
import { renderScale } from "./renderScale";
import { LABEL_LAYER, billboardSprite } from "./spriteCanvas";

/** A renderer that only records where each draw went (no WebGL in the unit tests). */
function fakeRenderer(toneMapping: ToneMapping = NeutralToneMapping) {
  let target: WebGLRenderTarget | null = null;
  const draws: { target: WebGLRenderTarget | null; what: string; scale: number }[] = [];
  /** Per scene draw: the camera's layer mask, the autoClear in force and the scene's children at the time. */
  const scenes: { mask: number; autoClear: boolean; children: Object3D[]; matrixWorldAutoUpdate: boolean }[] = [];
  const clear = new Color();
  const gl = {
    autoClear: true,
    info: { autoReset: true },
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
    render: (object: unknown, camera: Camera) => {
      const material = (object as Mesh).material as Material;
      const what = object instanceof Scene ? "scene" : material.name || material.type;
      draws.push({ target, what, scale: renderScale() });
      if (object instanceof Scene) {
        scenes.push({
          mask: camera.layers.mask,
          autoClear: gl.autoClear,
          children: [...object.children],
          matrixWorldAutoUpdate: object.matrixWorldAutoUpdate,
        });
      }
    },
  };
  return { gl: gl as unknown as WebGLRenderer, draws, scenes, target: () => target };
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
    const bloom = r.draws.slice(1, -2);
    expect(bloom).toHaveLength(1 + 10 + 1);
    expect(bloom.every((d) => d.target !== null)).toBe(true);
    expect(bloom[0]).toEqual({ target: chain.bloomPass.renderTargetBright, what: "PostChain.bright", scale: 1 });
    expect(chain.highPass.uniforms.tDiffuse!.value).toBe(chain.target.texture);
    // then the final pass, to the screen, reading the scene and the bloom's composite...
    const last = r.draws[r.draws.length - 2]!;
    expect(last).toEqual({ target: null, what: "PostChain.output", scale: 1 });
    // ...and the labels over it, on the screen too
    expect(r.draws[r.draws.length - 1]).toEqual({ target: null, what: "scene", scale: 1 });
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

describe("PostChain labels (fix/crisp-labels): drawn last, at full resolution, never in the scene pass", () => {
  function labelled() {
    const scene = new Scene();
    const avatar = new Scene();
    const tag = billboardSprite(new CanvasTexture(undefined as never), 3, 0.3, 999);
    avatar.add(tag);
    scene.add(avatar);
    const camera = new PerspectiveCamera();
    camera.layers.enable(LABEL_LAYER); // as NametagSystem leaves it
    return { scene, avatar, tag, camera };
  }

  it("the scene pass leaves the label layer out; the label pass draws ONLY it, onto the finished frame", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(800, 600);
    chain.setScale(0.5); // the governor's lowest step: the labels must not be stretched with the scene
    const r = fakeRenderer();
    const { scene, avatar, camera } = labelled();
    const mask = camera.layers.mask;
    chain.render(r.gl, scene, camera);
    expect(r.scenes).toHaveLength(2);
    const [scenePass, labelPass] = r.scenes;
    expect(scenePass!.mask & (1 << LABEL_LAYER)).toBe(0);
    expect(scenePass!.mask & 1).toBe(1);
    expect(labelPass!.mask).toBe(1 << LABEL_LAYER);
    // to the screen (not the scaled scene target), at render scale 1, after the final pass, clearing nothing
    expect(r.draws.at(-1)).toEqual({ target: null, what: "scene", scale: 1 });
    expect(labelPass!.autoClear).toBe(false);
    // the label pass walks the real scene's children (the labels stay on their avatars) without re-updating matrices
    expect(labelPass!.children).toEqual([avatar]);
    expect(labelPass!.matrixWorldAutoUpdate).toBe(false);
    // ...from a scene of its own (its own render state: no lights flip-flopping in the real scene's)
    expect(avatar.parent).toBe(scene);
    // everything handed back
    expect(camera.layers.mask).toBe(mask);
    expect(r.gl.autoClear).toBe(true);
    expect(r.gl.info.autoReset).toBe(true);
  });

  it("the label pass's scene keeps no children between frames", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(800, 600);
    const r = fakeRenderer();
    const { scene, camera } = labelled();
    chain.render(r.gl, scene, camera);
    const labels = (chain as unknown as { labels: Scene }).labels;
    expect(labels.children).toHaveLength(0);
    expect(labels.children).not.toBe(scene.children);
    expect(scene.children).toHaveLength(1);
  });

  it("warmLabels compiles one stand-in label for the screen, in the label pass's own (light-less) scene, and keeps it", async () => {
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0 }) });
    try {
      const chain = new PostChain(BLOOM);
      const r = fakeRenderer();
      const target = chain.target;
      r.gl.setRenderTarget(target);
      const compiled: { object: Object3D; scene: Object3D; target: WebGLRenderTarget | null }[] = [];
      Object.assign(r.gl as object, {
        compile: (object: Object3D, _c: Camera, scene: Object3D) => {
          compiled.push({ object, scene, target: r.target() });
          return new Set();
        },
        properties: { get: () => ({}) },
        extensions: { has: () => true },
      });
      const camera = new PerspectiveCamera();
      await chain.warmLabels(r.gl, camera);
      await chain.warmLabels(r.gl, camera);
      expect(compiled).toHaveLength(2);
      const labels = (chain as unknown as { labels: Scene }).labels;
      expect(compiled[0]!.scene).toBe(labels);
      expect(compiled[0]!.target).toBeNull();
      expect(compiled[0]!.object.layers.mask).toBe(1 << LABEL_LAYER);
      expect(compiled[1]!.object).toBe(compiled[0]!.object); // the same stand-in: its program is never released
      expect(r.target()).toBe(target); // the renderer's target is given back
      chain.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("a throwing draw still gives the camera its layers back", () => {
    const chain = new PostChain(BLOOM);
    chain.setSize(800, 600);
    const r = fakeRenderer();
    const { scene, camera } = labelled();
    const mask = camera.layers.mask;
    (r.gl as unknown as { render: () => void }).render = () => {
      throw new Error("lost context");
    };
    expect(() => chain.render(r.gl, scene, camera)).toThrow();
    expect(camera.layers.mask).toBe(mask);
    expect(() => chain.renderLabels(r.gl, scene, camera)).toThrow();
    expect(camera.layers.mask).toBe(mask);
    expect(r.gl.autoClear).toBe(true);
    expect(r.gl.info.autoReset).toBe(true);
  });
});

describe("outputDefines (OutputPass's rule)", () => {
  it("the tone curve and the sRGB transfer", () => {
    expect(outputDefines(NeutralToneMapping, SRGBColorSpace)).toEqual({ SRGB_TRANSFER: "", NEUTRAL_TONE_MAPPING: "" });
    expect(outputDefines(ACESFilmicToneMapping, LinearSRGBColorSpace)).toEqual({ ACES_FILMIC_TONE_MAPPING: "" });
  });
});

describe("the bloom's blur is a round Gaussian (owner 2026-11-20: a bright star's glow had a SQUARE outline)", () => {
  it("every mip: weights sum to 1 and the kernel ends in a tail under 4 % of its peak (the stock one stopped at 0.6 of it: a box edge)", () => {
    for (let i = 0; i < 5; i++) {
      const sigma = bloomSigma(i);
      const { stride, weights } = gaussianTapWeights(sigma);
      expect(weights).toHaveLength(GAUSS_TAPS + 1);
      expect(weights[0]! + 2 * weights.slice(1).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      expect(weights[GAUSS_TAPS]! / weights[0]!).toBeLessThan(0.04);
      expect((GAUSS_TAPS * stride) / sigma).toBeCloseTo(GAUSS_SPREAD, 10);
      for (let k = 1; k <= GAUSS_TAPS; k++) expect(weights[k]!).toBeLessThan(weights[k - 1]!);
    }
  });

  it("the 2-D kernel (the product of the two passes) is isotropic: along a diagonal it falls as fast as along an axis", () => {
    const sigma = bloomSigma(2);
    const { stride, weights } = gaussianTapWeights(sigma);
    // distance 4 taps along an axis vs the diagonal tap (3, 3) at 4.24 taps: the same radius within a tap
    const axis = weights[4]! * weights[0]!;
    const diag = weights[3]! * weights[3]!;
    const rAxis = 4 * stride;
    const rDiag = Math.hypot(3, 3) * stride;
    const expected = Math.exp(-0.5 * ((rDiag * rDiag - rAxis * rAxis) / (sigma * sigma)));
    expect(diag / axis).toBeCloseTo(expected, 6);
  });
});
