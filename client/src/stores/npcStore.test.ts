import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NPC_GREETING, NPC_HISTORY_TURNS, NPC_INPUT_MAX, useNpcStore } from "./npcStore";
import { NPC_CLOSE_RADIUS, NPC_TALK_RADIUS, NPCS, nearestNpc } from "../game/npc";
import { NPC_SPOTS, OBSTACLES, PLAYER_RADIUS } from "@caysonverse/shared/worldMap";

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const lastBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(
    (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body as string,
  ) as { npc: string; messages: { role: string; content: string }[] };

beforeEach(() => {
  useNpcStore.setState({ activeNpc: null, sending: false, histories: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("npc placement (4 assistants — design 31 후속 + 33 solidity + 34 미로)", () => {
  it("stations four assistants with pairwise separation beyond both radii", () => {
    expect(NPCS).toHaveLength(4);
    for (let i = 0; i < NPCS.length; i++)
      for (let j = i + 1; j < NPCS.length; j++) {
        const a = NPCS[i].pos;
        const b = NPCS[j].pos;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(NPC_CLOSE_RADIUS * 2);
      }
  });

  it("each spot sits inside EXACTLY its own solid obstacle (design 33)", () => {
    for (const npc of NPCS) {
      const containing = OBSTACLES.filter(
        (o) =>
          npc.pos.x >= o.minX && npc.pos.x <= o.maxX && npc.pos.z >= o.minZ && npc.pos.z <= o.maxZ,
      );
      expect(containing).toHaveLength(1);
      expect(containing[0].maxX - containing[0].minX).toBeCloseTo(PLAYER_RADIUS * 2, 9);
    }
  });

  it("keeps a clear talk spot beside each assistant (front approach unblocked)", () => {
    // One radius-plus step in front of each NPC must be walkable floor.
    const fronts = {
      hall: { x: NPC_SPOTS.hall.x - 1.4, z: NPC_SPOTS.hall.z },
      lobby: { x: NPC_SPOTS.lobby.x + 1.4, z: NPC_SPOTS.lobby.z },
      gallery: { x: NPC_SPOTS.gallery.x - 1.4, z: NPC_SPOTS.gallery.z },
      maze: { x: NPC_SPOTS.maze.x, z: NPC_SPOTS.maze.z + 1.4 }, // 골 타일 쪽
    } as const;
    for (const npc of NPCS) {
      const p = fronts[npc.id];
      expect(Math.hypot(p.x - npc.pos.x, p.z - npc.pos.z)).toBeLessThanOrEqual(NPC_TALK_RADIUS);
      const blocked = OBSTACLES.some(
        (o) =>
          p.x >= o.minX - PLAYER_RADIUS &&
          p.x <= o.maxX + PLAYER_RADIUS &&
          p.z >= o.minZ - PLAYER_RADIUS &&
          p.z <= o.maxZ + PLAYER_RADIUS,
      );
      expect(blocked, `${npc.id} talk spot blocked`).toBe(false);
    }
  });

  it("nearestNpc picks the assistant in range and null elsewhere", () => {
    expect(nearestNpc(NPC_SPOTS.hall.x - 1, NPC_SPOTS.hall.z, NPC_TALK_RADIUS)?.id).toBe("hall");
    expect(nearestNpc(0, 0, NPC_TALK_RADIUS)).toBe(null);
  });
});

describe("useNpcStore (per-assistant conversations)", () => {
  it("greets once per assistant and keeps SEPARATE histories", () => {
    useNpcStore.getState().openPanel("hall");
    useNpcStore.getState().closePanel();
    useNpcStore.getState().openPanel("lobby");
    const s = useNpcStore.getState();
    expect(s.histories.hall).toEqual([{ role: "assistant", text: NPC_GREETING }]);
    expect(s.histories.lobby).toEqual([{ role: "assistant", text: NPC_GREETING }]);
    useNpcStore.getState().closePanel();
    useNpcStore.getState().openPanel("hall");
    expect(useNpcStore.getState().histories.hall).toHaveLength(1); // no duplicate greeting
  });

  it("send() posts the trimmed history WITH the active npc id and appends the reply", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { reply: "답변이에요" }));
    vi.stubGlobal("fetch", fetchMock);
    useNpcStore.getState().openPanel("gallery");
    await useNpcStore.getState().send("  일대기 설명해 줘  ");

    const body = lastBody(fetchMock);
    expect(body.npc).toBe("gallery");
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "일대기 설명해 줘" });
    const msgs = useNpcStore.getState().histories.gallery!;
    expect(msgs.at(-1)).toEqual({ role: "assistant", text: "답변이에요" });
    expect(useNpcStore.getState().sending).toBe(false);
  });

  it("caps the wire history at NPC_HISTORY_TURNS with the newest turns kept", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { reply: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    useNpcStore.setState({
      activeNpc: "hall",
      histories: {
        hall: Array.from({ length: 30 }, (_, i) => ({
          role: i % 2 ? ("assistant" as const) : ("user" as const),
          text: `m${i}`,
        })),
      },
    });
    await useNpcStore.getState().send("최신 질문");
    const body = lastBody(fetchMock);
    expect(body.messages).toHaveLength(NPC_HISTORY_TURNS);
    expect(body.messages.at(-1)!.content).toBe("최신 질문");
  });

  it("shows the server's Korean error line on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: "잠시 후 다시" })));
    useNpcStore.getState().openPanel("hall");
    await useNpcStore.getState().send("질문");
    expect(useNpcStore.getState().histories.hall!.at(-1)).toEqual({
      role: "assistant",
      text: "잠시 후 다시",
    });
  });

  it("falls back to a friendly line on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    useNpcStore.getState().openPanel("hall");
    await useNpcStore.getState().send("질문");
    const last = useNpcStore.getState().histories.hall!.at(-1)!;
    expect(last.role).toBe("assistant");
    expect(last.text).toContain("죄송해요");
  });

  it("ignores empty/panel-closed input and clips over-long input to NPC_INPUT_MAX", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { reply: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    await useNpcStore.getState().send("닫힌 상태"); // no active npc → ignored
    useNpcStore.getState().openPanel("hall");
    await useNpcStore.getState().send("   ");
    expect(fetchMock).not.toHaveBeenCalled();
    await useNpcStore.getState().send("가".repeat(NPC_INPUT_MAX + 50));
    expect([...lastBody(fetchMock).messages.at(-1)!.content]).toHaveLength(NPC_INPUT_MAX);
  });
});
