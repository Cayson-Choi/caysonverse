import { useGLTF, useTexture } from "@react-three/drei";
import { COUNSEL_LIGHTMAP_URL } from "./counselModelPrep";

/**
 * Releasing the counselling room's files when the team leaves the classroom — also when its model never mounted
 * (final fix B6, Task 24 review m3).
 *
 * CounselModel releases what it showed from its own unmount (loader caches cleared, GPU resources freed). But a
 * player who leaves while the model is still loading (the component suspended, so its effect never ran) left
 * `counsel.glb` and the light map in the loaders' caches for the rest of the session. The classroom scene
 * (EscapeScene, which always mounts) therefore holds the files for as long as it shows the room, and its release
 * clears the caches one tick after it unmounts — a remount in the same commit (React StrictMode in dev, a reconnect's
 * new scene) holds them again first. Clearing is idempotent: when the model did mount, its own release still disposes
 * the GPU side; when it never did, nothing reached the GPU and a load still in flight is simply dropped when it lands.
 */

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Forget `glb` and the counselling room's light map in the loaders' caches (safe to call more than once). */
export function clearCounselCaches(glb: string): void {
  useGLTF.clear(glb);
  useTexture.clear(COUNSEL_LIGHTMAP_URL);
}

function cancel(glb: string): void {
  const timer = pending.get(glb);
  if (timer === undefined) return;
  clearTimeout(timer);
  pending.delete(glb);
}

/**
 * Hold the room's files while a classroom scene shows `glb` (cancels a release still pending for it). Returns the
 * release: the caches are cleared one tick later unless something holds them again first.
 */
export function holdCounselFiles(glb: string): () => void {
  cancel(glb);
  return () => {
    cancel(glb);
    pending.set(
      glb,
      setTimeout(() => {
        pending.delete(glb);
        clearCounselCaches(glb);
      }, 0),
    );
  };
}
