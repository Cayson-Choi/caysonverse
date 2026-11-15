import { useSyncExternalStore } from "react";
import { MessageType } from "@caysonverse/shared/messages";
import { TRANSIT, busTripAt, type BusTrip } from "@caysonverse/shared/village/transit";
import { busDriveTrip, type BusDrive } from "@caysonverse/shared/village/busDrive";
import { villageClock } from "../village/villageClock";
import { selfBusRide } from "../game/busRide";
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

/**
 * Render pose: kept outside React, and NOT eased toward network samples. Every frame it is derived from the shared
 * deterministic timeline (transit.ts busTripAt: eased speed, a round arc, stops at the red signals) at the synced server
 * time (transitNowMs), the very function the server publishes its snapshots with. Review (fix/bus-smooth): the bus used to
 * chase the 250 ms snapshots with a first-order low-pass, so it moved in 0.3 m hops with a speed that rose and fell four
 * times a second ("it keeps stopping on its way"). The snapshots now only correct the clock and carry the status.
 */
let renderPose = { ...TRANSIT.parked }; // parked: along its lane at the stop, parallel to the kerb
let renderAt = Number.NaN;

/**
 * The transit clock: the server's time as the bus snapshots carry it (`serverMs`), for the crosswalk lamps and the
 * crosswalk hint. Review r2: the lamps ran on the village clock (device clock + ONE offset measured when a ServerTime
 * message was handled), which lagged by however long the main thread was busy at that moment (entering: GLB decoding),
 * so a lamp turned green ~1 s after the bus moved off. Every snapshot is a sample `serverMs - performance.now()`; a late
 * one (network, a long frame) only makes its sample smaller, so the clock is the LARGEST sample of the last few seconds:
 * the server's time less the quickest delivery. The bus is drawn from the same snapshots (eased), so a lamp never lags
 * its bus. Before the first sample (or from an old server without `serverMs`) it is the village clock.
 *
 * The clock the bus is drawn by must not hop either: the largest sample changes when one leaves the window, and a bare
 * jump of tens of ms would show as a jump of the bus. So `clockApplied` follows that target at no more than CLOCK_SLEW
 * (a clock that runs 2 % fast or slow: 0.02 x 1.2 m/s, invisible); only a first sample or a gap above CLOCK_SNAP_MS
 * (a suspended tab, a server clock change) takes it at once.
 */
const CLOCK_WINDOW = 24; // 6 s of snapshots at 4 Hz
const clockSamples: number[] = [];
let clockTarget: number | null = null;
let clockApplied: number | null = null;
let clockAt = 0;
/** how fast the applied offset may drift toward the target (ms per ms: 2 %) and the gap that is snapped instead */
const CLOCK_SLEW = 0.02;
const CLOCK_SNAP_MS = 1500;
const monotonic = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

function sampleClock(serverMs: number | undefined, receivedAt = monotonic()): void {
  if (typeof serverMs !== "number" || !Number.isFinite(serverMs)) return;
  clockSamples.push(serverMs - receivedAt);
  if (clockSamples.length > CLOCK_WINDOW) clockSamples.shift();
  clockTarget = Math.max(...clockSamples);
  if (clockApplied === null || Math.abs(clockTarget - clockApplied) > CLOCK_SNAP_MS) {
    clockApplied = clockTarget;
    clockAt = receivedAt;
  }
}

/** Let the applied offset drift toward the target for the time since the last look. */
function slewClock(now: number): void {
  if (clockApplied === null || clockTarget === null) return;
  const dt = Math.max(0, now - clockAt);
  clockAt = now;
  const step = CLOCK_SLEW * dt;
  clockApplied += Math.max(-step, Math.min(step, clockTarget - clockApplied));
}

/** The server's time now (Unix ms) by the bus snapshots; the village clock (unpinned) until the first one. */
export function transitNowMs(): number {
  if (clockApplied === null) return villageClock.liveMs();
  const now = monotonic();
  slewClock(now);
  return now + clockApplied;
}

/** Tests: feed a snapshot's clock sample received at `receivedAt` (performance.now() units). */
export function sampleTransitClockForTest(serverMs: number, receivedAt: number): void {
  sampleClock(serverMs, receivedAt);
}

function resetClock(): void {
  clockSamples.length = 0;
  clockTarget = null;
  clockApplied = null;
}

