import { useSyncExternalStore } from "react";
import { MessageType } from "@caysonverse/shared/messages";
import { TRANSIT } from "@caysonverse/shared/village/transit";
import { villageClock } from "../village/villageClock";
import type {
  BusRejectedPayload,
  BusRidePayload,
  BusRideStatePayload,
  BusStatePayload,
} from "@caysonverse/shared/messages";

/** Minimal room surface used by the village transit bridge (easy to fake in tests). */
export interface TransitRoom {
  send(type: string, payload: unknown): void;
  onMessage<T = unknown>(type: string, callback: (message: T) => void): () => void;
}

export interface TransitClientState {
  snapshot: BusStatePayload | null;
  boarded: boolean;
  tripId: number | null;
  notice: string | null;
}

const initial: TransitClientState = { snapshot: null, boarded: false, tripId: null, notice: null };
let state: TransitClientState = initial;
let boundRoom: TransitRoom | null = null;
const listeners = new Set<() => void>();

/** Render pose is kept outside React so the bus can ease every frame without re-rendering the HUD. */
let renderPose = { x: TRANSIT.stop.x, z: TRANSIT.stop.z, yaw: Math.PI }; // parked: heading north (-z)
let targetPose = { ...renderPose };
let hasPose = false;

/**
 * The transit clock: the server's time as the bus snapshots carry it (`serverMs`), for the crosswalk lamps and the
 * crosswalk hint. Review r2: the lamps ran on the village clock (device clock + ONE offset measured when a ServerTime
 * message was handled), which lagged by however long the main thread was busy at that moment (entering: GLB decoding),
 * so a lamp turned green ~1 s after the bus moved off. Every snapshot is a sample `serverMs - performance.now()`; a late
 * one (network, a long frame) only makes its sample smaller, so the clock is the LARGEST sample of the last few seconds:
 * the server's time less the quickest delivery. The bus is drawn from the same snapshots (eased), so a lamp never lags
 * its bus. Before the first sample (or from an old server without `serverMs`) it is the village clock.
 */
const CLOCK_WINDOW = 24; // 6 s of snapshots at 4 Hz
const clockSamples: number[] = [];
let clockOffset: number | null = null;
const monotonic = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function sampleClock(serverMs: number | undefined, receivedAt = monotonic()): void {
  if (typeof serverMs !== "number" || !Number.isFinite(serverMs)) return;
  clockSamples.push(serverMs - receivedAt);
  if (clockSamples.length > CLOCK_WINDOW) clockSamples.shift();
  clockOffset = Math.max(...clockSamples);
}

/** The server's time now (Unix ms) by the bus snapshots; the village clock (unpinned) until the first one. */
export function transitNowMs(): number {
  return clockOffset === null ? villageClock.liveMs() : monotonic() + clockOffset;
}

/** Tests: feed a snapshot's clock sample received at `receivedAt` (performance.now() units). */
export function sampleTransitClockForTest(serverMs: number, receivedAt: number): void {
  sampleClock(serverMs, receivedAt);
}

function resetClock(): void {
  clockSamples.length = 0;
  clockOffset = null;
}

function publish(next: TransitClientState): void {
  state = next;
  for (const listener of listeners) listener();
}

function setSnapshot(snapshot: BusStatePayload): void {
  sampleClock(snapshot.serverMs);
  targetPose = { x: snapshot.x, z: snapshot.z, yaw: snapshot.yaw };
  if (!hasPose) {
    renderPose = { ...targetPose };
    hasPose = true;
  }
  publish({ ...state, snapshot, notice: null });
}

function setRide(next: BusRideStatePayload): void {
  publish({ ...state, boarded: next.boarded, tripId: next.tripId, notice: null });
}

/** Bind one village room; cleanup is called when the scene unmounts or reconnects. */
export function startTransitSync(room: TransitRoom): () => void {
  boundRoom = room;
  hasPose = false;
  resetClock();
  targetPose = { x: TRANSIT.stop.x, z: TRANSIT.stop.z, yaw: Math.PI };
  renderPose = { ...targetPose };
  publish(initial);
  const offState = room.onMessage<BusStatePayload>(MessageType.BusState, setSnapshot);
  const offRide = room.onMessage<BusRideStatePayload>(MessageType.BusRideState, setRide);
  const offRejected = room.onMessage<BusRejectedPayload>(MessageType.BusRejected, (m) => {
    publish({ ...state, notice: m.reason });
  });
  return () => {
    offState();
    offRide();
    offRejected();
    if (boundRoom === room) boundRoom = null;
    publish(initial);
    hasPose = false;
  };
}

/** Request a board/leave action; the server remains authoritative. */
export function sendBusRide(action: BusRidePayload["action"]): void {
  boundRoom?.send(MessageType.BusRide, { action } satisfies BusRidePayload);
}

export function subscribeTransit(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTransitState(): TransitClientState {
  return state;
}

/** React hook for the compact ride/status HUD and the interaction target label. */
export function useTransitState(): TransitClientState {
  return useSyncExternalStore(subscribeTransit, getTransitState, getTransitState);
}

/** Smooth the last server snapshot toward the current route pose. */
export function stepTransitRender(deltaSeconds: number): void {
  const alpha = 1 - Math.exp(-Math.max(0, deltaSeconds) * 12);
  renderPose.x += (targetPose.x - renderPose.x) * alpha;
  renderPose.z += (targetPose.z - renderPose.z) * alpha;
  let angle = targetPose.yaw - renderPose.yaw;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  renderPose.yaw += angle * alpha;
}

export function getTransitRenderPose(): Readonly<{ x: number; z: number; yaw: number }> {
  return renderPose;
}

/**
 * The ride HUD's second line. Review r2: it said "빨간불" whenever the bus waited, also under a green; the bus now waits
 * only on amber or red (transit.ts tripTimeline), and the line names the light the snapshot carries.
 */
export function rideStatusText(snapshot: { waiting?: boolean; signal?: string } | null): string {
  if (!snapshot?.waiting) return "노선 운행 중";
  if (snapshot.signal === "amber") return "황색불 · 신호 대기 중";
  if (snapshot.signal === "green") return "초록불 · 곧 출발해요";
  return "빨간불 · 신호 대기 중";
}
