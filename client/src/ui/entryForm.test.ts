import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "@caysonverse/shared/appearance";
import { enterVillageDirectly, type VillageEntryDeps } from "./entryForm";

const LOOK = { ...DEFAULT_APPEARANCE };
type Call = [string, ...unknown[]];

// ─────────────────────────────── the village entry flow (fake app) ───────────────────────────────

function fakeVillageDeps(join: () => Promise<{ sessionId: string }> = () => Promise.resolve({ sessionId: "v-sid-1" })) {
  const calls: Call[] = [];
  const deps: VillageEntryDeps = {
    joinVillage: (p) => {
      calls.push(["joinVillage", p]);
      return join();
    },
    saveIdentity: (identity) => void calls.push(["saveIdentity", identity]),
    clearKicked: () => void calls.push(["clearKicked"]),
    enterVillage: (identity) => void calls.push(["enterVillage", identity]),
  };
  return { deps, calls, names: () => calls.map((c) => c[0]) };
}

describe("enterVillageDirectly — 입장하기 in the default mode", () => {
  it("remembers the look, clears a kick, joins the village and enters it — nothing else (no code, no sheet, no teacher)", async () => {
    const { deps, calls, names } = fakeVillageDeps();
    await enterVillageDirectly(deps, { nickname: "하늘별", appearance: LOOK });

    expect(names()).toEqual(["saveIdentity", "clearKicked", "joinVillage", "enterVillage"]);
    expect(calls[0][1]).toEqual({ nickname: "하늘별", appearance: LOOK });
    expect(calls[2][1]).toEqual({ nickname: "하늘별", appearance: LOOK }); // exactly the village's join options
    expect(calls[3][1]).toEqual({ nickname: "하늘별", appearance: LOOK, sessionId: "v-sid-1" });
    expect(calls[3][1]).not.toHaveProperty("classCode");
  });

  it("stays on the entry with the join's own words when the village refuses", async () => {
    const words = "연결에 실패했습니다. 잠시 후 다시 시도해주세요.";
    const { deps, names } = fakeVillageDeps(() => Promise.reject(new Error(words)));
    await expect(enterVillageDirectly(deps, { nickname: "하늘별", appearance: LOOK })).rejects.toThrow(words);
    expect(names()).toEqual(["saveIdentity", "clearKicked", "joinVillage"]);
    expect(names()).not.toContain("enterVillage");
  });
});
