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
  BUILDER_FONT_TEXT,
  ENTRY_ART,
  FIGURE_BELOW_FEET,
  FIGURE_HALF_WIDTH_PER_HEIGHT,
  FIGURE_TOP,
  NONE_LABELS,
  PREVIEW_CAMERA,
  PREVIEW_ROTATE_MS,
  PREVIEW_ROTATE_STEP,
  PREVIEW_SPIN_MS,
  RANDOM_ICON,
  RANDOM_TEXT,
  SHEET_OPEN,
  SHEET_REST,
  VOICE_OPTIONS,
  arrowIndex,
  colorLabel,
  entryArtFor,
  partChips,
  presetWorn,
  previewFrameY,
  showSwatches,
  slotPickedLabel,
  stageLayout,
  swatchInk,
  tweenYaw,
  type StageLayout,
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

  it("keeps the builder copy (Task 7b adds the new screen's words) and the preview camera", () => {
    expect(BUILDER_COPY).toEqual({
      title: "캐릭터 조립실",
      presets: "추천 캐릭터",
      presetsHint: "누르면 한 번에 갈아입어요",
      random: "🎲 랜덤",
      voice: "목소리",
      voiceHint: "채팅을 읽어 줄 목소리",
      dragHint: "끌어서 돌려 보세요",
      loading: "캐릭터를 불러오는 중…",
      failed: "미리보기를 불러오지 못했어요. 그래도 입장할 수 있어요.",
      nickname: "닉네임",
      nicknamePlaceholder: "이름을 지어 주세요 (2~12자)",
      rotateLeft: "왼쪽으로 돌리기",
      rotateRight: "오른쪽으로 돌리기",
      sheetOpen: "꾸미기 창 크게 보기",
      sheetClose: "꾸미기 창 작게 보기",
      admin: "관리자이신가요?",
      adminCode: "관리자 코드",
      adminPlaceholder: "강사 전용",
      submit: "입장하기",
      submitting: "입장 중…",
    });
    expect([RANDOM_ICON, RANDOM_TEXT]).toEqual(["🎲", "랜덤"]);
    expect(PREVIEW_CAMERA).toEqual({ fov: 30, distance: 6.3, eyeY: 1.8, targetY: 1.3 });
  });

  it("collects every Jua word: title, tabs, presets, voices, buttons, hints — not the part names, never 🎲", () => {
    const words = BUILDER_FONT_TEXT.split(" ");
    for (const slot of CHARACTER_SLOTS) expect(BUILDER_FONT_TEXT).toContain(CHARACTER_MANIFEST.slotLabels[slot]);
    // Part cards use the bold body font (as in the concept): their 61 names would push Jua past 25 KB.
    expect(BUILDER_FONT_TEXT).not.toContain("고양이 귀 머리띠");
    expect(BUILDER_FONT_TEXT).not.toContain("망원경");
    for (const preset of APPEARANCE_PRESETS) expect(words).toContain(preset.label);
    for (const option of VOICE_OPTIONS) expect(BUILDER_FONT_TEXT).toContain(option.label);
    for (const copy of ["캐릭터 조립실", "추천 캐릭터", "랜덤", "목소리", "끌어서", "캐릭터를 불러오는 중…", "닉네임", "관리자이신가요?", "관리자 코드", "입장하기", "입장 중…", "피부색"]) {
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

describe("builderOptions — the camera's view of the stage (Task 7b)", () => {
  it("puts the feet 87.7 % down the canvas whatever the angle, and higher points above them", () => {
    expect(previewFrameY(0)).toBeCloseTo(0.877, 3);
    expect(previewFrameY(PREVIEW_CAMERA.targetY)).toBeCloseTo(0.5, 10);
    expect(previewFrameY(2.19)).toBeLessThan(previewFrameY(1));
    const tip = previewFrameY(FIGURE_TOP.height, FIGURE_TOP.toward);
    expect(tip).toBeGreaterThan(0);
    expect(tip).toBeLessThan(previewFrameY(FIGURE_TOP.height)); // leaning toward the camera reads higher
  });

  it("picks the wide art when the screen is at least as wide as it is tall", () => {
    expect(entryArtFor(1280, 800)).toBe("desktop");
    expect(entryArtFor(800, 800)).toBe("desktop");
    expect(entryArtFor(820, 1180)).toBe("phone");
    expect(ENTRY_ART.desktop).toMatchObject({ width: 1600, height: 900, podiumX: 0.5, podiumY: 0.701 });
    expect(ENTRY_ART.phone).toMatchObject({ width: 720, height: 1280, podiumX: 0.5, podiumY: 0.437 });
    expect(SHEET_REST).toBe(0.47);
    expect(SHEET_OPEN).toBe(0.88);
  });
});

describe("builderOptions — stageLayout (Task 7b: the figure stands on the podium)", () => {
  const BRIEF: [number, number, StageLayout["mode"], StageLayout["art"]][] = [
    [1280, 800, "wide", "desktop"],
    [1440, 900, "wide", "desktop"],
    [1920, 1080, "wide", "desktop"],
    [1024, 768, "wide", "desktop"],
    [820, 1180, "side", "phone"],
    [390, 844, "phone", "phone"],
    [375, 812, "phone", "phone"],
    [360, 740, "phone", "phone"],
    [320, 568, "phone", "phone"],
  ];
  const EXTRA: [number, number, StageLayout["mode"], StageLayout["art"]][] = [
    [844, 390, "side", "desktop"],
    [568, 320, "side", "desktop"],
    [2560, 1080, "wide", "desktop"],
    [1920, 800, "wide", "desktop"],
    [1000, 600, "wide", "desktop"],
    [1024, 1366, "wide", "phone"],
    [600, 960, "side", "phone"],
  ];
  const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  it.each([...BRIEF, ...EXTRA])("%i×%i → %s layout, %s art, feet on the podium top", (w, h, mode, art) => {
    const L = stageLayout(w, h);
    expect(L.mode).toBe(mode);
    expect(L.art).toBe(art);
    const spec = ENTRY_ART[art];
    // The podium top centre in the drawn picture…
    const podiumX = L.bg.x + spec.podiumX * L.bg.width;
    const podiumY = L.bg.y + spec.podiumY * L.bg.height;
    // …and where the camera draws the feet inside the canvas box.
    const feetX = L.canvas.x + L.canvas.width / 2;
    const feetY = L.canvas.y + previewFrameY(0) * L.canvas.height;
    const halfThickness = (spec.podiumThickness * L.scale) / 2;
    expect(Math.abs(feetY - podiumY)).toBeLessThanOrEqual(Math.min(0.5, halfThickness));
    expect(Math.abs(feetX - podiumX)).toBeLessThanOrEqual(0.5);
    expect(L.feet).toEqual({ x: expect.closeTo(podiumX, 6), y: expect.closeTo(podiumY, 6) });
    expect(L.podium.thickness / 2).toBeCloseTo(halfThickness, 6);
  });

  it.each([...BRIEF, ...EXTRA])("%i×%i: the wizard hat tip, the figure's sides and the name row all fit", (w, h) => {
    const L = stageLayout(w, h);
    const tipY = L.canvas.y + previewFrameY(FIGURE_TOP.height, FIGURE_TOP.toward) * L.canvas.height;
    expect(tipY).toBeGreaterThanOrEqual(L.canvas.y); // not clipped by the canvas…
    expect(tipY).toBeGreaterThanOrEqual(L.topBar); // …nor under the top bar
    if (!L.hint.centered) expect(tipY).toBeGreaterThanOrEqual(L.hint.y + L.hint.height); // …nor beside the top-left hint pill
    const half = L.canvas.height * FIGURE_HALF_WIDTH_PER_HEIGHT;
    expect(L.feet.x - half).toBeGreaterThanOrEqual(L.stage.x); // no panel or sheet covers the figure
    expect(L.feet.x + half).toBeLessThanOrEqual(L.stage.x + L.stage.width);
    expect(L.canvas.height).toBeGreaterThan(150);
    // The background covers the stage.
    expect(L.bg.x).toBeLessThanOrEqual(L.stage.x + 0.5);
    expect(L.bg.x + L.bg.width).toBeGreaterThanOrEqual(L.stage.x + L.stage.width - 0.5);
    expect(L.bg.y).toBeLessThanOrEqual(0.5);
    expect(L.bg.y + L.bg.height).toBeGreaterThanOrEqual(h - 0.5);
    // Name row: under the feet, inside the stage, above the 입장 button / the sheet.
    const row = L.nameRow;
    const rowWidth = row.plateWidth + 2 * (row.button + row.gap);
    expect(row.plateWidth).toBeGreaterThanOrEqual(180);
    expect(rowWidth).toBeLessThanOrEqual(L.stage.width);
    // The shoes' toes come down in front of the feet point: the hint and the name row keep clear of them.
    const toes = L.feet.y + FIGURE_BELOW_FEET * L.canvas.height;
    expect(row.y).toBeGreaterThanOrEqual(toes);
    if (L.hint.centered) expect(L.hint.y).toBeGreaterThanOrEqual(toes);
    const rowBox = { x: L.feet.x - rowWidth / 2, y: row.y, width: rowWidth, height: row.height };
    expect(rowBox.x).toBeGreaterThanOrEqual(L.stage.x);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(L.stage.y + L.stage.height);
    if (L.cta) {
      expect(L.cta.y + L.cta.height).toBeLessThanOrEqual(h);
      expect(L.cta.x).toBeGreaterThanOrEqual(L.stage.x);
      expect(L.cta.width).toBeGreaterThanOrEqual(240);
      expect(L.cta.height).toBeGreaterThanOrEqual(56);
      expect(overlaps(rowBox, L.cta)).toBe(false);
      const hintBox = { x: L.hint.x - 100, y: L.hint.y, width: 200, height: L.hint.height };
      expect(overlaps(hintBox, rowBox)).toBe(false);
    }
  });

  it("matches the concept at 1280×800: podium at y 561, 400 px panels, a 380×70 입장 button", () => {
    const L = stageLayout(1280, 800);
    expect(L.feet.y).toBeCloseTo(560.8, 1);
    expect(L.panelWidth).toBe(400);
    expect(L.stage).toEqual({ x: 424, y: 0, width: 432, height: 800 });
    expect(L.cta).toEqual({ x: 450, y: 704, width: 380, height: 70 });
    expect(L.nameRow.plateWidth).toBe(284);
    expect(L.sheet).toBeNull();
  });

  it("gives phones a bottom sheet resting at 47 % and opening to 88 % of the height", () => {
    const L = stageLayout(390, 844);
    expect(L.sheet).toEqual({ width: 390, rest: 397, open: 743 });
    expect(L.stage).toEqual({ x: 0, y: 0, width: 390, height: 844 - 397 });
    expect(L.cta).toBeNull();
    expect(stageLayout(320, 568).compactBar).toBe(true);
    expect(stageLayout(375, 812).compactBar).toBe(false);
    expect(stageLayout(820, 1180).sheet).toEqual({ width: 360, rest: 1180, open: 1180 });
  });
});
