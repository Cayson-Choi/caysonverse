import { afterEach, describe, expect, it } from "vitest";
import { NeutralToneMapping, Object3D, PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import { InkLayer, hasInkFeatures } from "./inkLayer";
import { addInkLabel } from "./inkLabels";

/** A renderer stand-in drawing at dpr 1 for a dpr-3 device, with `gl` as its context. */
function renderer(gl: unknown): WebGLRenderer {
  let resets = 0;
  return {
    getContext: () => gl,
    getPixelRatio: () => 1,
    toneMapping: NeutralToneMapping,
    toneMappingExposure: 1,
    resetState: () => {
      resets++;
    },
    get resets() {
      return resets;
    },
  } as unknown as WebGLRenderer;
}

function sign(scene: Scene) {
  const object = new Object3D();
  object.position.set(0, 1.5, 0);
  scene.add(object);
  scene.updateMatrixWorld(true);
  const ink: boolean[] = [];
  const off = addInkLabel({ object, w: 1, h: 0.3, paint() {}, setInk: (on) => ink.push(on) });
  return { ink, off };
}

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(55, 412 / 915, 0.1, 200);
  c.position.set(0, 1.5, 3);
  c.lookAt(0, 1.5, 0);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

const g = globalThis as { WebGL2RenderingContext?: unknown };
const had = "WebGL2RenderingContext" in g;
const saved = g.WebGL2RenderingContext;
afterEach(() => {
  if (had) g.WebGL2RenderingContext = saved;
  else delete g.WebGL2RenderingContext;
});

describe("InkLayer: it falls back to the signs' own lettering, without an error", () => {
  it("no WebGL2 at all: stays off, never hides a sign's lettering", () => {
    delete g.WebGL2RenderingContext;
    const scene = new Scene();
    const s = sign(scene);
    const layer = new InkLayer();
    expect(() => layer.update(renderer({}), scene, camera(), 1236, 2745, 3)).not.toThrow();
    expect(layer.stats.active).toBe(false);
    layer.draw(null, [], 1236, 2745);
    expect(s.ink).not.toContain(false);
    s.off();
    layer.dispose();
  });

  it("a WebGL2 context without occlusion queries or fences: stays off", () => {
    class FakeGl2 {
      isContextLost() {
        return false;
      }
    }
    g.WebGL2RenderingContext = FakeGl2;
    const gl = new FakeGl2();
    expect(hasInkFeatures(gl as unknown as WebGL2RenderingContext)).toBe(false);
    const scene = new Scene();
    const s = sign(scene);
    const layer = new InkLayer();
    expect(() => layer.update(renderer(gl), scene, camera(), 1236, 2745, 3)).not.toThrow();
    expect(layer.stats.active).toBe(false);
    expect(s.ink).not.toContain(false);
    s.off();
    layer.dispose();
  });

  it("a GL call that throws mid-frame: off for good, the lettering given back, three's state reset", () => {
    const fn = () => {
      throw new Error("lost");
    };
    class FakeGl2 {
      ANY_SAMPLES_PASSED = 0x8c2f;
      PIXEL_PACK_BUFFER = 0x88eb;
      isContextLost() {
        return false;
      }
      createQuery = fn;
      beginQuery = fn;
      endQuery = fn;
      getQueryParameter = fn;
      fenceSync = fn;
      getSyncParameter = fn;
      getBufferSubData = fn;
      createVertexArray = fn;
      readPixels = fn;
      createShader = fn;
    }
    g.WebGL2RenderingContext = FakeGl2;
    const gl = new FakeGl2();
    expect(hasInkFeatures(gl as unknown as WebGL2RenderingContext)).toBe(true);
    const scene = new Scene();
    const s = sign(scene);
    const layer = new InkLayer();
    const r = renderer(gl);
    // (the first frame only notes the post chain's count; the GL work starts on the second)
    layer.update(r, scene, camera(), 1236, 2745, 3);
    expect(() => layer.update(r, scene, camera(), 1236, 2745, 3)).not.toThrow();
    expect(layer.stats.active).toBe(false);
    expect((r as unknown as { resets: number }).resets).toBeGreaterThan(0);
    // and it stays off
    expect(() => layer.update(r, scene, camera(), 1236, 2745, 3)).not.toThrow();
    expect(layer.stats.active).toBe(false);
    expect(s.ink).not.toContain(false);
    s.off();
    layer.dispose();
  });
});
