import type { Client } from "colyseus";
import { Player, WorldState } from "@caysonverse/shared/schema";
import { PATCH_RATE_MS, ROLE_STUDENT, VILLAGE_MAX_CLIENTS } from "@caysonverse/shared/constants";
import { APPEARANCE_FIELDS } from "@caysonverse/shared/appearance";
import type { MapGeometry } from "@caysonverse/shared/school/geometry";
import { VillageMsg } from "@caysonverse/shared/village/messages";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { PlayerRoom, baseTracking, spawnInDisk, type Tracking } from "./PlayerRoom";
import { validateJoinOptions } from "./joinValidation";
import { RateWindow } from "./rateLimit";
import { DOOR_RATE, useDoor } from "./villageDoor";

/** Per-client bookkeeping (not part of synced state): the base's, plus the door-use cap. */
interface VillageTracking extends Tracking {
  /** Sliding-window rate cap for door uses (1 per second). */
  doorRate: RateWindow;
}

/**
 * 케이슨 마을: the open countryside village, a room on the shared `PlayerRoom` base.
 *
 * The base owns Move, Chat, Emoji, Jump and Typing, their caps, the "*" catch-all and the reconnection
 * lifecycle (the default 20 s window). This room supplies the village map (`villageGeometry`: the village
 * and the memorial hall's interior in ONE coordinate space), the spawn, and what only the village has:
 *  - join: `{ nickname, appearance }`, validated like the world's (no admin code, no kick, no seats);
 *  - `VillageMsg.UseDoor`: the memorial hall's door is a validated teleport (see `handleUseDoor`);
 *  - the hall is a quiet place (`isQuiet`): Emoji and Jump are dropped there, chat still goes through.
 *
 * Topology — NOT a singleton like the world: the room is not pre-created, clients `joinOrCreate` it, and
 * `maxClients` (VILLAGE_MAX_CLIENTS = 30) makes Colyseus lock a full room, so the next visitor lands in
 * a new room (a shard). `autoDispose` stays on: an empty shard goes away (a ghost waiting out its
 * reconnection window keeps its seat reserved, so the shard stays until the window ends).
 *
 * Rejection policy is the base's: an invalid player message is DROPPED silently, never partially applied.
 */
export class VillageRoom extends PlayerRoom<WorldState, VillageTracking> {
  maxClients = VILLAGE_MAX_CLIENTS;
  patchRate = PATCH_RATE_MS;
  autoDispose = true;
  // WorldState (players + the announcement banner): the client's Banner reads the same fields in every
  // room. Nothing sets the announcement here (no admin), so it stays empty.
  state = new WorldState();

  onCreate(): void {
    // Move, Chat, Emoji, Jump, Typing (+ the "*" catch-all for stray types).
    this.registerPlayerMessages();
    this.onMessage(VillageMsg.UseDoor, (client) => {
      this.handleUseDoor(client);
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
    // Appearance: all 15 fields, written once here and never again.
    for (const field of APPEARANCE_FIELDS) player[field] = result.appearance[field];
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = VILLAGE_LAYOUT.spawn.yaw; // facing the fountain
    player.connected = true;
    player.role = ROLE_STUDENT; // the village has no admin
    player.area = "village";
    this.seatPlayer(client, player); // state + tracking (createTracking below)
  }

  /** The village map: the open village plus the memorial hall's sealed interior. */
  protected geometry(): MapGeometry {
    return villageGeometry;
  }

  /** On the fountain plaza, within the layout's jitter of the spawn point, clamped into the bounds. */
  protected spawnPosition(): { x: number; z: number } {
    const { spawn } = VILLAGE_LAYOUT;
    return spawnInDisk(spawn.x, spawn.z, spawn.jitter, this.geometry());
  }

  /** The base bookkeeping plus the door-use cap. */
  protected createTracking(now: number): VillageTracking {
    return { ...baseTracking(now), doorRate: new RateWindow(DOOR_RATE.count, DOOR_RATE.windowMs) };
  }

  /** The memorial hall is quiet: no emoji, no jumping there (chat and walking are fine). */
  protected isQuiet(player: Player): boolean {
    return player.area === "hall";
  }

  /**
   * Door pipeline (binding order): sender must have a seat → the pure rule `useDoor` decides from the
   * player's AUTHORITATIVE area and position (the payload is never read: a client cannot name a place or
   * claim to stand at the door); no door within reach → SILENT drop → per-client rate cap (1 per second;
   * checked after the distance so a press made too early does not use up the slot) → teleport.
   *
   * The teleport writes the new position, facing and area straight into state, so the speed check never
   * sees a jump, and resets the move-clock baseline (the same anti-teleport pattern as sitting and the
   * maze portal): the next Move is measured from the new spot, and a Move that still names the old spot
   * is hundreds of metres away and dropped. Server-authoritative: the client sees its new place when the
   * state syncs (its existing large-correction snap applies it).
   */
  private handleUseDoor(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    const track = this.tracking.get(client.sessionId);
    if (!player || !track) return; // no seat yet / already left → drop

    const arrival = useDoor(player.area, player.x, player.z);
    if (arrival === null) return; // no door within reach → silent drop

    const now = this.now();
    if (!track.doorRate.tryAccept(now)) return; // flood → silent drop

    player.x = arrival.x;
    player.z = arrival.z;
    player.yaw = arrival.yaw;
    player.area = arrival.area;
    track.lastAcceptedAt = now;
  }
}
