import { describe, expect, it } from "vitest";
import { Object3D, PerspectiveCamera, WebGLRenderTarget } from "three";
import { warmScene } from "./SceneWarmUp";

describe("warmScene: every material compiled ahead, for the target the frame is really drawn into", () => {
  const fake = (start: WebGLRenderTarget | null) => {
    let target = start;
    const compiledFor: (WebGLRenderTarget | null)[] = [];
    return {
      compiledFor,
      now: () => target,
      gl: {
        getRenderTarget: () => target,
        setRenderTarget: (t: WebGLRenderTarget | null) => {
          target = t;
        },
        compileAsync: () => {
          compiledFor.push(target);
          return Promise.resolve(undefined);
        },
      },
    };
  };

  it("the rich tier compiles for its half-float target (no tone mapping there) and gives the renderer's target back", async () => {
    const hdr = new WebGLRenderTarget(4, 4);
    const f = fake(null);
    await warmScene(f.gl as never, new Object3D(), new PerspectiveCamera(), hdr);
    expect(f.compiledFor).toEqual([hdr]);
    expect(f.now()).toBeNull();
  });

  it("the light tier compiles for the screen", async () => {
    const other = new WebGLRenderTarget(2, 2);
    const f = fake(other);
    await warmScene(f.gl as never, new Object3D(), new PerspectiveCamera(), null);
    expect(f.compiledFor).toEqual([null]);
    expect(f.now()).toBe(other);
  });

  it("a failed compile is not thrown into the frame", async () => {
    const f = fake(null);
    const gl = { ...f.gl, compileAsync: () => Promise.reject(new Error("lost context")) };
    await expect(warmScene(gl as never, new Object3D(), new PerspectiveCamera(), null)).resolves.toBeUndefined();
  });
});
