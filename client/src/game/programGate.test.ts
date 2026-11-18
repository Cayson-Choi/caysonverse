import { describe, expect, it, vi } from "vitest";
import { BufferGeometry, DataTexture, Float32BufferAttribute, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import { GEOMETRY_BYTES_PER_FRAME, MAX_SKIP_MS, installProgramGate, renderersBehindLoadingVeil, variantOf } from "./programGate";

/** A stand-in renderer: `compile` gives the material a program that becomes ready when `ready` says so. */
function fakeRenderer(parallel = true) {
  const props = new Map<object, { currentProgram?: { isReady(): boolean } }>();
  let ready = false;
  const drawn: string[] = [];
  const gl = {
    extensions: { has: (n: string) => parallel && n === "KHR_parallel_shader_compile" },
    properties: { get: (m: object) => (props.has(m) ? props.get(m)! : (props.set(m, {}), props.get(m)!)) },
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    compile: vi.fn((obj: Mesh) => {
      props.get(obj.material as object)!.currentProgram = { isReady: () => ready };
    }),
    renderBufferDirect(_c: unknown, _s: unknown, _g: unknown, _m: unknown, o: Mesh) {
      drawn.push(o.name);
    },
  };
  return { gl: gl as unknown as WebGLRenderer, drawn, setReady: (r: boolean) => (ready = r), compile: gl.compile };
}

/** renderBufferDirect without three's parameter types (the shadow pass passes a null scene and group). */
const rbd = (gl: WebGLRenderer, ...a: unknown[]) => (gl.renderBufferDirect as unknown as (...x: unknown[]) => void).apply(gl, a);

const flushTimers = () => new Promise((r) => setTimeout(r, 0));

describe("programGate", () => {
  it("keeps the upload budget on a slow visible frame and lifts it under the loading veil", () => {
    const f = fakeRenderer();
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const material = new MeshStandardMaterial();
    const ready = { isReady: () => true };
    const props = f.gl.properties.get(material) as { currentProgram?: typeof ready };
    props.currentProgram = ready;
    const bytes = GEOMETRY_BYTES_PER_FRAME;
    for (const name of ["first", "second"]) {
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(3 * Math.floor(bytes / 12)), 3));
      const mesh = new Mesh(geometry, material);
      mesh.name = name;
      scene.add(mesh);
    }
    f.gl.render = (root) => root.children.forEach((obj) => {
      const mesh = obj as Mesh;
      rbd(f.gl, camera, scene, mesh.geometry, material, mesh, null);
    });
    let t = 0;
    const gate = installProgramGate(f.gl, () => t);
    // Start the clock with an empty frame, then present both geometries after a 200 ms visible hitch.
    f.gl.render(new Scene(), camera);
    t = 200;
    f.gl.render(scene, camera);
    expect(f.drawn).toEqual(["first"]);
    renderersBehindLoadingVeil.add(f.gl);
    f.gl.render(scene, camera);
    expect(f.drawn).toEqual(["first", "first", "second"]);
    renderersBehindLoadingVeil.delete(f.gl);
    gate.uninstall();
  });

  it("holds an object back until its program is ready, compiling it after the frame", async () => {
    const f = fakeRenderer();
    let t = 0;
    const gate = installProgramGate(f.gl, () => t);
    const scene = new Scene();
    const cam = new PerspectiveCamera();
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    mesh.name = "a";
    const draw = () => rbd(f.gl, cam, scene, mesh.geometry, mesh.material as MeshStandardMaterial, mesh, null);
    draw();
    expect(f.drawn).toEqual([]);
    expect(f.compile).not.toHaveBeenCalled(); // never inside the frame
    await flushTimers();
    expect(f.compile).toHaveBeenCalledTimes(1);
    draw();
    expect(f.drawn).toEqual([]); // compiling
    f.setReady(true);
    draw();
    expect(f.drawn).toEqual(["a"]);
    expect(gate.stats.held).toBe(2);
    gate.uninstall();
  });

  it("lets a shadow pass through before any frame was drawn, and draws anyway after the cap", async () => {
    const f = fakeRenderer();
    let t = 0;
    installProgramGate(f.gl, () => t);
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    mesh.name = "b";
    rbd(f.gl, new PerspectiveCamera(), null, mesh.geometry, mesh.material as MeshStandardMaterial, mesh, null);
    expect(f.drawn).toEqual(["b"]);
    const scene = new Scene();
    rbd(f.gl, new PerspectiveCamera(), scene, mesh.geometry, mesh.material as MeshStandardMaterial, mesh, null);
    await flushTimers();
    t = MAX_SKIP_MS + 1;
    rbd(f.gl, new PerspectiveCamera(), scene, mesh.geometry, mesh.material as MeshStandardMaterial, mesh, null);
    expect(f.drawn).toEqual(["b", "b"]);
  });

  it("uploads a material's textures ahead, after the frame, before the object is drawn", async () => {
    const f = fakeRenderer();
    f.setReady(true);
    const uploaded = new Set<object>();
    const g = f.gl as unknown as { initTexture: (t: object) => void; properties: { get: (o: object) => Record<string, unknown> } };
    g.initTexture = (t) => {
      uploaded.add(t);
      g.properties.get(t).__webglInit = true;
    };
    installProgramGate(f.gl, () => 0);
    const tex = new DataTexture(new Uint8Array(4), 1, 1);
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map: tex }));
    mesh.name = "d";
    const scene = new Scene();
    const draw = () => rbd(f.gl, new PerspectiveCamera(), scene, mesh.geometry, mesh.material as MeshStandardMaterial, mesh, null);
    draw();
    expect(f.drawn).toEqual([]);
    await flushTimers();
    expect(uploaded.has(tex)).toBe(true);
    draw();
    expect(f.drawn).toEqual(["d"]);
  });

  it("does nothing without parallel compile", () => {
    const f = fakeRenderer(false);
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    mesh.name = "c";
    installProgramGate(f.gl);
    rbd(f.gl, new PerspectiveCamera(), new Scene(), mesh.geometry, mesh.material as MeshStandardMaterial, mesh, null);
    expect(f.drawn).toEqual(["c"]);
  });

  it("tells object variants apart", () => {
    const g = new BufferGeometry();
    const m = new Mesh(g, new MeshStandardMaterial());
    expect(variantOf(m, g)).toBe("");
    m.receiveShadow = true;
    g.setAttribute("color", new Float32BufferAttribute([0, 0, 0], 3));
    expect(variantOf(m, g)).toBe("rc");
  });
});

describe("programGate: released programs", () => {
  it("never asks GL about a program three released (no program object, or no material using it)", async () => {
    const { installProgramGate } = await import("./programGate");
    const isReady = vi.fn(() => false);
    const released = { isReady, program: undefined, usedTimes: 0 };
    const gl = {
      extensions: { has: () => true },
      // the drawn material's own program is ready (its first use asks whether anything else is still compiling)
      properties: { get: () => ({ currentProgram: { isReady: () => true } }) },
      info: { programs: [released] },
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      compile: () => new Set(),
      renderBufferDirect: () => {},
      render: () => {},
    } as unknown as WebGLRenderer;
    installProgramGate(gl, () => 0);
    const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
    const draw = vi.spyOn(gl as unknown as { renderBufferDirect: () => void }, "renderBufferDirect");
    rbd(gl, new PerspectiveCamera(), new Scene(), mesh.geometry, mesh.material as MeshStandardMaterial, mesh, null);
    await flushTimers();
    expect(isReady).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalled(); // the released program does not hold the draw back either
  });
});
