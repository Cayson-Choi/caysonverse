import { useEffect, useRef } from "react";
import { onHotkey } from "../game/hotkeys";
import { blurTextEntry, handleEscape, type FocusLike } from "../game/escape";
import { clearClickTarget } from "../game/clickMove";
import { acquireUiCapture, releaseUiCapture } from "../game/uiCapture";
import { SENSITIVITY, type ButtonSize } from "../game/settings";
import type { NametagMode } from "../game/nametagSelect";
import { useSettingsStore } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { useViewStore } from "../stores/viewStore";
import { FOCUSABLE_SELECTOR, tabWrapTarget } from "./focusTrap";
import "./menu.css";

interface MenuPanelProps {
  /** Toggle first-person / third-person (the same switch V and the zoom-through use). */
  onToggleView: () => void;
  /** Replay the first-visit guide from ① ("조작 안내 다시 보기"); the menu closes first. */
  onShowGuide: () => void;
}

const BUTTON_SIZE_OPTIONS: readonly { value: ButtonSize; label: string }[] = [
  { value: "small", label: "작게" },
  { value: "medium", label: "보통" },
  { value: "large", label: "크게" },
];

const NAMETAG_OPTIONS: readonly { value: NametagMode; label: string }[] = [
  { value: "all", label: "모두" },
  { value: "nearby", label: "가까운 사람만" },
  { value: "off", label: "끄기" },
];

/** "1배", "1.25배" — the slider's current value, without trailing zeros. */
function formatSensitivity(v: number): string {
  return `${Number(v.toFixed(2))}배`;
}

/** A button that never takes keyboard focus from a press (the pointer path only; Tab still reaches it). */
const noFocusOnPress = {
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
};

