import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import type { Camera, Object3D, WebGLRenderTarget, WebGLRenderer } from "three";
import { activePostChain } from "./QualityEffects";
import { prewarmEmojiTextures } from "./emojiSprite";

/**
 * Compile every material in the scene now, for the target the frame is really drawn into (perf/interaction-latency).
 *
 * three compiles a material the first time an object with it is drawn. Some are drawn only later: the map view's
 * marker (hidden until the map opens), what lies outside the first view. Their programs were linked in the middle of a
 * frame then — 80-100 ms of waiting the first time the map opened. `compileAsync` makes them all now, in parallel where
 * the browser can (KHR_parallel_shader_compile), so later frames find them ready.
 *
 * The program depends on where the frame goes: into the rich tier's half-float target (no tone mapping there, linear
 * output) or to the screen (the light tier: tone-mapped, sRGB). So the compile runs with that target set, and the
 * renderer's own target is given back after.
 */
export function warmScene(
  gl: Pick<WebGLRenderer, "getRenderTarget" | "setRenderTarget" | "compileAsync">,
  scene: Object3D,
  camera: Camera,
  target: WebGLRenderTarget | null,
): Promise<unknown> {
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(target);
  try {
    return gl.compileAsync(scene, camera).catch(() => undefined);
  } finally {
    gl.setRenderTarget(prev);
  }
}

/** Run `fn` when the main thread is idle (soon after at the latest); returns a cancel. */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: 1000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 50);
  return () => clearTimeout(id);
}

/**
 * Mounted at the end of a Suspense boundary, after the content it waits for: PlayShell's (the avatars, the markers),
 * and the village's and the memorial hall's own (VillageScene.tsx, MemorialHall.tsx: their models load inside a boundary of
 * their own, after PlayShell's has resolved — a warm-up there alone ran before the village was in the scene). Its effect
 * runs once that content is in; one frame later (it has been drawn once: its lights and the post chain are set up), in
 * idle time, every material of the scene is compiled for the frame's target — the ones the first frames did not draw:
 * hidden ones (the night's stars and glows), ones out of view, the map view's. Compiling what is already compiled only
 * looks it up. Keyed by the tier where it is mounted (the target, and so every program, changes with it). `emoji`: also
 * draw and upload the reaction glyphs in idle time (emojiSprite.ts; PlayShell's).
 */
export function SceneWarmUp({ emoji = false }: { emoji?: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let stopEmoji: (() => void) | null = null;
    let stopIdle: (() => void) | null = null;
    const id = requestAnimationFrame(() => {
      stopIdle = whenIdle(() => void warmScene(gl, scene, camera, activePostChain()?.target ?? null));
      if (emoji) stopEmoji = prewarmEmojiTextures(gl);
    });
    return () => {
      cancelAnimationFrame(id);
      stopIdle?.();
      stopEmoji?.();
    };
  }, [gl, scene, camera, emoji]);
  return null;
}
