import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import config from "@colyseus/tools";
import { VILLAGE_ROOM } from "@caysonverse/shared/constants";
import { VillageMsg, VillageServerMsg, type FishingResultPayload, type FishingStatePayload } from "@caysonverse/shared/village/messages";
import { FISHING, FISHING_SPOTS } from "@caysonverse/shared/village/fishing";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { rooms, type VillageRoom } from "./index";

const PORT = 2576;
const JOIN = { nickname: "낚시꾼", appearance: DEFAULT_APPEARANCE };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Visitor {
  sessionId: string;
  send(type: string, payload?: unknown): void;
  onMessage(type: string, callback: (payload: unknown) => void): () => void;
}

function waitForMessage<T>(client: Visitor, type: string, match: (payload: T) => boolean, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`no ${type} message`));
    }, timeoutMs);
    const off = client.onMessage(type, (payload) => {
      if (!match(payload as T)) return;
      clearTimeout(timer);
      off();
      resolve(payload as T);
    });
  });
}

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(config({ rooms }), PORT);
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  await colyseus.cleanup();
});

async function visitor() {
  const room = await colyseus.createRoom<VillageRoom>(VILLAGE_ROOM);
  const client = await colyseus.connectTo(room, JOIN);
  const player = room.state.players.get(client.sessionId)!;
  const clock = { t: Date.now() };
  (room as unknown as { now: () => number }).now = () => clock.t;
  return { room, client, player, clock };
}

function sendAndWait(client: Visitor, type: string, payload: unknown, event: string): Promise<FishingResultPayload> {
  const message = waitForMessage<FishingResultPayload>(client, VillageServerMsg.FishingResult, (item) => item.event === event);
  client.send(type, payload);
  return message;
}

describe("VillageRoom fishing authority", () => {
  it("rents at the kiosk, casts at the pond, reports a submerged bobber, and catches on the pull", async () => {
    const { room, client, player, clock } = await visitor();
    player.x = FISHING_SPOTS.rental.x;
    player.z = FISHING_SPOTS.rental.z;
    const rented = waitForMessage<FishingStatePayload>(client, VillageServerMsg.FishingState, (item) => item.rodRented && item.phase === "ready");
    client.send(VillageMsg.FishingRentRod, {});
    expect((await rented).rodRented).toBe(true);

    player.x = FISHING_SPOTS.pond.x;
    player.z = FISHING_SPOTS.pond.z;
    clock.t += FISHING.actionCooldownMs + 1;
    const cast = await sendAndWait(client, VillageMsg.FishingCast, {}, "cast");
    expect(cast.phase).toBe("waiting");

    const serverState = (room as unknown as { fishing: Map<string, { biteAt: number | null }> }).fishing.get(client.sessionId)!;
    clock.t = serverState.biteAt! + 1;
    const biteMessage = waitForMessage<FishingResultPayload>(client, VillageServerMsg.FishingResult, (item) => item.event === "bite");
    (room as unknown as { tickFishingSessions: () => void }).tickFishingSessions();
    expect((await biteMessage).phase).toBe("submerged");

    const caught = await sendAndWait(client, VillageMsg.FishingReel, {}, "caught");
    expect(caught.catch?.lengthCm).toBeGreaterThan(0);
    expect(caught.phase).toBe("ready");
  });

  it("misses when the player waits past the bobber window and does not reveal a catch", async () => {
    const { room, client, player, clock } = await visitor();
    player.x = FISHING_SPOTS.rental.x;
    player.z = FISHING_SPOTS.rental.z;
    client.send(VillageMsg.FishingRentRod, {});
    await sleep(25);
    player.x = FISHING_SPOTS.pond.x;
    player.z = FISHING_SPOTS.pond.z;
    clock.t += FISHING.actionCooldownMs + 1;
    await sendAndWait(client, VillageMsg.FishingCast, {}, "cast");
    const serverState = (room as unknown as { fishing: Map<string, { biteAt: number | null }> }).fishing.get(client.sessionId)!;
    clock.t = serverState.biteAt! + FISHING.biteWindowMs + 1;
    const missed = waitForMessage<FishingResultPayload>(client, VillageServerMsg.FishingResult, (item) => item.event === "missed");
    (room as unknown as { tickFishingSessions: () => void }).tickFishingSessions();
    const result = await missed;
    expect(result.lastResult).toBe("missed");
    expect(result.catch).toBeNull();
  });

  it("rejects a rental request away from the kiosk and keeps the session rodless", async () => {
    const { client } = await visitor();
    const rejected = waitForMessage<{ reason: string }>(client, VillageServerMsg.FishingRejected, () => true);
    client.send(VillageMsg.FishingRentRod, {});
    expect((await rejected).reason).toBe("not_near_rental");
  });
});
