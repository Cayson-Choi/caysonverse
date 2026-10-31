/**
 * Player settings (controls-ux Task 15) — the pure part: the shape, the defaults, the
 * validation of whatever came out of localStorage, and the little maths the touch
 * buttons use. No React, no zustand, no globals (a storage is passed in), so every rule
 * here is unit-tested without a browser.
 *
 * Why every field is validated one by one: the stored blob outlives the code that wrote
 * it (an older build, a hand-edited value, a different type). One bad field must not
 * throw the player's other choices away, and nothing out of range may ever reach the
 * camera or the CSS — so each field is either kept (clamped / snapped) or replaced by
 * its default.
 */

import type { NametagMode } from "./nametagSelect";

export type ButtonSize = "small" | "medium" | "large";

export interface Settings {
  /** Size of the touch buttons (jump, action, emoji, 💬 and the top rows; never under 48 px). */
  buttonSize: ButtonSize;
  /** Mirror the touch layout: the stick on the right half, look-drag and the buttons on the left. */
  leftHanded: boolean;
  /** Multiplier on the look-drag speed (SENSITIVITY.min .. max, in `step`s). */
  lookSensitivity: number;
  /** Whose name tags are drawn (nametagSelect). */
  nametagMode: NametagMode;
  /** Also draw the local player's own tag. */
  showOwnNametag: boolean;
  /** The first-visit guide has been seen (coachStore saves it when the guide ends; a restart leaves it). */
  coachDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  buttonSize: "medium",
  leftHanded: false,
  lookSensitivity: 1,
  nametagMode: "nearby",
  showOwnNametag: false,
  coachDone: false,
};

/** The look-sensitivity slider: 0.5x .. 2x in quarter steps. */
export const SENSITIVITY = { min: 0.5, max: 2, step: 0.25 } as const;

/** The scale each button size applies to a button's base size (`--cv-btn-scale`). */
export const BUTTON_SCALE: Record<ButtonSize, number> = {
  small: 0.85,
  medium: 1,
  large: 1.25,
};

/** Smallest touch target (px) — global constraint. */
export const MIN_TOUCH_PX = 48;
/** Smallest gap (px) between two touch buttons — global constraint. */
export const MIN_GAP_PX = 8;

/** localStorage key. The `v1` is the schema version of the stored blob. */
export const SETTINGS_STORAGE_KEY = "cv-settings-v1";

/** `<html>` class while left-handed play is on (for CSS; the touch HUD itself reads the store, see game/hud.ts). */
export const LEFT_HANDED_CLASS = "cv-left-handed";
/** `<html>` custom property holding the current BUTTON_SCALE (the same scale buttonPx() applies). */
export const BTN_SCALE_VAR = "--cv-btn-scale";

const BUTTON_SIZES: readonly ButtonSize[] = ["small", "medium", "large"];
const NAMETAG_MODES: readonly NametagMode[] = ["all", "nearby", "off"];

/** A button's size in px for the chosen setting: `base x scale`, rounded, never under MIN_TOUCH_PX. */
export function buttonPx(basePx: number, size: ButtonSize): number {
  return Math.max(MIN_TOUCH_PX, Math.round(basePx * BUTTON_SCALE[size]));
}

/** Clamp to the slider's range and snap to its step; a non-number is the default. */
function sensitivityOf(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_SETTINGS.lookSensitivity;
  const { min, max, step } = SENSITIVITY;
  const clamped = Math.min(max, Math.max(min, v));
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

function booleanOf(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Settings from any value: each known field is validated on its own (numbers clamped
 * and snapped to the step, enums and booleans checked), anything wrong is that field's
 * default, unknown keys are dropped. A non-object is all defaults.
 */
export function normalizeSettings(value: unknown): Settings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_SETTINGS };
  }
  const v = value as Record<string, unknown>;
  const size = v.buttonSize;
  const mode = v.nametagMode;
  return {
    buttonSize: BUTTON_SIZES.includes(size as ButtonSize)
      ? (size as ButtonSize)
      : DEFAULT_SETTINGS.buttonSize,
    leftHanded: booleanOf(v.leftHanded, DEFAULT_SETTINGS.leftHanded),
    lookSensitivity: sensitivityOf(v.lookSensitivity),
    nametagMode: NAMETAG_MODES.includes(mode as NametagMode)
      ? (mode as NametagMode)
      : DEFAULT_SETTINGS.nametagMode,
    showOwnNametag: booleanOf(v.showOwnNametag, DEFAULT_SETTINGS.showOwnNametag),
    coachDone: booleanOf(v.coachDone, DEFAULT_SETTINGS.coachDone),
  };
}

/** Settings from the raw stored string: `null`, broken JSON and non-objects are all defaults. */
export function parseSettings(raw: string | null): Settings {
  if (raw === null) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** The slice of `Storage` the settings use — lets tests pass a fake (or a blocked one). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The browser's localStorage, or null when the platform hides it (private mode, blocked site data). */
function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Read the saved settings; blocked or empty storage is the defaults, never an error. */
export function loadSettings(storage: StorageLike | null = browserStorage()): Settings {
  try {
    return parseSettings(storage ? storage.getItem(SETTINGS_STORAGE_KEY) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Save the settings; a blocked storage just means the choice lasts for this visit only. */
export function saveSettings(
  settings: Settings,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked or full — the settings still apply for this session.
  }
}

/** The bits of `<html>` the settings write to — lets a test pass a plain object. */
export interface RootLike {
  classList: { toggle(name: string, force?: boolean): unknown };
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): unknown };
}

/** Put the layout-affecting settings on `<html>`: the left-handed class and `--cv-btn-scale`. */
export function applySettingsToRoot(settings: Settings, root: RootLike): void {
  root.classList.toggle(LEFT_HANDED_CLASS, settings.leftHanded);
  root.style.setProperty(BTN_SCALE_VAR, String(BUTTON_SCALE[settings.buttonSize]));
}

/** Undo `applySettingsToRoot` (the world went away; the entry screen has no use for them). */
export function clearSettingsFromRoot(root: RootLike): void {
  root.classList.toggle(LEFT_HANDED_CLASS, false);
  root.style.removeProperty(BTN_SCALE_VAR);
}
