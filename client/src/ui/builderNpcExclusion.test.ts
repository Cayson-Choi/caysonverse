import { describe, expect, it } from "vitest";
import { CHARACTER_SLOTS } from "@caysonverse/shared/characterManifest";
import { SLOT_OPTIONS } from "@caysonverse/shared/appearance";
import { NPC_LOOKS, NPC_PART_PREFIX } from "@caysonverse/shared/village/npcLooks";
import { partChips } from "./builderOptions";

// owner 2026-11-16: "저런 캐릭터는 화면 처음에 캐릭터를 고르고 옷을 고를때 없는 캐릭터면 좋겠지?" — the NPCs' own outfits never show
// in the character creator (its chips are SLOT_OPTIONS, labelled from the manifest).
describe("the character creator never offers an NPC's own part", () => {
  it("no chip of any slot is an NPC part", () => {
    const npcParts = Object.values(NPC_LOOKS).flatMap((l) => Object.values(l.parts).filter((id): id is string => id !== null && id.startsWith(NPC_PART_PREFIX)));
    expect(npcParts.length).toBeGreaterThan(0);
    for (const slot of CHARACTER_SLOTS) {
      for (const chip of partChips(slot)) {
        const id = SLOT_OPTIONS[slot][chip.index];
        expect(id === null || !id.startsWith(NPC_PART_PREFIX), `${slot} chip ${chip.label}`).toBe(true);
        expect(npcParts).not.toContain(id);
      }
    }
  });
});
