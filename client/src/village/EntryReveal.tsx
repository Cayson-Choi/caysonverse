import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { loadTracker } from "../game/loadTracker";
import { warmScene } from "../game/SceneWarmUp";
import { activePostChain } from "../game/QualityEffects";
import { currentProgramGate } from "../game/ShaderGate";
import { villageLoad } from "../ui/villageLoad";
import { isUploaded, nextCleanStreak, REVEAL_TIMING, sceneryQuiet, sceneryShare, texturesToUpload, uploadTextures } from "./entryRevealModel";

declare global {
  interface Window {
    /** The entry reveal's record (e2e/entry-reveal.mjs reads it): each stage's end (ms from the scene's mount) and what was given up on. */
    __cvEntryReveal?: { mountedAt: number; sceneryAt?: number; compiledAt?: number; uploadedAt?: number; uploads?: number; revealAt?: number; gaveUp?: string[]; frames?: number };
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The entry loading screen's last stages, inside the play canvas (entryRevealModel.ts): the scenery's files, the warm-up (compile, uploads)
 * and a few clean frames, then `villageLoad.warmed()` lifts the screen. Runs only for the entry the screen was opened for (mounted with
 * the scene; a scene mounted with no loading screen up — a reconnect, a tier switch — does nothing).
 */
export function EntryReveal({ phone }: { phone: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!villageLoad.get().open) return;
    const T = phone ? REVEAL_TIMING.phone : REVEAL_TIMING.pc;
    const t0 = performance.now();
    const rec: NonNullable<Window["__cvEntryReveal"]> = { mountedAt: Math.round(t0) };
    window.__cvEntryReveal = rec;
    // the scenery stage's share counts from the dressing (files still in flight then belong to it)
    let s0 = 0;
    let e0 = 0;
    let dead = false;
    const gone = () => dead || !villageLoad.get().open || villageLoad.get().closing;
    let raf = 0;
    let dressedAt = 0;

    const frames = async () => {
      const start = performance.now();
      let streak = 0;
      let n = 0;
      while (!gone()) {
        const gate = currentProgramGate();
        const before = gate?.stats.held ?? 0;
        invalidate();
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        // the frame is drawn in R3F's own animation-frame callback: read the gate after the next turn
        await sleep(0);
        n++;
        streak = nextCleanStreak(streak, before, gate?.stats.held ?? 0, gate?.stats.pending ?? 0, loadTracker.pending());
        villageLoad.warm(0.85 + 0.15 * Math.min(1, streak / T.cleanFrames));
        if (streak >= T.cleanFrames) break;
        if (performance.now() - start > T.framesCapMs) {
          rec.gaveUp = [...(rec.gaveUp ?? []), `frames held:${gate?.stats.held} pending:${gate?.stats.pending} files:${loadTracker.urls().join(",")}`];
          break;
        }
      }
      rec.frames = n;
    };

    const warm = async () => {
      villageLoad.warm(0.05);
      const chain = activePostChain();
      await Promise.race([warmScene(gl, scene, camera, chain?.target ?? null), sleep(T.warmCapMs)]);
      if (gone()) return;
      rec.compiledAt = Math.round(performance.now() - t0);
      villageLoad.warm(0.45);
      const list = texturesToUpload(scene, (t) => isUploaded(gl, t));
      rec.uploads = list.length;
      await uploadTextures(gl, list, T.uploadSliceMs, (d, total) => villageLoad.warm(0.45 + 0.4 * (total ? d / total : 1)), gone);
      if (gone()) return;
      rec.uploadedAt = Math.round(performance.now() - t0);
      await frames();
      if (dead) return;
      rec.revealAt = Math.round(performance.now() - t0);
      villageLoad.warmed();
    };

    const watch = () => {
      if (gone()) return;
      const L = villageLoad.get();
      const now = performance.now();
      if (L.dressed) {
        if (!dressedAt) {
          dressedAt = now;
          s0 = loadTracker.started() - loadTracker.pending();
          e0 = loadTracker.ended();
        }
        const pending = loadTracker.pending();
        villageLoad.scenery(sceneryShare(loadTracker.started() - s0, loadTracker.ended() - e0), pending);
        const quiet = sceneryQuiet(now, pending, loadTracker.lastChange(), T.quietMs);
        if (quiet || now - dressedAt > T.sceneryCapMs) {
          if (!quiet) rec.gaveUp = [...(rec.gaveUp ?? []), `scenery: ${loadTracker.urls().join(",")}`];
          if (!quiet) console.warn("[entry] the reveal stopped waiting for", loadTracker.urls());
          rec.sceneryAt = Math.round(now - t0);
          villageLoad.sceneryIn();
          void warm();
          return;
        }
      }
      raf = requestAnimationFrame(watch);
    };
    raf = requestAnimationFrame(watch);
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
    };
  }, [gl, scene, camera, invalidate, phone]);
  return null;
}
