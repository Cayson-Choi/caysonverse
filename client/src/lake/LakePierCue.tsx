import { useEffect, useRef } from "react";
import type { Orbit, Pose } from "../game/types";
import { setClickTarget } from "../game/clickMove";
import { planClickMove } from "../game/clickPlan";
import { activeBounds, activeSeats, getActiveMap } from "../game/activeMap";
import { seatApproachGoal } from "../game/seatTap";
import { getRemoteSeatIndices } from "../game/remoteStore";
import { LAKE_SEAT_BASE } from "@caysonverse/shared/village/benchSeats";
import { useClickHint } from "../stores/clickHintStore";
import { viewState } from "../game/viewState";
import { viewYawOf } from "../game/coach";
import { nearestFreeChairStand, screenBearing } from "./pierCueMath";
import { forEachAngler, selfId } from "./lakeNet";
import "./pierCue.css";

/** The cue's refresh (ms): the arrow follows the camera and the walk. */
const CUE_MS = 100;

/**
 * After renting (UX 2026-11-16): a small on-screen cue to the free fishing chairs (pier and shore) — an arrow that turns with the camera toward
 * the nearest free fishing chair and how far it is — never a mark on the ground. A tap walks there (the ordinary click walk);
 * once beside a chair the big button offers to sit. Shown while a rod is in hand and no chair is in reach.
 */
export function LakePierCue({ pose, orbit }: { pose: Pose; orbit: Orbit }) {
  const arrow = useRef<HTMLSpanElement>(null);
  const dist = useRef<HTMLSpanElement>(null);
  const goal = useRef<{ x: number; z: number; spot: number } | null>(null);

  useEffect(() => {
    const tick = () => {
      const occupied = new Set<number>();
      const me = selfId();
      forEachAngler((sid, v) => {
        if (sid !== me && v.spot >= 0) occupied.add(v.spot);
      });
      // a chair someone sits on without fishing (or a ghost keeping its seat through a reconnection) is taken too
      for (const i of getRemoteSeatIndices()) if (i >= LAKE_SEAT_BASE) occupied.add(i - LAKE_SEAT_BASE);
      const g = nearestFreeChairStand(pose.x, pose.z, occupied);
      goal.current = g;
      if (!g) return;
      const turn = screenBearing(pose.x, pose.z, g.x, g.z, viewYawOf(viewState, orbit));
      if (arrow.current) arrow.current.style.transform = `rotate(${turn}rad)`;
      if (dist.current) dist.current.textContent = `${Math.max(1, Math.round(Math.hypot(g.x - pose.x, g.z - pose.z)))} m`;
    };
    tick();
    const id = window.setInterval(tick, CUE_MS);
    return () => window.clearInterval(id);
  }, [pose, orbit]);

  return (
    <button
      type="button"
      className="cv-lake-cue"
      data-lake-cue
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const g = goal.current;
        if (!g) return;
        // the walk a click there would take (round the office's corner, the rails): clickPlan.ts
        const map = getActiveMap();
        // to the chair's own approach spot (where its 앉아서 낚시 is offered: beside it, never behind it), as a tap on it would
        const to = seatApproachGoal(activeSeats(), LAKE_SEAT_BASE + g.spot, map.geometry.obstacles, activeBounds()) ?? g;
        const plan = planClickMove(pose.x, pose.z, { x: to.x, y: 0, z: to.z, ny: 1 }, map.geometry.obstacles, activeBounds(), false, { furniture: map.furniture, farFirst: true });
        if (plan.ok) setClickTarget(plan.x, plan.z, plan.y, plan.via);
        else if (plan.reason !== "here") useClickHint.getState().show("그곳으로 가는 길을 찾지 못했어요.");
      }}
      aria-label="빈 낚시 의자로 가기"
    >
      <span className="cv-lake-cue-arrow" ref={arrow} aria-hidden="true">
        ↑
      </span>
      <span>빈 낚시 의자로 가요</span>
      <span className="cv-lake-cue-dist" ref={dist} />
      <span className="cv-lake-cue-go">가기</span>
    </button>
  );
}
