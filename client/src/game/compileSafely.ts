import type { Camera, Material, Object3D, Scene, WebGLRenderer } from "three";

/**
 * three's `compileAsync`, but safe when a material goes away while its program links: three's own check reads
 * `currentProgram.isReady()` in a timer and throws (an uncaught TypeError: "Cannot read properties of undefined
 * (reading 'isReady')") when the material was disposed meanwhile (the phone tier freeing the village's or the parked
 * vegetation's buffers, a cancelled build, a tier switch). A material without a program is no longer waited for.
 */
export function compileSafely(
  gl: Pick<WebGLRenderer, "compile" | "properties" | "extensions">,
  scene: Object3D,
  camera: Camera,
  targetScene: Scene | null = null,
): Promise<unknown> {
  let materials: Set<Material>;
  try {
    materials = gl.compile(scene, camera, targetScene) as Set<Material>;
  } catch {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const check = () => {
      for (const m of materials) {
        const program = (gl.properties.get(m) as { currentProgram?: { isReady(): boolean | null; program?: unknown } }).currentProgram;
        // (a program released meanwhile — its material freed, three's destroy() clears `program` — is never asked: a deleted object)
        if (programSettled(program)) materials.delete(m);
      }
      if (materials.size === 0) resolve(scene);
      else setTimeout(check, 10);
    };
    if (gl.extensions.has("KHR_parallel_shader_compile")) check();
    else setTimeout(check, 10);
  });
}

/**
 * Whether a three program is still ready to be asked about: false for one three has released (its GL object deleted, or about to
 * be) — asking a deleted program for its status is the "glGetProgramiv: Program object expected" GL warning. A released program
 * counts as settled (`true`): nothing is left to wait for. `ready` is the program's own `isReady()` (null: no program yet).
 */
export function programSettled(program: { isReady(): boolean | null; program?: unknown; usedTimes?: number } | null | undefined): boolean {
  if (!program) return true;
  if (("program" in program && program.program === undefined) || program.usedTimes === 0) return true;
  try {
    return program.isReady() !== false;
  } catch {
    return true; // a lost context
  }
}
