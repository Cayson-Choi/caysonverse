import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { installProgramGate, type ProgramGateStats } from "./programGate";

declare global {
  interface Window {
    /** DEV: the shader gate's counters (programGate.ts). */
    __cvProgramGate?: () => ProgramGateStats;
  }
}

/** Mounted once in the play Canvas: objects whose shader is still compiling wait a frame or two instead of freezing it (programGate.ts). */
export function ProgramGate(): null {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const gate = installProgramGate(gl);
    if (import.meta.env.DEV) window.__cvProgramGate = () => ({ ...gate.stats, mismatches: [...gate.stats.mismatches] });
    return () => {
      gate.uninstall();
      if (import.meta.env.DEV) delete window.__cvProgramGate;
    };
  }, [gl]);
  return null;
}