function publish(next: TransitClientState): void {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * How long a ride notice (a refused board, "next bus in ...") stays up (ms). Review 2026-11-15: the 4 Hz snapshots cleared
 * it, so a refusal showed for at most a quarter second and a first-time player never read why the bus did not take them.
 */
export const TRANSIT_NOTICE_MS = 5000;
let noticeUntil = 0;

/** The notice to keep on a snapshot: the current one while it is fresh. */
function liveNotice(): string | null {
  return state.notice !== null && monotonic() < noticeUntil ? state.notice : null;
}

/** Show a ride notice for TRANSIT_NOTICE_MS (the board button pressed outside the boarding window, a refusal). */
export function showTransitNotice(text: string): void {
  noticeUntil = monotonic() + TRANSIT_NOTICE_MS;
  publish({ ...state, notice: text });
}

/** Called once for each new horn toot the server announces (VillageBus plays it near the listener). */
let hornListener: ((count: number) => void) | null = null;
export function onBusHorn(fn: ((count: number) => void) | null): void {
  hornListener = fn;
}

function setSnapshot(snapshot: BusStatePayload): void {
  sampleClock(snapshot.serverMs);
  const prevHorn = state.snapshot?.horn;
  if (typeof snapshot.horn === "number" && typeof prevHorn === "number" && snapshot.horn > prevHorn) hornListener?.(snapshot.horn);
  renderAt = Number.NaN; // a new drive (a brake, a re-start) is drawn from at once
  publish({ ...state, snapshot, notice: liveNotice() });
}

function setRide(next: BusRideStatePayload): void {
  publish({ ...state, boarded: next.boarded, tripId: next.tripId, notice: null });
}

/**
 * The own `Player.busSeat` as the schema syncs it (remoteSync.ts): a place in the bus means aboard. The schema is synced
 * whole again after a reconnect, while the one-off BusRideState the server re-sends then can land before the remounted
 * scene listens (e2e village-bus-rider: a rider's client read "not aboard" mid-lap after a short drop, while the server
 * still had them in the bus). So the place keeps `boarded` true whatever the order.
 */
export function noteSelfBusSeat(slot: number): void {
  const aboard = slot >= 0;
  if (aboard !== state.boarded) publish({ ...state, boarded: aboard, notice: aboard ? null : state.notice });
}

/** Bind one village room; cleanup is called when the scene unmounts or reconnects. */
export function startTransitSync(room: TransitRoom): () => void {
  boundRoom = room;
  resetClock();
  renderAt = Number.NaN;
  renderPose = { ...TRANSIT.parked };
  // a remount after a reconnect: aboard if the schema already gave us a place in the bus (noteSelfBusSeat)
  publish(selfBusRide.slot >= 0 ? { ...initial, boarded: true } : initial);
  const offState = room.onMessage<BusStatePayload>(MessageType.BusState, setSnapshot);
  const offRide = room.onMessage<BusRideStatePayload>(MessageType.BusRideState, setRide);
  const offRejected = room.onMessage<BusRejectedPayload>(MessageType.BusRejected, (m) => showTransitNotice(m.reason));
  return () => {
    offState();
    offRide();
    offRejected();
    if (boundRoom === room) boundRoom = null;
    publish(initial);
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

/**
 * The bus's trip at `nowMs` (server time): by the drive the server's driver published (it stops for avatars on the road,
 * busDrive.ts), evaluated here at the synced time so it moves smoothly between snapshots; by the bare timetable before the
 * first snapshot or from an old server without one. The stop's countdown and the board button read it too, so a held-up
 * bus's later departure shows at once.
 */
export function transitTripAt(nowMs: number): BusTrip {
  const drive = state.snapshot?.drive as BusDrive | undefined;
  return drive ? busDriveTrip(drive, nowMs) : busTripAt(nowMs);
}

let renderMoving = false;

/** The bus's pose at the synced server time, written into the render pose (once per distinct instant). */
function refreshRenderPose(): void {
  const now = transitNowMs();
  if (now === renderAt) return;
  renderAt = now;
  const trip = transitTripAt(now);
  const pose = trip.pose;
  renderPose.x = pose.x;
  renderPose.z = pose.z;
  renderPose.yaw = pose.yaw;
  renderMoving = state.snapshot !== null && trip.status === "inTransit";
}

/**
 * The bus's pose while it is out on the road (null while it is parked at the stop, whose box is a static collider, or
 * before the first snapshot): the local player's slide treats its body as solid (playerObstacles.ts).
 */
export function getMovingBusPose(): Readonly<{ x: number; z: number; yaw: number }> | null {
  refreshRenderPose();
  return renderMoving ? renderPose : null;
}

/**
 * The bus's body pose wherever it is, parked at the stop or out on the road (2026-11-15: one moving solid, no static
 * collider at the stop, so nothing is left behind when the bus is away). Before the first snapshot it is the timetable's.
 */
export function getBusBodyPose(): Readonly<{ x: number; z: number; yaw: number }> {
  refreshRenderPose();
  return renderPose;
}

/** Frame step: the bus's pose from the timeline at the synced time (the argument is kept for callers; the pose needs no easing). */
export function stepTransitRender(_deltaSeconds?: number): void {
  refreshRenderPose();
}

export function getTransitRenderPose(): Readonly<{ x: number; z: number; yaw: number }> {
  refreshRenderPose();
  return renderPose;
}

/**
 * The ride HUD's second line. Review r2: it said "빨간불" whenever the bus waited, also under a green; the bus now waits
 * only on amber or red (transit.ts tripTimeline), and the line names the light the snapshot carries.
 */
export function rideStatusText(
  snapshot: { waiting?: boolean; signal?: string; blocked?: boolean; status?: string } | null,
  departsInWords?: string,
): string {
  // still at the stop with its doors open (review 2026-11-15: it said "노선 운행 중" through the 3 boarding minutes)
  if (snapshot?.status === "boarding" || snapshot?.status === "atStop") {
    return departsInWords ? `출발 대기 중 · ${departsInWords} 뒤 출발` : "출발 대기 중";
  }
  if (snapshot?.blocked) return "앞에 사람이 있어 잠시 멈췄어요";
  if (!snapshot?.waiting) return "노선 운행 중";
  if (snapshot.signal === "amber") return "황색불 · 신호 대기 중";
  if (snapshot.signal === "green") return "초록불 · 곧 출발해요";
  return "빨간불 · 신호 대기 중";
}
