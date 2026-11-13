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
        const program = (gl.properties.get(m) as { currentProgram?: { isReady(): boolean | null } }).currentProgram;
        let ready = true;
        try {
          ready = !program || program.isReady() !== false;
        } catch {
          ready = true; // a lost context, a freed program: nothing left to wait for
        }
        if (ready) materials.delete(m);
      }
      if (materials.size === 0) resolve(scene);
      else setTimeout(check, 10);
    };
    if (gl.extensions.has("KHR_parallel_shader_compile")) check();
    else setTimeout(check, 10);
  });
}
