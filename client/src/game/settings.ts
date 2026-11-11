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
import { BRIGHTNESS, type GraphicsSetting } from "./quality";

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
  /** Graphics quality of the school scenes: "auto" (touch → light), "high" (화려하게) or "low" (가볍게). */
  graphics: GraphicsSetting;
  /** The school scenes' exposure (BRIGHTNESS.min .. max, in steps). */
  brightness: number;
}

export const DEFAULT_SETTINGS: Settings = {
  buttonSize: "medium",
  leftHanded: false,
  lookSensitivity: 1,
  nametagMode: "nearby",
  showOwnNametag: true,
  coachDone: false,
  graphics: "auto",
  brightness: BRIGHTNESS.default,
};

/** The look-sensitivity slider: 0.5x .. 2x in quarter steps. */
export const SENSITIVITY = { min: 0.5, max: 2, step: 0.25 } as const;

/** The scale each button size applies to a button's base size (see `buttonPx`). */
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
/** One-time migration: the own name tag used to default to hidden. */
export const OWN_NAMETAG_MIGRATION_KEY = "cv-own-nametag-v2";

const BUTTON_SIZES: readonly ButtonSize[] = ["small", "medium", "large"];
const NAMETAG_MODES: readonly NametagMode[] = ["all", "nearby", "off"];
const GRAPHICS_SETTINGS: readonly GraphicsSetting[] = ["auto", "high", "low"];

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

/** Clamp to the brightness range and snap to its step (rounded, so 0.9 never comes back as 0.9000000000000001); a non-number is the default. */
function brightnessOf(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_SETTINGS.brightness;
  const { min, max, step } = BRIGHTNESS;
  const clamped = Math.min(max, Math.max(min, v));
  const snapped = Number((min + Math.round((clamped - min) / step) * step).toFixed(2));
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
  const graphics = v.graphics;
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
    graphics: GRAPHICS_SETTINGS.includes(graphics as GraphicsSetting)
      ? (graphics as GraphicsSetting)
      : DEFAULT_SETTINGS.graphics,
    brightness: brightnessOf(v.brightness),
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
  let settings: Settings;
  try {
    settings = parseSettings(storage ? storage.getItem(SETTINGS_STORAGE_KEY) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!storage) return settings;
  try {
    if (storage.getItem(OWN_NAMETAG_MIGRATION_KEY) === "1") return settings;
    const migrated = settings.showOwnNametag ? settings : { ...settings, showOwnNametag: true };
    if (!settings.showOwnNametag) saveSettings(migrated, storage);
    storage.setItem(OWN_NAMETAG_MIGRATION_KEY, "1");
    return migrated;
  } catch {
    return settings;
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
