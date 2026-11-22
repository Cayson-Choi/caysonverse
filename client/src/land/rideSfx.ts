/**
 * The park rides' sound, placed. The four rides' mixes (wheelAudio / carouselAudio / dropTowerAudio / moonBoatAudio: the coaster has
 * its own, coasterAudio.ts) are built on the village's one AudioContext while the player is in 케이슨랜드, and this driver, ticking
 * every 100 ms, decides for each ride:
 *
 *   - the player rides it:           the full mix (RIDER_LEVEL), nothing filtered, the rider-only layers on;
 *   - the player stands near it:     a quieter version (SPECTATOR_PEAK at the ride's edge, falling smoothly to nothing at its range),
 *                                    dulled by the air with distance and panned toward the ride, without the wind and the scream;
 *   - the player is far:             nothing, and after a few seconds the nodes are torn down (no idle sources across the park).
 *
 * Everything obeys the menu's 소리 switch and the ride panel's mute; the carousel's tune also follows 배경음악 and 음악 크기. Sound
 * starts only once the context runs (a first gesture: see `armAudioResume`), like the village's other sounds.
 */
import { CAROUSEL_CENTER } from "@caysonverse/shared/land/carousel";
import { WHEEL_SITE } from "@caysonverse/shared/land/wheel";
import { DROP_SITE } from "@caysonverse/shared/land/dropTower";
import { MOON_BOAT_SITE } from "@caysonverse/shared/land/moonBoat";
import { RIDE } from "@caysonverse/shared/land/rides";
import { useSoundStore } from "../stores/soundStore";
import { useMusicStore } from "../stores/musicStore";
import { resumeVillageAudio, villageAudioContext } from "../village/villageAudio";
import { villageClock } from "../village/villageClock";
import { rideMuted } from "./coasterAudio";
import { selfRide } from "./coasterRide";
import { buildCarouselMix, carouselInput, type CarouselInput } from "./carouselAudio";
import { buildDropMix, dropInput, type DropInput } from "./dropTowerAudio";
import { buildMoonBoatMix, moonBoatInput, type MoonBoatInput } from "./moonBoatAudio";
import { buildWheelMix, wheelInput, type WheelInput } from "./wheelAudio";
import type { RideMix } from "./sfx/rideMix";
import { airCutoff, createSfxBus, createSpatial, distanceLevel, panFor, sfxListener, soundAllowed, type SfxBus, type Spatial } from "./sfx/sfxKit";

/** The level of the full (rider's) mix into the safety bus. */
export const RIDER_LEVEL = 1;
/** The level of a spectator's version at the ride's edge. */
export const SPECTATOR_PEAK = 0.45;
/** Seconds a ride stays built after it falls silent. */
export const RIDE_IDLE_STOP_S = 4;
const TICK_MS = 100;

export type SfxRideKey = "carousel" | "wheel" | "droptower" | "moonboat";

interface RideSite {
  key: SfxRideKey;
  id: number;
  x: number;
  z: number;
  /** full level within this many metres of the site's centre, nothing beyond `far` */
  near: number;
  far: number;
  /** a per-ride trim of the rider's level (tuned against the coaster's loudness by e2e/sfx-render.mjs) */
  trim: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build(ctx: BaseAudioContext, out: AudioNode): RideMix<any>;
  input(nowMs: number, rider: boolean, slot: number, music: number): unknown;
}

const SITES: readonly RideSite[] = [
  { key: "carousel", id: RIDE.carousel, x: CAROUSEL_CENTER.x, z: CAROUSEL_CENTER.z, near: 14, far: 52, trim: 1, build: buildCarouselMix, input: (t, r, _s, m) => carouselInput(t, r, m) },
  { key: "wheel", id: RIDE.wheel, x: WHEEL_SITE.x, z: WHEEL_SITE.z, near: 20, far: 62, trim: 0.75, build: buildWheelMix, input: (t, _r, s) => wheelInput(t, s) },
  { key: "droptower", id: RIDE.droptower, x: DROP_SITE.x, z: DROP_SITE.z, near: 10, far: 70, trim: 0.85, build: buildDropMix, input: (t, r) => dropInput(t, r) },
  { key: "moonboat", id: RIDE.moonboat, x: MOON_BOAT_SITE.x, z: MOON_BOAT_SITE.z, near: 12, far: 48, trim: 0.85, build: buildMoonBoatMix, input: (t, r) => moonBoatInput(t, r) },
];

export const RIDE_SFX_SITES = SITES.map((s) => ({ key: s.key, id: s.id, x: s.x, z: s.z, near: s.near, far: s.far, trim: s.trim }));

/** A spectator's level (0..1 of RIDER_LEVEL) `distanceM` from a ride whose full level reaches `near` and ends at `far`. */
export function spectatorLevel(distanceM: number, near: number, far: number): number {
  return SPECTATOR_PEAK * distanceLevel(distanceM, near, far, 2);
}

