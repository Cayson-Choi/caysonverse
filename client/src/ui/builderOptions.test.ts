import { describe, expect, it } from "vitest";
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  OPTIONAL_SLOTS,
  SKIN_PALETTE,
  SLOT_COLOR_FIELD,
  SLOT_OPTIONS,
  isRetiredPart,
  applyPreset,
  paletteFor,
} from "@caysonverse/shared/appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS } from "@caysonverse/shared/characterManifest";
import {
  BUILDER_COPY,
  BUILDER_FONT_TEXT,
  NONE_LABELS,
  PREVIEW_CAMERA,
  PREVIEW_LIGHTS,
  PREVIEW_ROTATE_MS,
  PREVIEW_ROTATE_STEP,
  PREVIEW_SPIN_MS,
  RANDOM_ICON,
  RANDOM_TEXT,
  THUMB_LIGHTS,
  THUMB_RIM_LIGHT,
  arrowIndex,
  colorLabel,
  partChips,
  presetWorn,
  showSwatches,
  slotPickedLabel,
  swatchInk,
  tweenYaw,
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

  it("gives every slot one chip per offered SLOT_OPTIONS entry (retired parts left out), in order, named from the manifest", () => {
    for (const slot of CHARACTER_SLOTS) {
      const chips = partChips(slot);
      expect(chips.map((c) => c.index)).toEqual(
        SLOT_OPTIONS[slot].map((_, i) => i).filter((i) => !isRetiredPart(slot, i)),
      );
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
  it("marks a preset as worn whatever the voice, until any of its parts, colours or the skin changes", () => {
    const knight = APPEARANCE_PRESETS.find((p) => p.id === "knight")!;
    const worn = { ...applyPreset({ ...DEFAULT_APPEARANCE, skin: 3 }, knight), voice: 1 };
    expect(worn.skin).toBe(DEFAULT_APPEARANCE.skin);
    expect(presetWorn(worn, knight)).toBe(true);
    expect(APPEARANCE_PRESETS.filter((p) => presetWorn(worn, p)).map((p) => p.id)).toEqual(["knight"]);
    expect(presetWorn({ ...worn, item: 0 }, knight)).toBe(false);
    expect(presetWorn({ ...worn, topColor: (worn.topColor + 1) % 12 }, knight)).toBe(false);
    expect(presetWorn({ ...worn, skin: 3 }, knight)).toBe(false);
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

describe("builderOptions — copy (no voice: chat is never read aloud, owner 2026-11-03)", () => {
  it("has no voice words in the copy or the Jua text", () => {
    expect(Object.keys(BUILDER_COPY)).not.toContain("voice");
    expect(Object.keys(BUILDER_COPY)).not.toContain("voiceHint");
    for (const word of ["목소리", "남자", "여자", "읽어"]) {
      expect(BUILDER_FONT_TEXT).not.toContain(word);
      expect(Object.values(BUILDER_COPY).join(" ")).not.toContain(word);
    }
  });

  it("keeps the builder copy (Task 7b adds the new screen's words) and the preview camera", () => {
    expect(BUILDER_COPY).toEqual({
      title: "캐릭터 조립실",
      presets: "추천 캐릭터",
      presetsHint: "누르면 한 번에 갈아입어요",
      random: "🎲 랜덤",
      dragHint: "끌어서 돌려 보세요",
      loading: "캐릭터를 불러오는 중…",
      // No promise that 입장 still works (final review Important 2): a failed model download blocks 입장 now.
      failed: "미리보기를 띄우지 못했어요. 새로고침(F5)해 보세요.",
      modelRetrying: "캐릭터를 불러오지 못해 다시 받아 오는 중이에요…",
      modelFailed: "캐릭터를 불러오지 못했어요. 인터넷 연결을 확인한 뒤 입장하기를 눌러 주세요.",
      modelRetry: "캐릭터를 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요",
      nickname: "닉네임",
      nicknamePlaceholder: "이름을 지어 주세요 (2~5자)",
      rotateLeft: "왼쪽으로 돌리기",
      rotateRight: "오른쪽으로 돌리기",
      sheetOpen: "꾸미기 창 크게 보기",
      sheetClose: "꾸미기 창 작게 보기",
      submit: "입장하기",
      submitting: "입장 중…",
    });
    expect([RANDOM_ICON, RANDOM_TEXT]).toEqual(["🎲", "랜덤"]);
    expect(PREVIEW_CAMERA).toEqual({ fov: 30, distance: 6.3, eyeY: 1.8, targetY: 1.3 });
  });

  it("collects every Jua word: title, tabs, presets, buttons, hints — not the part names, never 🎲", () => {
    const words = BUILDER_FONT_TEXT.split(" ");
    for (const slot of CHARACTER_SLOTS) expect(BUILDER_FONT_TEXT).toContain(CHARACTER_MANIFEST.slotLabels[slot]);
    // Part cards use the bold body font (as in the concept): their 61 names would push Jua past 25 KB.
    expect(BUILDER_FONT_TEXT).not.toContain("고양이 귀 머리띠");
    expect(BUILDER_FONT_TEXT).not.toContain("망원경");
    for (const preset of APPEARANCE_PRESETS) expect(words).toContain(preset.label);
    for (const copy of ["캐릭터 조립실", "추천 캐릭터", "랜덤", "끌어서", "캐릭터를 불러오는 중…", "닉네임", "입장하기", "입장 중…", "피부색"]) {
      expect(BUILDER_FONT_TEXT).toContain(copy);
    }
    expect(BUILDER_FONT_TEXT).not.toContain("🎲");
  });
});

describe("builderOptions — slot head and keys (Task 7b)", () => {
  it("names the picked part and its colour, or the part alone when the slot is empty", () => {
    const wizard = applyPreset(DEFAULT_APPEARANCE, APPEARANCE_PRESETS.find((p) => p.id === "wizard")!);
    expect(slotPickedLabel(wizard, "hat")).toBe("마법사 모자 · 보라");
    expect(slotPickedLabel(wizard, "face")).toBe("차분 · 피부색 1");
    expect(slotPickedLabel(DEFAULT_APPEARANCE, "hat")).toBe("없음");
    expect(slotPickedLabel(DEFAULT_APPEARANCE, "hair")).toBe("짧은 머리 · 진갈색");
  });

  it("moves along a row with the arrows (wrapping) and jumps with Home/End; other keys are ignored", () => {
    expect(arrowIndex("ArrowRight", 0, 7)).toBe(1);
    expect(arrowIndex("ArrowDown", 6, 7)).toBe(0);
    expect(arrowIndex("ArrowLeft", 0, 7)).toBe(6);
    expect(arrowIndex("ArrowUp", 3, 7)).toBe(2);
    expect(arrowIndex("Home", 4, 7)).toBe(0);
    expect(arrowIndex("End", 1, 2)).toBe(1);
    expect(arrowIndex("ArrowRight", 1, 2)).toBe(0);
    expect(arrowIndex("Enter", 1, 2)).toBe(-1);
    expect(arrowIndex("a", 1, 2)).toBe(-1);
  });

  it("a horizontal tab bar follows only ←/→ and a vertical rail only ↑/↓ (Home/End on both)", () => {
    expect(arrowIndex("ArrowRight", 0, 7, "horizontal")).toBe(1);
    expect(arrowIndex("ArrowLeft", 0, 7, "horizontal")).toBe(6);
    expect(arrowIndex("ArrowDown", 0, 7, "horizontal")).toBe(-1);
    expect(arrowIndex("ArrowDown", 0, 7, "vertical")).toBe(1);
    expect(arrowIndex("ArrowUp", 0, 7, "vertical")).toBe(6);
    expect(arrowIndex("ArrowRight", 0, 7, "vertical")).toBe(-1);
    expect(arrowIndex("End", 2, 7, "vertical")).toBe(6);
    expect(arrowIndex("Home", 2, 7, "horizontal")).toBe(0);
  });

  it("lights the preview and the card pictures with one rig; only the card rim light is its own", () => {
    expect(THUMB_LIGHTS.hemi).toBe(PREVIEW_LIGHTS.hemi);
    expect(THUMB_LIGHTS.sun).toBe(PREVIEW_LIGHTS.sun);
    expect(THUMB_LIGHTS.fill).toBe(PREVIEW_LIGHTS.fill);
    expect(THUMB_LIGHTS.rim).toBe(THUMB_RIM_LIGHT);
    expect(THUMB_RIM_LIGHT.position).toEqual(PREVIEW_LIGHTS.rim.position);
    expect(THUMB_RIM_LIGHT.intensity).toBeLessThan(PREVIEW_LIGHTS.rim.intensity);
  });

  it("eases a turn from → to and lands exactly on the target", () => {
    expect(tweenYaw(0, PREVIEW_ROTATE_STEP, 0)).toBe(0);
    expect(tweenYaw(0, PREVIEW_ROTATE_STEP, 1)).toBe(PREVIEW_ROTATE_STEP);
    expect(tweenYaw(0, PREVIEW_ROTATE_STEP, 1.7)).toBe(PREVIEW_ROTATE_STEP);
    expect(tweenYaw(1, 1 + 2 * Math.PI, 0.5)).toBeCloseTo(1 + Math.PI, 10);
    const a = tweenYaw(0, 1, 0.25);
    const b = tweenYaw(0, 1, 0.75);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.25); // slow start
    expect(b).toBeGreaterThan(0.75); // slow finish
    expect(PREVIEW_ROTATE_STEP).toBeCloseTo(Math.PI / 4, 12);
    expect([PREVIEW_ROTATE_MS, PREVIEW_SPIN_MS]).toEqual([200, 500]);
  });
});

describe("builderOptions — retired parts", () => {
  it("does not offer the overalls card", () => {
    const labels = partChips("bottom").map((c) => c.label);
    expect(labels).not.toContain("멜빵바지");
    expect(partChips("bottom").map((c) => c.index)).not.toContain(SLOT_OPTIONS.bottom.indexOf("overalls"));
  });
});
