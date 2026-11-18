import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Plane, Vector3, Vector4 } from "three";
import type { BuiltAvatar } from "./characterAvatar";
import { clipAvatar, enableBenchClipping } from "./benchClip";
import { activePostChain } from "./QualityEffects";
import { programSettled } from "./compileSafely";

/** Two planes in the bench clip's form (intersection) that clip nothing: every point is in front of both. */
const NOTHING: Plane[] = [new Plane(new Vector3(0, 1, 0), 1e6), new Plane(new Vector3(0, 1, 0), 1e6)];

/** Frames to wait after mount (the scene, its lights and the post chain set up; on a PC the veil can lift within 30 frames). */
const AFTER_FRAMES = 3;

/**
 * The bench sitter's shader variant (benchClip.ts: two clipping planes), made once while `when()` holds (the village's
 * loading veil is up): the avatar is given planes that clip nothing and the scene is drawn once into a 1x1 corner of
 * the frame's own target, so three compiles the clipped programs (main and shadow passes) there and then, then the
 * planes come off. renderer.compile cannot do it (three sets the clipping state per material only inside render), so
 * without this the first sit froze the frame for 150-500 ms (perf/no-hitch, the fishing chair). Programs are shared
 * by key, so other avatars of the same kind of parts find them too. Once per session.
 */
let warmed = false;
export function useBenchClipWarmUp(avatar: BuiltAvatar, when: () => boolean): void {
  const frames = useRef(0);
  useFrame(({ gl, scene, camera }) => {
    if (warmed || ++frames.current < AFTER_FRAMES || !when()) return;
    // not while the scene's own shaders are still compiling: this pass waits for every program in flight (a slow phone's
    // arrival compiles a hundred), so it goes once they are done (still under the veil)
    if (gl.info.programs?.some((p) => !programSettled(p as unknown as { isReady(): boolean | null; program?: unknown; usedTimes?: number }))) return;
    warmed = true;
    const before = gl.info.programs?.length ?? 0;
    enableBenchClipping(gl);
    clipAvatar(avatar, NOTHING);
    const prevTarget = gl.getRenderTarget();
    const prevScissor = new Vector4();
    gl.getScissor(prevScissor);
    const prevTest = gl.getScissorTest();
    try {
      gl.setRenderTarget(activePostChain()?.target ?? null);
      gl.setScissorTest(true);
      gl.setScissor(0, 0, 1, 1);
      gl.render(scene, camera);
    } catch {
      // a lost context, a scene going away: the first sit compiles as before
    } finally {
      gl.setScissor(prevScissor);
      gl.setScissorTest(prevTest);
      gl.setRenderTarget(prevTarget);
      clipAvatar(avatar, null);
      if (import.meta.env.DEV) (window as unknown as { __cvClipWarm?: unknown }).__cvClipWarm = { frame: frames.current, programs: (gl.info.programs?.length ?? 0) - before, target: !!activePostChain() };
    }
  });
}