/** The level a ride's sound should have (pure; the unit test drives it): the rider's full mix, a spectator's distance curve, or nothing. */
export function rideLevel(riding: boolean, distanceM: number, near: number, far: number, allowed: boolean, trim = 1): number {
  if (!allowed) return 0;
  return riding ? RIDER_LEVEL * trim : spectatorLevel(distanceM, near, far) * trim;
}

/** The music's level from the menu: 0 when 배경음악 is off, else the 음악 크기 slider (0..1). */
export function menuMusicLevel(on: boolean, volume: number): number {
  return on ? Math.min(1, Math.max(0, volume)) : 0;
}

interface Slot {
  site: RideSite;
  mix: RideMix<unknown>;
  spatial: Spatial;
  idleFor: number;
}

let slots: Slot[] = [];
let bus: SfxBus | null = null;
let busCtx: BaseAudioContext | null = null;
let timer = 0;
let active = false;

/** Turn the park's ride sound on (the player entered 케이슨랜드) or off (left it): off tears every mix down. */
export function setRideSfxActive(on: boolean): void {
  if (on === active) return;
  active = on;
  if (on) {
    if (typeof window === "undefined") return;
    timer = window.setInterval(tick, TICK_MS);
  } else {
    window.clearInterval(timer);
    timer = 0;
    teardownAll();
  }
}

export function rideSfxActive(): boolean {
  return active;
}

function teardownAll(): void {
  const old = slots;
  const b = bus;
  slots = [];
  bus = null;
  busCtx = null;
  if (old.length === 0 && !b) return;
  const ctx = villageAudioContext();
  try {
    for (const s of old) s.spatial.set(ctx?.currentTime ?? 0, 0, 0, 800, 0.03);
  } catch {
    // a context in a bad state: the nodes go below
  }
  window.setTimeout(() => {
    for (const s of old) {
      s.mix.dispose();
      s.spatial.dispose();
    }
    b?.dispose();
  }, 250);
}

function dropSlot(s: Slot): void {
  slots = slots.filter((x) => x !== s);
  try {
    s.mix.dispose();
    s.spatial.dispose();
  } catch {
    // gone already
  }
}

let lastTick = typeof performance !== "undefined" ? performance.now() : 0;

function tick(): void {
  const ctx = villageAudioContext();
  const now = performance.now();
  const dt = Math.min(1, (now - lastTick) / 1000);
  lastTick = now;
  if (!ctx) return;
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  const allowed = soundAllowed(useSoundStore.getState().muted, rideMuted(), hidden);
  const ridingId = selfRide.slot >= 0 ? selfRide.ride : 0;
  const mus = useMusicStore.getState();
  const music = allowed ? menuMusicLevel(mus.on, mus.volume) : 0;
  const wall = villageClock.liveMs();
  const t = ctx.currentTime;
  for (const site of SITES) {
    const riding = ridingId === site.id;
    const d = sfxListener.valid ? Math.hypot(sfxListener.x - site.x, sfxListener.z - site.z) : Infinity;
    const level = rideLevel(riding, d, site.near, site.far, allowed, site.trim);
    let slot = slots.find((s) => s.site === site);
    if (level <= 0.002) {
      if (slot && !riding) {
        slot.spatial.set(t, 0, 0, 800, 0.2);
        slot.idleFor += dt;
        if (slot.idleFor > RIDE_IDLE_STOP_S) dropSlot(slot);
      }
      continue;
    }
    if (ctx.state !== "running") {
      resumeVillageAudio();
      if ((ctx.state as string) !== "running") return;
    }
    if (!slot) {
      try {
        if (!bus || busCtx !== ctx) {
          bus = createSfxBus(ctx);
          busCtx = ctx;
        }
        const spatial = createSpatial(ctx, bus.input);
        slot = { site, mix: site.build(ctx, spatial.input), spatial, idleFor: 0 };
        slots.push(slot);
      } catch {
        continue;
      }
    }
    slot.idleFor = 0;
    const pan = riding ? 0 : panFor(site.x - sfxListener.x, site.z - sfxListener.z, sfxListener.rx, sfxListener.rz);
    const rel = riding ? 1 : level / (SPECTATOR_PEAK * site.trim);
    slot.spatial.set(t, level, pan, riding ? 20000 : airCutoff(rel, 15000, 1600), riding ? 0.3 : 0.25);
    slot.mix.update(t, site.input(wall, riding, selfRide.slot, music));
  }
}

export type { CarouselInput, DropInput, MoonBoatInput, WheelInput };

/** The live number of built ride mixes (the DEV probe and a test read it). */
export function rideSfxBuilt(): number {
  return slots.length;
}
