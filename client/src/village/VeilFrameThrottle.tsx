import { useEffect, useSyncExternalStore } from "react";
import { useThree } from "@react-three/fiber";
import { renderersBehindLoadingVeil } from "../game/programGate";
import { vegDressing } from "./vegDressing";

const dressed = () => vegDressing.dressed();

/** How often (ms) the scene is drawn while the loading veil covers it (warm-ups and the first frames still need some). */
export const COVERED_FRAME_MS = 400;

/**
 * While the vegetation veil (VegVeil) covers the village, nobody sees the 3D picture, yet every hand-back of the
 * vegetation build drew a whole village frame: on a slow phone about a third of the time under the veil
 * (perf/no-hitch: 160 ms build slices, then a 60-100 ms frame). Under the veil the scene is drawn a few times a second
 * (`frameloop: "demand"` and an invalidate every COVERED_FRAME_MS) and the build gets the rest; uncovered, every frame.
 */
export function VeilFrameThrottle({ active }: { active: boolean }) {
  const ready = useSyncExternalStore(vegDressing.subscribe, dressed, dressed);
  const gl = useThree((s) => s.gl);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const covered = active && !ready;
  useEffect(() => {
    if (!covered) return;
    renderersBehindLoadingVeil.add(gl);
    setFrameloop("demand");
    const tick = window.setInterval(() => invalidate(), COVERED_FRAME_MS);
    return () => {
      renderersBehindLoadingVeil.delete(gl);
      window.clearInterval(tick);
      setFrameloop("always");
    };
  }, [covered, gl, setFrameloop, invalidate]);
  return null;
}
