import { create } from "zustand";
import { loadSettings, normalizeSettings, saveSettings, type Settings } from "../game/settings";

/**
 * The player's settings (button size, left-handed layout, look sensitivity, name tag
 * mode, own name tag, guide seen). Discrete UI state, so zustand is fine (nothing here
 * is per-frame data). Persisted to localStorage under "cv-settings-v1" like the TTS
 * mute is (soundStore); every storage access is try/catch'd inside settings.ts, so a
 * blocked storage (private mode) just means the choices last for this visit.
 *
 * Per-frame code (CameraRig's drag, the tap handler) reads `getState().settings` at
 * event time rather than subscribing, so it can never be a render behind.
 */
interface SettingsStore {
  settings: Settings;
  /** Merge a patch, validate every field again (a bad value falls back to its default), then save. */
  update: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: loadSettings(),
  update: (patch) => {
    const settings = normalizeSettings({ ...get().settings, ...patch });
    saveSettings(settings);
    set({ settings });
  },
}));
