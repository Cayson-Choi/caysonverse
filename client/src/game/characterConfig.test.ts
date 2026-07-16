import { describe, it, expect } from "vitest";
import { CHARACTER_COUNT } from "@caysonverse/shared/constants";
import { CHARACTERS, HIDEABLE_NODES, crownLocalScale, CROWN_BASE_SCALE } from "./constants";

// The character preset table is the single source of truth the avatar assembly
// reads (data-driven — no per-character branches). These guard its integrity so a
// bad edit (missing royal, dangling hideNode name, crown on a non-royal) is caught
// by a fast unit test rather than a broken avatar in the browser.
describe("CHARACTERS table integrity", () => {
  it("has exactly CHARACTER_COUNT (8) entries", () => {
    expect(CHARACTERS).toHaveLength(CHARACTER_COUNT);
    expect(CHARACTER_COUNT).toBe(8);
  });

  it("keeps the original 4 presets (0..3) unchanged", () => {
    expect(CHARACTERS.slice(0, 4).map((c) => c.id)).toEqual([
      "knight",
      "barbarian",
      "mage",
      "rogue",
    ]);
    expect(CHARACTERS.slice(0, 4).map((c) => c.label)).toEqual([
      "기사",
      "바바리안",
      "마법사",
      "도적",
    ]);
    // The base four are plain bodies: no hidden nodes, no crown.
    for (const preset of CHARACTERS.slice(0, 4)) {
      expect(preset.hideNodes).toBeUndefined();
      expect(preset.crown).toBeUndefined();
    }
  });

  it("adds the four Korean royals (4..7) with the exact labels", () => {
    expect(CHARACTERS.slice(4).map((c) => c.label)).toEqual(["왕", "왕비", "공주", "왕자"]);
  });

  it("composes each royal from an existing body GLB (no new downloads)", () => {
    const bodyModels = new Set(CHARACTERS.slice(0, 4).map((c) => c.model));
    for (const royal of CHARACTERS.slice(4)) {
      expect(bodyModels.has(royal.model)).toBe(true);
    }
  });

  it("gives every royal a crown and no non-royal one", () => {
    for (let i = 0; i < CHARACTERS.length; i++) {
      if (i >= 4) expect(CHARACTERS[i].crown).toBeDefined();
      else expect(CHARACTERS[i].crown).toBeUndefined();
    }
  });

  it("only ever hides nodes that exist in the models (static allowlist)", () => {
    for (const preset of CHARACTERS) {
      for (const node of preset.hideNodes ?? []) {
        expect(HIDEABLE_NODES).toContain(node);
      }
    }
  });

  it("every model path is a public /models/*.glb", () => {
    for (const preset of CHARACTERS) {
      expect(preset.model).toMatch(/^\/models\/[a-z]+\.glb$/);
    }
  });

  // ── v2 Task 13: royals are UNARMED, fixed-palette variants. ──

  it("marks each royal with its own id on the crown config (palette key)", () => {
    for (const preset of CHARACTERS.slice(4)) {
      expect(preset.crown?.royal).toBe(preset.id);
    }
    // Base presets carry no royal marker (their tint path must stay untouched).
    for (const preset of CHARACTERS.slice(0, 4)) {
      expect(preset.crown?.royal).toBeUndefined();
    }
  });

  it("hides every weapon node of its body on each royal (unarmed royalty)", () => {
    // Weapon/prop node names per body GLB, measured by scripts/dump-uv-cells.mjs.
    const weapons: Record<string, string[]> = {
      "/models/knight.glb": [
        "1H_Sword",
        "2H_Sword",
        "1H_Sword_Offhand",
        "Badge_Shield",
        "Rectangle_Shield",
        "Round_Shield",
        "Spike_Shield",
      ],
      "/models/barbarian.glb": ["1H_Axe", "2H_Axe", "1H_Axe_Offhand", "Barbarian_Round_Shield"],
      "/models/mage.glb": ["1H_Wand", "2H_Staff", "Spellbook", "Spellbook_open"],
      "/models/rogue.glb": ["Knife", "Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Throwable"],
    };
    for (const royal of CHARACTERS.slice(4)) {
      for (const weapon of weapons[royal.model]) {
        expect(royal.hideNodes, `${royal.id} must hide ${weapon}`).toContain(weapon);
      }
    }
  });

  it("keeps every royal's built-in cape VISIBLE (repainted, not hidden)", () => {
    for (const royal of CHARACTERS.slice(4)) {
      for (const node of royal.hideNodes ?? []) {
        expect(node).not.toMatch(/_Cape$/);
      }
    }
  });
});

// The crown attach-time transform helper. Pure math (no THREE): given a crown
// config and the base fit-scale, returns the local [x, y, z] scale that shrinks
// the ~0.89 m raw crown onto a ~0.3 m head and (optionally) flattens its height
// axis for tiaras/circlets. The crown stands +Y up (its GLB bakes the +Z→+Y
// rotation), so `flatten` scales ONLY the Y component.
describe("crownLocalScale", () => {
  it("scales uniformly by base × scale when there is no flatten", () => {
    expect(crownLocalScale({ scale: 1 }, 0.36)).toEqual([0.36, 0.36, 0.36]);
    expect(crownLocalScale({ scale: 0.5 }, 0.36)).toEqual([0.18, 0.18, 0.18]);
  });

  it("flattens only the height (Y) axis, leaving width (X/Z) full", () => {
    expect(crownLocalScale({ scale: 1, flatten: 0.5 }, 0.36)).toEqual([0.36, 0.18, 0.36]);
    const [x, y, z] = crownLocalScale({ scale: 0.6, flatten: 0.35 }, 1);
    expect(x).toBeCloseTo(0.6, 10);
    expect(z).toBeCloseTo(0.6, 10);
    expect(y).toBeCloseTo(0.21, 10);
  });

  it("treats flatten === undefined as 1 (no flatten)", () => {
    const [x, y, z] = crownLocalScale({ scale: 0.8 }, CROWN_BASE_SCALE);
    expect(y).toBe(x);
    expect(y).toBe(z);
  });
});
