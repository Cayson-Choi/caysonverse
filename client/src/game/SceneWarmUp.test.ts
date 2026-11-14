import { describe, expect, it } from "vitest";
import { MeshBasicMaterial, Object3D, PerspectiveCamera, WebGLRenderTarget } from "three";
import { compileSafely } from "./compileSafely";
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
        compile: () => {
          compiledFor.push(target);
          return new Set();
        },
        properties: { get: () => ({}) },
        extensions: { has: () => true },
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
    const gl = {
      ...f.gl,
      compile: () => {
        throw new Error("lost context");
      },
    };
    await expect(warmScene(gl as never, new Object3D(), new PerspectiveCamera(), null)).resolves.toBeUndefined();
  });
});

describe("compileSafely: three's compileAsync without its uncaught throw", () => {
  it("a material disposed while its program links (no program any more) is not waited for, and nothing throws", async () => {
    const a = new MeshBasicMaterial();
    const b = new MeshBasicMaterial();
    const props = new Map<object, { currentProgram?: { isReady(): boolean } }>();
    let readyB = false;
    props.set(a, { currentProgram: { isReady: () => true } });
    props.set(b, { currentProgram: { isReady: () => readyB } });
    const gl = {
      compile: () => new Set([a, b]),
      properties: { get: (m: object) => props.get(m) ?? {} },
      extensions: { has: () => true },
    };
    const done = compileSafely(gl as never, new Object3D(), new PerspectiveCamera());
    props.delete(b); // disposed: three's properties.remove (its program gone)
    await expect(done).resolves.toBeDefined();
    readyB = true;
  });

  it("waits for a program still linking", async () => {
    const a = new MeshBasicMaterial();
    let ready = false;
    const gl = {
      compile: () => new Set([a]),
      properties: { get: () => ({ currentProgram: { isReady: () => ready } }) },
      extensions: { has: () => true },
    };
    let resolved = false;
    const done = compileSafely(gl as never, new Object3D(), new PerspectiveCamera()).then(() => (resolved = true));
    await new Promise((r) => setTimeout(r, 25));
    expect(resolved).toBe(false);
    ready = true;
    await done;
    expect(resolved).toBe(true);
  });
});
