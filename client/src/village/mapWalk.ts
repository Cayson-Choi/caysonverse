/**
 * "여기로 가기" from the top-down map (UX 2026-11-16): the avatar walks to a named place along the village's paths, leg by leg,
 * each leg planned and walked exactly as a click there would be (clickPlan.ts planClickMove, clickMove.ts setClickTarget) — the
 * same speed, collisions and server checks as any walk. It gives way at once to the player's own keys, stick or click (they
 * take the click target over), and stops with a short line when a leg cannot go on (something in the way).
 */
import { activeBounds, activeSeats, getActiveMap } from "../game/activeMap";
import { clearClickTarget, clickGeneration, endWalk, peekClickTarget, setClickTarget } from "../game/clickMove";
import { planClickMove, walkStart } from "../game/clickPlan";
import type { Pose, SeatState } from "../game/types";
import { useClickHint } from "../stores/clickHintStore";
import { mapPlace, wayTo } from "./villagePlaces";
import type { Point2 } from "@caysonverse/shared/village/villageLayout";

/** How often the walk looks at its leg (ms). */
const TICK_MS = 150;
/** A leg's walk that ended this close to its waypoint (m) reached it. */
const LEG_REACHED_M = 1.5;

export const MAP_WALK_COPY = {
  blocked: "길이 막혀서 멈췄어요. 조금 비켜서 다시 눌러 보세요.",
  noWay: "그곳으로 가는 길을 찾지 못했어요.",
  arrived: (name: string) => `${name}에 도착했어요.`,
} as const;

interface Walk {
  name: string;
  legs: Point2[];
  leg: number;
  gen: number;
  timer: ReturnType<typeof setInterval>;
  pose: Pose;
  seat: SeatState;
}

let walk: Walk | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of [...listeners]) l();
};

/** The place being walked to (its name), or null. */
export function mapWalkTarget(): string | null {
  return walk?.name ?? null;
}
export function subscribeMapWalk(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function stop(hint?: string): void {
  if (!walk) return;
  clearInterval(walk.timer);
  if (walk.gen === clickGeneration() && peekClickTarget()) endWalk();
  walk = null;
  if (hint) useClickHint.getState().show(hint);
  emit();
}

/** Stop a map walk (the player took over, the scene went away). Says nothing. */
export function cancelMapWalk(): void {
  stop();
}

/** Plan and start leg `w.leg` from where the body stands (or gets up onto); false when there is no way. */
function startLeg(w: Walk): boolean {
  for (;;) {
    const goal = w.legs[w.leg];
    if (!goal) return false;
    const s = w.seat.index >= 0 ? activeSeats()[w.seat.index] : undefined;
    const from = walkStart(w.pose.x, w.pose.z, s, null);
    const map = getActiveMap();
    const plan = planClickMove(from.x, from.z, { x: goal.x, y: 0, z: goal.z, ny: 1 }, map.geometry.obstacles, activeBounds(), !!s, { furniture: map.furniture });
    if (!plan.ok) {
      if (plan.reason === "here" && w.leg + 1 < w.legs.length) {
        w.leg++;
        continue; // already there: the next leg
      }
      return plan.reason === "here";
    }
    setClickTarget(plan.x, plan.z, plan.y, plan.via);
    w.gen = clickGeneration();
    return true;
  }
}

function tick(): void {
  const w = walk;
  if (!w) return;
  // the player's own keys, stick or click took over (each drops or replaces the target: a new generation)
  if (clickGeneration() !== w.gen) {
    stop();
    return;
  }
  if (peekClickTarget()) return; // still walking this leg
  const goal = w.legs[w.leg]!;
  if (Math.hypot(goal.x - w.pose.x, goal.z - w.pose.z) > LEG_REACHED_M) {
    stop(MAP_WALK_COPY.blocked); // the walk ended short of the waypoint: something is in the way
    return;
  }
  if (w.leg + 1 >= w.legs.length) {
    stop(MAP_WALK_COPY.arrived(w.name));
    return;
  }
  w.leg++;
  if (!startLeg(w)) stop(MAP_WALK_COPY.blocked);
}

/** Walk to the map place `id` from where the player is (`pose`, `seat`: the live objects). False when it cannot start. */
export function startMapWalk(id: string, pose: Pose, seat: SeatState): boolean {
  stop();
  const place = mapPlace(id);
  if (!place) return false;
  // This destination replaces the previous click even when the planner says we are already here.
  clearClickTarget();
  const legs = wayTo(place, pose.x, pose.z);
  const w: Walk = { name: place.name, legs, leg: 0, gen: clickGeneration(), timer: setInterval(tick, TICK_MS), pose, seat };
  walk = w;
  if (!startLeg(w)) {
    const here = Math.hypot(legs[legs.length - 1]!.x - pose.x, legs[legs.length - 1]!.z - pose.z) <= LEG_REACHED_M;
    stop(here ? MAP_WALK_COPY.arrived(place.name) : MAP_WALK_COPY.noWay);
    return false;
  }
  emit();
  return true;
}
