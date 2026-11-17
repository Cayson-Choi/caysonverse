import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import { installProgramGate, type ProgramGateStats } from "./programGate";

declare global {
  interface Window {
    /** DEV: the shader gate's counters (programGate.ts). */
    __cvProgramGate?: () => ProgramGateStats;
  }
}

/** How often (ms) the scene's not-yet-uploaded textures are looked for. */
const PREFETCH_EVERY_MS = 4000;

/** Mounted once in the play Canvas: objects whose shader is still compiling wait a frame or two instead of freezing it (programGate.ts). */
export function ProgramGate(): null {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useLayoutEffect(() => {
    // DEV: `?gate=off` leaves it out (to compare)
    if (import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).get("gate") === "off") return;
    const gate = installProgramGate(gl);
    const probe = () => ({ ...gate.stats, mismatches: [...gate.stats.mismatches] });
    if (import.meta.env.DEV) window.__cvProgramGate = probe;
    // what the view has not shown yet (the map's whole village, the night's lamps, a model that came late): its textures
    // go up ahead, a few a frame, every few seconds' look at the scene
    const prefetch = window.setInterval(() => gate.prefetch(scene), PREFETCH_EVERY_MS);
    return () => {
      window.clearInterval(prefetch);
      gate.uninstall();
      // a new canvas's gate may be in already (a tier change): only ours goes
      if (import.meta.env.DEV && window.__cvProgramGate === probe) delete window.__cvProgramGate;
    };
  }, [gl, scene]);
  return null;
}
