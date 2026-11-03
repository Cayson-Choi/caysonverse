// 조립실 패널(설계 4장·5.3, Task 7b 배치): 추천 캐릭터 8개 + 🎲 랜덤, 슬롯 탭 7개, 지금 탭의 부품 카드와 색 견본.
// 외형을 직접 들고 있지 않고 onChange로 새 외형만 올린다(EntryScreen이 상태와 저장을 맡는다).
//
// 목소리 고르기는 없다(발주자 2026-11-03: 채팅을 읽어 주지 않는다). 외형의 voice 값은 그대로 들고 다니되 아무도 쓰지 않는다.
//
// DOM 순서는 휴대폰에서 보이는 순서다: 추천 캐릭터(🎲 먼저) → 탭 → 색 → 부품 카드.
// 넓은 화면: CSS grid로 왼쪽 유리 패널(추천 캐릭터)과 오른쪽 유리 패널(세로 아이콘 탭 레일·부품 카드·색)에 놓는다
// (부품 카드가 색보다 위에 보이는 것만 DOM과 다르다). 휴대폰: 아래 시트 하나(손잡이로 펼치기, 안에서 스크롤).
// 클래스·role·aria·글자 노드는 Task 7 그대로이고(E2E가 이것으로 찾는다), 감싸는 요소와 장식(그림·아이콘)만 더했다.

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import {
  APPEARANCE_PRESETS,
  SLOT_COLOR_FIELD,
  SLOT_OPTIONS,
  applyPreset,
  paletteFor,
  randomAppearance,
  withPart,
  type Appearance,
} from "@caysonverse/shared/appearance";
import { CHARACTER_MANIFEST, CHARACTER_SLOTS, type CharacterSlot } from "@caysonverse/shared/characterManifest";
import {
  BUILDER_COPY,
  RANDOM_ICON,
  RANDOM_TEXT,
  arrowIndex,
  colorLabel,
  partChips,
  presetWorn,
  showSwatches,
  slotPickedLabel,
  swatchInk,
} from "./builderOptions";
import { chipThumbHex, chipThumbKey, presetThumbKey, thumbJobs, thumbStore } from "./builderThumbs";
import { BuilderIcon, SLOT_ICONS } from "./BuilderIcons";

/** 그림 하나(캐시에 들어오면 그때 나타난다). 없거나 실패하면 아무것도 그리지 않는다(빈 타일 + 이름). */
function ThumbImg({ thumbKey }: { thumbKey: string | null }) {
  const url = useSyncExternalStore(
    thumbStore.cache.subscribe,
    () => (thumbKey === null ? null : (thumbStore.cache.get(thumbKey) ?? null)),
    () => null, // no server snapshot of a canvas-drawn picture (also lets the panel render to static markup in tests)
  );
  return url ? <img className="cv-thumb" src={url} alt="" draggable={false} /> : null;
}

/** 손잡이 끌기: 이만큼 움직이기 전에는 톡(열고 닫기)으로 본다. */
const GRAB_TAP_PX = 6;