/** A row of mutually exclusive choices. */
function Segmented<T extends string>({
  labelledBy,
  value,
  options,
  onChange,
}: {
  labelledBy: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="cv-menu-seg" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={"cv-menu-seg-btn" + (o.value === value ? " is-on" : "")}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          {...noFocusOnPress}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off switch. */
function Switch({
  labelledBy,
  describedBy,
  on,
  disabled = false,
  onChange,
}: {
  labelledBy: string;
  describedBy?: string;
  on: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={"cv-menu-switch" + (on ? " is-on" : "")}
      onClick={() => onChange(!on)}
      {...noFocusOnPress}
    >
      <span className="cv-menu-switch-knob" aria-hidden="true" />
    </button>
  );
}

/**
 * The menu (controls-ux Tasks 15–16): Esc or the ☰ button (top right, HudTop) opens it, Esc
 * or "닫기" closes it. A centred card over a lightly dimmed world with the player's
 * settings, the view switch and the guide button. Every change applies at once and is
 * saved (settingsStore); nothing waits for a confirm.
 *
 * Esc comes from the shared hotkey table and is resolved in ONE place (handleEscape →
 * resolveEscape): this component only subscribes to it, so the 조교 dialogue, the roster
 * and the menu close in a fixed order and no other listener reacts to Esc.
 *
 * While open it owns the keyboard under its own capture owner ("menu", see uiCapture.ts):
 * WASD, Space, E and the other hotkeys do nothing behind the card, and nobody else
 * letting go (the 조교 dialogue closing, the chat input blurring) can free them. A
 * pending click-move is dropped, and a text field that still had focus (chat, the admin
 * announce box) is released first. Tab stays inside the card (a key handler wraps it, a
 * focusin guard pulls back any focus that lands outside), so focus can never walk into
 * the chat field behind it.
 */
export function MenuPanel({ onToggleView, onShowGuide }: MenuPanelProps) {
  const open = useUiStore((s) => s.menuOpen);
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const isFp = useViewStore((s) => s.isFp);
  const panelRef = useRef<HTMLDivElement>(null);
  // A press that began on the dimmed backdrop (not inside the card) — see the backdrop's click.
  const pressedBackdrop = useRef(false);

  // The one Esc subscriber. Mounted for the world's lifetime, open or not.
  useEffect(
    () =>
      onHotkey((action) => {
        if (action.type === "menu") handleEscape();
      }),
    [],
  );

  // Open: take the keyboard. The hold is released on close AND on unmount (a reconnect
  // remount or a kick while the menu is up fires no close).
  useEffect(() => {
    if (!open) return;
    // A focused chat / admin field would otherwise keep typing behind the card. Let go first.
    blurTextEntry(document.activeElement as FocusLike | null);
    clearClickTarget();
    acquireUiCapture("menu");
    panelRef.current?.focus({ preventScroll: true });
    // Safety net for the Tab trap: whatever moves focus outside the card (a click on a
    // HUD control behind it, a programmatic focus) is pulled back to the card.
    const onFocusIn = (e: FocusEvent) => {
      const card = panelRef.current;
      if (card && e.target instanceof Node && !card.contains(e.target)) {
        card.focus({ preventScroll: true });
      }
    };
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      releaseUiCapture("menu");
    };
  }, [open]);

  if (!open) return null;

  const close = () => useUiStore.getState().setMenuOpen(false);
  // "끄기" hides every tag, your own included: say so instead of leaving a switch that does nothing.
  const ownTagOff = settings.nametagMode === "off";

  return (
    <div
      className="cv-menu-backdrop"
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        // Only a press AND release on the backdrop closes: a slider drag that ends
        // outside the card also "clicks" the backdrop (their common ancestor).
        if (pressedBackdrop.current && e.target === e.currentTarget) close();
        pressedBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        className="cv-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cv-menu-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          // Tab trap: wrap at both ends so focus never leaves the card.
          if (e.key !== "Tab") return;
          const card = panelRef.current;
          if (!card) return;
          const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
          if (items.length === 0) {
            e.preventDefault();
            return;
          }
          const target = tabWrapTarget(
            items.length,
            items.indexOf(document.activeElement as HTMLElement),
            e.shiftKey,
          );
          if (target !== null) {
            e.preventDefault();
            items[target].focus();
          }
        }}
      >
        <h2 id="cv-menu-title" className="cv-menu-title">
          메뉴
        </h2>

        <section className="cv-menu-section" aria-labelledby="cv-menu-sec-settings">
          <h3 id="cv-menu-sec-settings" className="cv-menu-section-title">
            설정
          </h3>

          <div className="cv-menu-row">
            <span id="cv-menu-btn-size" className="cv-menu-label">
              버튼 크기
            </span>
            <Segmented
              labelledBy="cv-menu-btn-size"
              value={settings.buttonSize}
              options={BUTTON_SIZE_OPTIONS}
              onChange={(buttonSize) => update({ buttonSize })}
            />
          </div>

          <div className="cv-menu-row">
            <span id="cv-menu-left-handed" className="cv-menu-label">
              왼손잡이 모드
            </span>
            <Switch
              labelledBy="cv-menu-left-handed"
              on={settings.leftHanded}
              onChange={(leftHanded) => update({ leftHanded })}
            />
          </div>

          <div className="cv-menu-row">
            <label htmlFor="cv-menu-sensitivity" className="cv-menu-label">
              시점 감도
            </label>
            <div className="cv-menu-slider">
              <input
                id="cv-menu-sensitivity"
                type="range"
                min={SENSITIVITY.min}
                max={SENSITIVITY.max}
                step={SENSITIVITY.step}
                value={settings.lookSensitivity}
                aria-valuetext={formatSensitivity(settings.lookSensitivity)}
                onChange={(e) => update({ lookSensitivity: Number(e.target.value) })}
              />
              <span className="cv-menu-value" aria-hidden="true">
                {formatSensitivity(settings.lookSensitivity)}
              </span>
            </div>
          </div>

          <div className="cv-menu-row">
            <span id="cv-menu-nametags" className="cv-menu-label">
              이름표 보기
            </span>
            <Segmented
              labelledBy="cv-menu-nametags"
              value={settings.nametagMode}
              options={NAMETAG_OPTIONS}
              onChange={(nametagMode) => update({ nametagMode })}
            />
          </div>

          <div className="cv-menu-row">
            <span id="cv-menu-own-nametag" className="cv-menu-label">
              내 이름표 보기
            </span>
            <Switch
              labelledBy="cv-menu-own-nametag"
              describedBy={ownTagOff ? "cv-menu-own-nametag-note" : undefined}
              on={settings.showOwnNametag}
              disabled={ownTagOff}
              onChange={(showOwnNametag) => update({ showOwnNametag })}
            />
            {ownTagOff && (
              <p id="cv-menu-own-nametag-note" className="cv-menu-note">
                이름표 보기가 꺼져 있어요
              </p>
            )}
          </div>
        </section>

        <section className="cv-menu-section" aria-labelledby="cv-menu-sec-view">
          <h3 id="cv-menu-sec-view" className="cv-menu-section-title">
            보기
          </h3>
          <div className="cv-menu-row">
            <span id="cv-menu-first-person" className="cv-menu-label">
              1인칭으로 보기 (V)
            </span>
            <Switch labelledBy="cv-menu-first-person" on={isFp} onChange={() => onToggleView()} />
          </div>
        </section>

        <section className="cv-menu-section" aria-labelledby="cv-menu-sec-help">
          <h3 id="cv-menu-sec-help" className="cv-menu-section-title">
            도움말
          </h3>
          <button
            type="button"
            className="cv-menu-link"
            onClick={() => {
              close();
              onShowGuide();
            }}
            {...noFocusOnPress}
          >
            조작 안내 다시 보기
          </button>
        </section>

        <button type="button" className="cv-menu-close" onClick={close} {...noFocusOnPress}>
          닫기
        </button>
      </div>
    </div>
  );
}
