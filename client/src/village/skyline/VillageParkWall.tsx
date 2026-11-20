/**
 * 케이슨랜드's castle wall seen from the village (owner 2026-11-20): round the park's skyline, its north side running into the village
 * gatehouse (shared/src/village/parkWall.ts VILLAGE_WALL_PLAN), on the real ground (the outer ground's heights, the same the skyline
 * stands on). Mounted with the skyline (after the village is dressed); its colliders are in villageGeometry (VILLAGE_WALL_SOLIDS).
 */
import { useEffect, useState } from "react";
import { VILLAGE_WALL_PLAN } from "@caysonverse/shared/village/parkWall";
import { getOuterGround } from "../outerGround";
import type { VillageTier } from "../villageModelPrep";
import { CastleWall, VILLAGE_WALL_LOOK } from "../../land/CastleWall";
import { wallMode } from "./skylinePlacement";

export function VillageParkWall({ tier }: { tier: VillageTier }) {
  const [heightAt, setHeightAt] = useState<((x: number, z: number) => number) | null>(() => getOuterGround()?.heightAt ?? null);
  useEffect(() => {
    if (heightAt || wallMode() === "off") return;
    const t = window.setInterval(() => {
      const g = getOuterGround();
      // keep the first ground seen (it is rebuilt when the lake draws; the wall must not blink out and rebuild then)
      if (g) setHeightAt(() => g.heightAt);
    }, 500);
    return () => window.clearInterval(t);
  }, [heightAt]);
  if (wallMode() === "off") return null;
  return <CastleWall id="village" plan={VILLAGE_WALL_PLAN} heightAt={heightAt} tier={tier === "high" ? "high" : "low"} look={VILLAGE_WALL_LOOK} lampsOn="outer" />;
}