export function BuilderPanel({
  appearance,
  onChange,
  onPresetApplied,
  scrollerRef,
  sheet,
  orientation = "horizontal",
}: {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
  /** 프리셋·🎲을 눌렀을 때(미리보기 인형이 한 바퀴 돈다). */
  onPresetApplied?: () => void;
  /** 시트 안의 스크롤 상자(미리보기에서 세로로 끌면 이것이 스크롤된다). */
  scrollerRef?: RefObject<HTMLDivElement | null>;
  /** 아래 시트의 쉴 때·펼친 높이(px). 시트가 아닌 배치면 null. */
  sheet?: { rest: number; open: number } | null;
  /** 탭 목록의 방향: 넓은 화면의 세로 레일(↑/↓)이나 휴대폰·옆 시트의 가로 막대(←/→). */
  orientation?: "horizontal" | "vertical";
}) {
  const [slot, setSlot] = useState<CharacterSlot>(CHARACTER_SLOTS[0]);
  const [open, setOpen] = useState(false);
  const [rolls, setRolls] = useState(0);
  const tabRefs = useRef<Partial<Record<CharacterSlot, HTMLButtonElement | null>>>({});
  const tabListRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<{ id: number; y: number; base: number; moved: boolean } | null>(null);
  /** 끌기로 끝난 누름 뒤에 오는 click은 열고 닫기로 치지 않는다. */
  const skipClickRef = useRef(false);

  const colorField = SLOT_COLOR_FIELD[slot];
  const palette = paletteFor(colorField);
  const swatches = showSwatches(appearance, slot);

  // 그림 일감: 지금 탭 → 프리셋 → 다른 탭. 미리보기 Canvas 안의 그리는 쪽이 프레임마다 2장씩 가져간다.
  useEffect(() => {
    thumbStore.want(thumbJobs(appearance, slot));
  }, [appearance, slot]);
  useEffect(() => () => thumbStore.want([]), []);

  // 아주 좁은 시트(7개 × 44 px가 안 들어가는 가로 휴대폰)에서는 탭 막대가 가로로 스크롤된다: 고른 탭이 보이게
  // 막대만 민다(페이지·시트는 건드리지 않는다). 조립실의 9가지 확인 화면에서는 7개가 모두 들어간다.
  useLayoutEffect(() => {
    const list = tabListRef.current;
    const tab = tabRefs.current[slot];
    if (!list || !tab || list.scrollWidth <= list.clientWidth) return;
    const left = tab.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft) list.scrollLeft = left - 8;
    else if (left + tab.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = left + tab.offsetWidth - list.clientWidth + 8;
  }, [slot]);

  /** 탭 목록의 화살표·Home·End(WAI-ARIA 탭 패턴): 고르고 그 탭으로 초점을 옮긴다. */
  function onTabKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = arrowIndex(e.key, CHARACTER_SLOTS.indexOf(slot), CHARACTER_SLOTS.length, orientation);
    if (next < 0) return;
    e.preventDefault();
    const target = CHARACTER_SLOTS[next];
    setSlot(target);
    tabRefs.current[target]?.focus();
  }

  // ── 아래 시트 손잡이: 톡(또는 Enter·Space) = 열고 닫기, 끌기 = 손가락을 따라가다 가까운 쪽으로 붙는다.
  //    높이는 늘 펼친 높이이고 쉴 때는 그만큼 아래로 밀어 둔다(transform만 움직인다, builder.css). ──
  const shift = sheet ? Math.max(0, sheet.open - sheet.rest) : 0;
  function onGrabDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (!sheet || (e.pointerType === "mouse" && e.button !== 0)) return;
    grabRef.current = { id: e.pointerId, y: e.clientY, base: open ? 0 : shift, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onGrabMove(e: React.PointerEvent<HTMLButtonElement>) {
    const grab = grabRef.current;
    const panel = panelRef.current;
    if (!grab || grab.id !== e.pointerId || !panel) return;
    const dy = e.clientY - grab.y;
    if (!grab.moved && Math.abs(dy) < GRAB_TAP_PX) return;
    grab.moved = true;
    panel.classList.add("is-dragging");
    panel.style.transform = `translateY(${Math.min(shift, Math.max(0, grab.base + dy))}px)`;
  }
  function onGrabEnd(e: React.PointerEvent<HTMLButtonElement>) {
    const grab = grabRef.current;
    if (!grab || grab.id !== e.pointerId) return;
    grabRef.current = null;
    if (!grab.moved) return; // 톡: 뒤따르는 click이 연다/닫는다
    skipClickRef.current = true;
    const panel = panelRef.current;
    if (panel) {
      panel.classList.remove("is-dragging");
      panel.style.transform = "";
    }
    setOpen(Math.min(shift, Math.max(0, grab.base + (e.clientY - grab.y))) < shift / 2);
  }
  return (
    <div ref={panelRef} className="cv-builder-panel" data-sheet={sheet ? (open ? "open" : "rest") : undefined}>
      <button
        type="button"
        className="cv-sheet-grabber"
        aria-expanded={open}
        aria-label={open ? BUILDER_COPY.sheetClose : BUILDER_COPY.sheetOpen}
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabEnd}
        onPointerCancel={onGrabEnd}
        onClick={() => {
          if (skipClickRef.current) skipClickRef.current = false;
          else setOpen((v) => !v);
        }}
      >
        <span className="cv-sheet-grabber-bar" aria-hidden="true" />
      </button>

      {/* DOM 순서 = 휴대폰에서 보이는 순서(추천 캐릭터 → 탭 → 색 → 부품 카드). 넓은 화면은 grid로 두 패널에 놓는다. */}
      <div className="cv-sheet-body" ref={scrollerRef}>
        <div className="cv-builder-group cv-presets-group">
          <div className="cv-builder-group-head">
            <span className="cv-label" id="cv-presets-label">
              {BUILDER_COPY.presets}
            </span>
            <span className="cv-sub">{BUILDER_COPY.presetsHint}</span>
          </div>
          <div className="cv-presets" role="group" aria-labelledby="cv-presets-label">
            <button
              type="button"
              className="cv-random"
              onClick={() => {
                setRolls((n) => n + 1);
                onChange({ ...randomAppearance(Math.random), voice: appearance.voice });
                onPresetApplied?.();
              }}
            >
              <span className="cv-random-icon" aria-hidden="true" data-roll={rolls === 0 ? undefined : rolls % 2}>
                {RANDOM_ICON}
              </span>{" "}
              <span className="cv-random-text">{RANDOM_TEXT}</span>
            </button>
            {APPEARANCE_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className="cv-preset"
                aria-pressed={presetWorn(appearance, preset)}
                onClick={() => {
                  onChange(applyPreset(appearance, preset));
                  onPresetApplied?.();
                }}
              >
                <span className="cv-preset-portrait" aria-hidden="true">
                  <ThumbImg thumbKey={presetThumbKey(preset.id)} />
                </span>
                <span className="cv-preset-name">{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div
          className="cv-slot-tabs"
          role="tablist"
          aria-label="꾸밀 곳"
          aria-orientation={orientation}
          onKeyDown={onTabKey}
          ref={tabListRef}
        >
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
              data-len={labelLength(CHARACTER_MANIFEST.slotLabels[s])}
              aria-selected={s === slot}
              aria-controls="cv-slot-panel"
              tabIndex={s === slot ? 0 : -1}
              onClick={() => setSlot(s)}
            >
              <BuilderIcon name={SLOT_ICONS[s]} />
              <span className="cv-slot-tab-label">{CHARACTER_MANIFEST.slotLabels[s]}</span>
            </button>
          ))}
        </div>

        <div className="cv-slot-panel" role="tabpanel" id="cv-slot-panel" aria-labelledby={`cv-slot-tab-${slot}`}>
          {/* 탭 이름·고른 것은 그림 글자(CSS content)로만 보인다: 탭·칩 글자와 겹쳐 getByText가 둘을 찾지 않게. */}
          <div
            className="cv-slot-head"
            aria-hidden="true"
            data-slot={CHARACTER_MANIFEST.slotLabels[slot]}
            data-picked={slotPickedLabel(appearance, slot)}
          />
          {swatches && (
            // 탭마다 다시 마운트해 견본이 새로 나타난다(페이드).
            <div key={slot} className="cv-builder-group cv-swatch-group">
              <div className="cv-swatch-head">
                <span className="cv-label" id="cv-colors-label">
                  {colorLabel(slot)}
                </span>
                <span className="cv-swatch-name" aria-hidden="true" data-name={palette[appearance[colorField]]?.label ?? ""} />
              </div>
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
          <div className="cv-chips">
            {partChips(slot).map((chip, n) => {
              const pressed = appearance[slot] === chip.index;
              const part = SLOT_OPTIONS[slot][chip.index];
              const hex = chipThumbHex(appearance, slot, chip.index);
              return (
                <button
                  type="button"
                  key={`${slot}:${chip.index}`}
                  className="cv-chip"
                  aria-pressed={pressed}
                  style={{ "--i": n } as React.CSSProperties}
                  onClick={() => onChange(withPart(appearance, slot, chip.index))}
                >
                  <span className="cv-chip-thumb" aria-hidden="true">
                    {part == null || hex === null ? (
                      <BuilderIcon name="none" />
                    ) : (
                      <ThumbImg thumbKey={chipThumbKey(slot, part, hex)} />
                    )}
                  </span>
                  <span className="cv-chip-label">{chip.label}</span>
                  {pressed && (
                    <span className="cv-check" aria-hidden="true">
                      <BuilderIcon name="check" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 탭 글자 길이 묶음: 휴대폰에서 고른 탭에 아이콘까지 들어가는지, 글자를 줄일지 CSS(@container)가 이 길이로 정한다. */
function labelLength(label: string): "s" | "m" | "l" {
  return label.length <= 2 ? "s" : label.length <= 4 ? "m" : "l";
}
