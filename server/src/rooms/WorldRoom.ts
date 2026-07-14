import { Room, type Client } from "colyseus";
import { Player, WorldState } from "@caysonverse/shared/schema";
import { MessageType } from "@caysonverse/shared/messages";
import {
  MAX_CLIENTS,
  PATCH_RATE_MS,
  MOVE_MAX_MSGS_PER_SEC,
  SPAWN_POINT,
  SPAWN_JITTER,
  WORLD_BOUNDS,
  PLAYER_RADIUS,
} from "@caysonverse/shared/constants";
import { validateMove } from "./movement";
import { validateJoinOptions } from "./joinValidation";
import { RateWindow } from "./rateLimit";

/** Per-client bookkeeping for move validation (not part of synced state). */
interface MoveTracking {
  /** ms timestamp of this client's last accepted move (seeded at join). */
  lastAcceptedAt: number;
  /** Sliding-window rate cap for move messages. */
  rate: RateWindow;
}

/**
 * The authoritative world room.
 *
 * Thin by design: it wires up Colyseus lifecycle, owns timing (clock + rate
 * window), and applies the result of the pure validators
 * (`validateJoinOptions`, `validateMove`). All movement/nickname rules live in
 * those modules so they stay unit-testable.
 *
 * Rejection policy (from the design, binding): invalid move messages are
 * DROPPED silently — never partially applied, never a disconnect. Invalid join
 * options reject the join by throwing (the client receives the Korean error).
 */
export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = MAX_CLIENTS;
  patchRate = PATCH_RATE_MS;
  state = new WorldState();

  private readonly tracking = new Map<string, MoveTracking>();

  onCreate(): void {
    this.onMessage(MessageType.Move, (client, payload) => {
      this.handleMove(client, payload);
    });
  }

  onJoin(client: Client, options: unknown): void {
    const result = validateJoinOptions(options);
    if ("error" in result) {
      // Reject the join; Colyseus forwards this message to the client.
      throw new Error(result.error);
    }

    const spawn = this.spawnPosition();
    const player = new Player();
    player.nickname = result.nickname;
    player.character = result.character;
    player.tint = result.tint;
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = 0;
    player.connected = true;

    this.state.players.set(client.sessionId, player);
    this.tracking.set(client.sessionId, {
      lastAcceptedAt: this.now(),
      rate: new RateWindow(MOVE_MAX_MSGS_PER_SEC),
    });
  }

  onLeave(client: Client): void {
    // Reconnection (allowReconnection/onDrop) is Task 11 — just remove for now.
    this.state.players.delete(client.sessionId);
    this.tracking.delete(client.sessionId);
  }

  private handleMove(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    const now = this.now();

    // Step 2: per-client rate cap (drop floods silently). Kept ahead of the
    // pure validator so malformed floods are throttled too; a dropped message
    // never consumes a slot, so legal traffic is unaffected.
    if (!track.rate.tryAccept(now)) return;

    // Steps 1,3,4,5: shape + speed + bounds + yaw, decided purely.
    const elapsed = now - track.lastAcceptedAt;
    const next = validateMove({ x: player.x, z: player.z }, payload, elapsed);
    if (next === null) return; // invalid → drop whole message

    // Step 6: apply.
    player.x = next.x;
    player.z = next.z;
    player.yaw = next.yaw;
    track.lastAcceptedAt = now;
  }

  /** Wall-clock time in ms. Isolated here so the pure validators never read it. */
  private now(): number {
    return Date.now();
  }

  /**
   * Spawn point plus uniform random jitter within `SPAWN_JITTER` radius, clamped
   * to WORLD_BOUNDS so joiners don't stack yet always land in-bounds.
   */
  private spawnPosition(): { x: number; z: number } {
    const radius = SPAWN_JITTER * Math.sqrt(Math.random()); // uniform over the disk
    const angle = Math.random() * Math.PI * 2;
    const x = SPAWN_POINT.x + radius * Math.cos(angle);
    const z = SPAWN_POINT.z + radius * Math.sin(angle);
    return {
      x: clamp(x, WORLD_BOUNDS.minX + PLAYER_RADIUS, WORLD_BOUNDS.maxX - PLAYER_RADIUS),
      z: clamp(z, WORLD_BOUNDS.minZ + PLAYER_RADIUS, WORLD_BOUNDS.maxZ - PLAYER_RADIUS),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
