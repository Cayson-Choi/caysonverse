import { create } from "zustand";

/**
 * The village music as the menu's "소리" section sees it. The music controller itself lives in the village scene
 * (village/VillageMusic.tsx creates it); that component mirrors "is there music here, is it on" into this store and
 * applies the volume. Outside the village `available` is false and the menu hides the music rows.
 * The volume is the player's own scale on top of the music's area level (0.35 outside, 0.15 in the hall): 0..1, saved
 * in localStorage (try/catch), default 1 so nobody's music gets quieter by this change.
 */
const VOLUME_KEY = "cv-music-volume";

export const MUSIC_VOLUME = { min: 0, max: 1, step: 0.05, default: 1 } as const;

/** Whatever was stored (or typed) → a volume in [0, 1] in whole `step`s; junk → the default. */
export function normalizeMusicVolume(v: unknown): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return MUSIC_VOLUME.default;
  const clamped = Math.min(MUSIC_VOLUME.max, Math.max(MUSIC_VOLUME.min, n));
  return Math.round(clamped / MUSIC_VOLUME.step) * MUSIC_VOLUME.step;
}

/** "70%" for the slider's value. */
export function formatMusicVolume(v: number): string {
  return `${Math.round(normalizeMusicVolume(v) * 100)}%`;
}

function load(): number {
  try {
    return normalizeMusicVolume(localStorage.getItem(VOLUME_KEY));
  } catch {
    return MUSIC_VOLUME.default;
  }
}

interface MusicStore {
  /** The village music exists in this scene. */
  available: boolean;
  /** The music is switched on (the 배경음악 switch). */
  on: boolean;
  /** The player's music volume, 0..1. */
  volume: number;
  setAvailable: (available: boolean, on?: boolean) => void;
  setOn: (on: boolean) => void;
  setVolume: (v: number) => void;
}

export const useMusicStore = create<MusicStore>((set) => ({
  available: false,
  on: true,
  volume: load(),
  setAvailable: (available, on) => set((s) => ({ available, on: on ?? s.on })),
  setOn: (on) => set({ on }),
  setVolume: (v) => {
    const volume = normalizeMusicVolume(v);
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      // Storage blocked: the choice holds for this visit only.
    }
    set({ volume });
  },
}));
