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

/**
 * Mounted at the end of the scene's Suspense boundary (PlayShell): its effect runs once the scene's content is in. One
 * frame later (the content has been drawn once: its lights and the post chain are set up) every material is compiled for
 * the frame's target, and the reaction glyphs are drawn and uploaded in idle time (emojiSprite.ts).
 */
export function SceneWarmUp() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let stopEmoji: (() => void) | null = null;
    const id = requestAnimationFrame(() => {
      void warmScene(gl, scene, camera, activePostChain()?.target ?? null);
      stopEmoji = prewarmEmojiTextures(gl);
    });
    return () => {
      cancelAnimationFrame(id);
      stopEmoji?.();
    };
  }, [gl, scene, camera]);
  return null;
}
