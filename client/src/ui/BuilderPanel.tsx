// 조립실 패널(설계 4장·5.3): 추천 캐릭터 8개 + 🎲 랜덤, 슬롯 탭 7개, 지금 탭의 부품 칩과 색 견본, 목소리.
// 외형을 직접 들고 있지 않고 onChange로 새 외형만 올린다(EntryScreen이 상태와 저장을 맡는다).

import { useRef, useState } from "react";
import {
  APPEARANCE_PRESETS,
  SLOT_COLOR_FIELD,
  applyPreset,
  paletteFor,
  randomAppearance,
  withPart,
  type Appearance,
} from "@caysonverse/shared/appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS, type CharacterSlot } from "@caysonverse/shared/characterManifest";
import { BUILDER_COPY, VOICE_OPTIONS, colorLabel, partChips, presetWorn, showSwatches, swatchInk } from "./builderOptions";

/** "🎲 랜덤" → 주사위와 글자를 따로 꾸밀 수 있게 나눈다(합친 글자는 그대로 "🎲 랜덤"). */
const [RANDOM_ICON, RANDOM_TEXT] = BUILDER_COPY.random.split(" ");

export function BuilderPanel({
  appearance,
  onChange,
}: {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
}) {
  const [slot, setSlot] = useState<CharacterSlot>(CHARACTER_SLOTS[0]);
  const tabRefs = useRef<Partial<Record<CharacterSlot, HTMLButtonElement | null>>>({});

  const colorField = SLOT_COLOR_FIELD[slot];
  const palette = paletteFor(colorField);

  /** 탭 목록의 화살표·Home·End(WAI-ARIA 탭 패턴): 고르고 그 탭으로 초점을 옮긴다. */
  function onTabKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const at = CHARACTER_SLOTS.indexOf(slot);
    const last = CHARACTER_SLOTS.length - 1;
    let next = -1;
    if (e.key === "ArrowRight") next = at === last ? 0 : at + 1;
    else if (e.key === "ArrowLeft") next = at === 0 ? last : at - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next < 0) return;
    e.preventDefault();
    const target = CHARACTER_SLOTS[next];
    setSlot(target);
    tabRefs.current[target]?.focus();
  }

  return (
    <div className="cv-builder-panel">
      <div className="cv-builder-group">
        <div className="cv-builder-group-head">
          <span className="cv-label" id="cv-presets-label">
            {BUILDER_COPY.presets}
          </span>
          {/* 🎲는 이름 줄에 둔다: 휴대폰에서 프리셋 줄이 옆으로 스크롤되어도 늘 보인다. */}
          <button
            type="button"
            className="cv-random"
            onClick={() => onChange({ ...randomAppearance(Math.random), voice: appearance.voice })}
          >
            <span className="cv-random-icon" aria-hidden="true">
              {RANDOM_ICON}
            </span>{" "}
            <span className="cv-random-text">{RANDOM_TEXT}</span>
          </button>
        </div>
        <div className="cv-presets" role="group" aria-labelledby="cv-presets-label">
          {APPEARANCE_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.id}
              className="cv-preset"
              aria-pressed={presetWorn(appearance, preset)}
              onClick={() => onChange(applyPreset(appearance, preset))}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cv-slot-tabs" role="tablist" aria-label="꾸밀 곳" onKeyDown={onTabKey}>
        {CHARACTER_SLOTS.map((s) => (
          <button
            type="button"
            key={s}
            role="tab"
            id={`cv-slot-tab-${s}`}
            ref={(el) => {
              tabRefs.current[s] = el;
            }}
            className="cv-slot-tab"
            aria-selected={s === slot}
            aria-controls="cv-slot-panel"
            tabIndex={s === slot ? 0 : -1}
            onClick={() => setSlot(s)}
          >
            {CHARACTER_MANIFEST.slotLabels[s]}
          </button>
        ))}
      </div>

      <div className="cv-slot-panel" role="tabpanel" id="cv-slot-panel" aria-labelledby={`cv-slot-tab-${slot}`}>
        <div className="cv-chips">
          {partChips(slot).map((chip) => (
            <button
              type="button"
              key={chip.index}
              className="cv-chip"
              aria-pressed={appearance[slot] === chip.index}
              onClick={() => onChange(withPart(appearance, slot, chip.index))}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {showSwatches(appearance, slot) && (
          <div className="cv-builder-group">
            <span className="cv-label" id="cv-colors-label">
              {colorLabel(slot)}
            </span>
            <div className="cv-builder-swatches" role="group" aria-labelledby="cv-colors-label">
              {palette.map((color, index) => (
                <button
                  type="button"
                  key={color.hex}
                  className="cv-swatch"
                  style={{ background: color.hex, color: swatchInk(color.hex) }}
                  aria-label={color.label}
                  title={color.label}
                  aria-pressed={appearance[colorField] === index}
                  onClick={() => onChange({ ...appearance, [colorField]: index })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="cv-builder-group">
        <span className="cv-label" id="cv-voice-label">
          {BUILDER_COPY.voice}
        </span>
        <div className="cv-voice-options" role="radiogroup" aria-labelledby="cv-voice-label">
          {VOICE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.index}
              role="radio"
              className="cv-voice-option"
              aria-checked={appearance.voice === option.index}
              onClick={() => onChange({ ...appearance, voice: option.index })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
