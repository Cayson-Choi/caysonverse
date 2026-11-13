import { useSyncExternalStore } from "react";
import { MessageType } from "@caysonverse/shared/messages";
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
let renderPose = { x: 34.1, z: -6.5, yaw: Math.PI }; // parked: heading north (-z)
let targetPose = { ...renderPose };
let hasPose = false;

function publish(next: TransitClientState): void {
  state = next;
  for (const listener of listeners) listener();
}

function setSnapshot(snapshot: BusStatePayload): void {
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
  targetPose = { x: 34.1, z: -6.5, yaw: Math.PI };
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

