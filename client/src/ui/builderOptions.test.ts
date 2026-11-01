import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  OPTIONAL_SLOTS,
  SKIN_PALETTE,
  SLOT_COLOR_FIELD,
  SLOT_OPTIONS,
  applyPreset,
  paletteFor,
  voiceGender,
} from "@caysonverse/shared/appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS } from "@caysonverse/shared/characterManifest";
import {
  BUILDER_COPY,
  NONE_LABELS,
  PREVIEW_CAMERA,
  VOICE_OPTIONS,
  colorLabel,
  partChips,
  presetWorn,
  showSwatches,
  swatchInk,
} from "./builderOptions";

describe("builderOptions — slot chips", () => {
  it("hair chips start with 민머리 and use the manifest names", () => {
    expect(partChips("hair")[0]).toEqual({ index: 0, label: "민머리" });
    expect(partChips("hair")).toHaveLength(6);
    expect(partChips("hat").find((c) => c.label === "왕관")?.index).toBe(SLOT_OPTIONS.hat.indexOf("crown"));
  });

  it("face has 6 chips and no 없음; its color is 피부색 with the 5 skin swatches", () => {
    expect(partChips("face")).toHaveLength(6);
    expect(partChips("face").map((c) => c.label)).not.toContain("없음");
    expect(colorLabel("face")).toBe("피부색");
    expect(paletteFor(SLOT_COLOR_FIELD.face)).toBe(SKIN_PALETTE);
    expect(SKIN_PALETTE).toHaveLength(5);
  });

  it("gives every slot one chip per SLOT_OPTIONS entry, in order, named from the manifest", () => {
    for (const slot of CHARACTER_SLOTS) {
      const chips = partChips(slot);
      expect(chips.map((c) => c.index)).toEqual(SLOT_OPTIONS[slot].map((_, i) => i));
      chips.forEach((chip) => {
        const id = SLOT_OPTIONS[slot][chip.index];
        const labels: Record<string, string> = CHARACTER_MANIFEST.labels[slot];
        expect(chip.label).toBe(id === null ? NONE_LABELS[slot as keyof typeof NONE_LABELS] : labels[id]);
        expect(chip.label.length).toBeGreaterThan(0);
      });
    }
    expect(partChips("hat")[0]).toEqual({ index: 0, label: "없음" });
    expect(partChips("item")[0]).toEqual({ index: 0, label: "없음" });
    expect(Object.keys(NONE_LABELS).sort()).toEqual([...OPTIONAL_SLOTS].sort());
  });

  it("names every colour '색' except the face's 피부색", () => {
    for (const slot of CHARACTER_SLOTS) expect(colorLabel(slot)).toBe(slot === "face" ? "피부색" : "색");
  });
});

describe("builderOptions — swatches", () => {
  it("hides swatches for an empty optional slot", () =>
    expect(showSwatches({ ...DEFAULT_APPEARANCE, hat: 0 }, "hat")).toBe(false));

  it("shows swatches once the optional slot wears a part, and always for the face/top/bottom/shoes", () => {
    expect(showSwatches({ ...DEFAULT_APPEARANCE, hat: 1 }, "hat")).toBe(true);
    expect(showSwatches({ ...DEFAULT_APPEARANCE, item: 0 }, "item")).toBe(false);
    expect(showSwatches({ ...DEFAULT_APPEARANCE, hair: 0 }, "hair")).toBe(false);
    expect(showSwatches({ ...DEFAULT_APPEARANCE, hair: 1 }, "hair")).toBe(true);
    for (const slot of ["face", "top", "bottom", "shoes"] as const) {
      expect(showSwatches({ ...DEFAULT_APPEARANCE, [slot]: 0 }, slot)).toBe(true);
    }
  });
});

describe("builderOptions — presets and swatch ink", () => {
  it("marks a preset as worn whatever the skin and voice, until any of its parts or colours changes", () => {
    const knight = APPEARANCE_PRESETS.find((p) => p.id === "knight")!;
    const worn = { ...applyPreset(DEFAULT_APPEARANCE, knight), skin: 3, voice: 1 };
    expect(presetWorn(worn, knight)).toBe(true);
    expect(APPEARANCE_PRESETS.filter((p) => presetWorn(worn, p)).map((p) => p.id)).toEqual(["knight"]);
    expect(presetWorn({ ...worn, item: 0 }, knight)).toBe(false);
    expect(presetWorn({ ...worn, topColor: (worn.topColor + 1) % 12 }, knight)).toBe(false);
    expect(APPEARANCE_PRESETS.some((p) => presetWorn(DEFAULT_APPEARANCE, p))).toBe(false);
  });

  it("draws the selected-swatch check dark on light colours and white on dark ones", () => {
    const dark = "#1b1640";
    expect(swatchInk("#F7F7F2")).toBe(dark); // 흰색
    expect(swatchInk("#F6C445")).toBe(dark); // 노랑
    expect(swatchInk("#FFDCC2")).toBe(dark); // 피부색 1
    expect(swatchInk("#2D3A75")).toBe("#ffffff"); // 남색
    expect(swatchInk("#2B2420")).toBe("#ffffff"); // 검정 머리
    expect(swatchInk("#E53E3E")).toBe("#ffffff"); // 빨강
  });
});

describe("builderOptions — voice and copy", () => {
  it("voice options are 남자 목소리 / 여자 목소리 at 0 / 1", () => {
    expect(VOICE_OPTIONS).toEqual([
      { index: 0, label: "남자 목소리" },
      { index: 1, label: "여자 목소리" },
    ]);
    expect(voiceGender(VOICE_OPTIONS[0].index)).toBe("male");
    expect(voiceGender(VOICE_OPTIONS[1].index)).toBe("female");
  });

  it("keeps the builder copy and the preview camera (distance raised from 5.6 so the wizard hat fits)", () => {
    expect(BUILDER_COPY).toEqual({
      title: "캐릭터 조립실",
      presets: "추천 캐릭터",
      random: "🎲 랜덤",
      voice: "목소리",
      dragHint: "끌어서 돌려 보세요",
      loading: "캐릭터를 불러오는 중…",
    });
    expect(PREVIEW_CAMERA).toEqual({ fov: 30, distance: 6.3, eyeY: 1.8, targetY: 1.3 });
  });
});
