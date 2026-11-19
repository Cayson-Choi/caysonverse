import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Texture, type WebGLRenderer } from "three";
import { getPbrKtx2Loader, getPbrSet, pbrSetInfo, pbrUrl, releasePbrSet, type PbrTier } from "../pbr/pbrLibrary";
import { versionedUrl } from "../modelUrl";

/**
 * The lot buildings' surfaces (lots v2, L5v2 2026-11-17): every `LM_*` material of a lot model names a shared PBR library set in its
 * texture manifest (`lots/<dir>/<model>_textures.json`, the path in the model's `asset.extras.textures`); a few materials have a kind of
 * their own (glass, the window view `screen`, the hearth and candle `fire`, the stained glass's `lightpool`, a lot's `own` KTX2 atlas,
 * the gate's `lamp` and `emit`). The model's UVs are metres (repeat = 1 / the set's tile), COLOR_0 tints the albedo.
 *
 * GPU memory (contract 6: lots PC 60 MB / phone 24 MB of shared sets): the six exteriors name 27 different sets — 216 MB at the PC
 * tier, 90 MB at the phone's — so a lot is dressed in two steps. Every lot always has its sets' 1K ALBEDO only (`far`: 1.4 MB a set on a
 * desktop GPU, 0.7 MB on a phone; the normal and ORM slots hold 1×1 neutral stand-ins, the roughness its set's mean), and the lots the
 * LOD shows in detail (PC 35 m, phone 25 m, at most two on a phone) get the full set at the device's tier (`near`: albedo, normal, ORM).
 * Swapping textures never changes a material's program (the same map slots are always filled), so nothing recompiles on the way.
 */

export const LOTS_MODEL_BASE = "/models/village/";

export interface LotMatSpec {
  pbr?: string;
  kind?: string;
  tileMeters?: number;
  roughnessScale?: number;
  normalScale?: number;
  metal?: boolean;
  /** A linear RGB multiplier on the set's albedo (the material's colour): one set, a lighter or warmer stone of it. */
  albedoGain?: [number, number, number];
  maps?: { albedo: string };
}

export interface LotManifest {
  /** The folder the manifest's own maps are in (absolute URL path, ending in "/"). */
  dir: string;
  materials: Record<string, LotMatSpec>;
}

/** The manifest paths a model's extras name (`lots/<dir>/<file>.json`, relative to models/village/): a string or a list. */
export function manifestPaths(v: unknown): string[] {
  const texts = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
  const out: string[] = [];
  for (const t of texts) for (const m of t.matchAll(/lots\/([a-z0-9_]+\/[a-z0-9_]+\.json)/g)) out.push(`lots/${m[1]!}`);
  return out;
}

export async function fetchLotManifest(path: string, signal?: AbortSignal): Promise<LotManifest> {
  const res = await fetch(versionedUrl(LOTS_MODEL_BASE + path), { signal });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const meta = (await res.json()) as { materials: Record<string, LotMatSpec> };
  return { dir: LOTS_MODEL_BASE + path.slice(0, path.lastIndexOf("/") + 1), materials: meta.materials };
}

/** A lot's own map (an `own` atlas, the light pools): sRGB, glTF UVs, no repeat. */
export async function loadLotOwnMap(gl: WebGLRenderer, url: string): Promise<Texture> {
  const tex = await getPbrKtx2Loader(gl).loadAsync(versionedUrl(url));
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = Math.min(16, gl.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

function neutral(r: number, g: number, b: number): DataTexture {
  const t = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** The 1×1 stand-ins a far lot's normal and ORM slots hold (a flat normal; AO 1, roughness 1, metal 1: the scalars rule). */
export const FLAT_NORMAL = neutral(128, 128, 255);
export const FLAT_ORM = neutral(255, 255, 255);

export interface LotSetTextures {
  map: Texture;
  normalMap: Texture;
  orm: Texture;
  near: boolean;
}

interface Entry {
  far: Promise<Texture> | null;
  farTex: Texture | null;
  /** Arrived, waiting for its GPU upload (`pump`): shown only once uploaded, so no frame waits for a texture upload. */
  farStaged: Texture | null;
  nearStaged: { map: Texture; normalMap: Texture; orm: Texture } | null;
  near: Promise<void> | null;
  nearTex: { map: Texture; normalMap: Texture; orm: Texture } | null;
  wanted: boolean;
  lastWanted: number;
}

/** Who holds a library set (the exteriors' bank, a room's): it is let go of only when nobody does. */
const holders = new Map<string, number>();
function acquireSet(id: string, tier: PbrTier, gl: WebGLRenderer) {
  const set = getPbrSet(id, tier, gl);
  const key = `${id}@${tier}`;
  holders.set(key, (holders.get(key) ?? 0) + 1);
  return set;
}
function releaseSet(id: string, tier: PbrTier): void {
  const key = `${id}@${tier}`;
  const n = (holders.get(key) ?? 1) - 1;
  if (n > 0) holders.set(key, n);
  else {
    holders.delete(key);
    void releasePbrSet(id, tier);
  }
}

/** How long (ms) a set's full maps stay after no detailed lot wants them (a walk past a corner does not reload them). */
export const NEAR_KEEP_MS = 20_000;

/**
 * The lots' texture bank: per set the far albedo and, while wanted, the near set. One per tier; the materials ask it what to show
 * (`textures(id)`) each time the wanted sets change.
 */
export class LotTextureBank {
  readonly tier: PbrTier;
  private gl: WebGLRenderer;
  private sets = new Map<string, Entry>();
  private changed = false;
  /** Textures to upload a few per frame (`pump`) before they are shown; off for a room (it uploads under its entry cover). */
  private readonly staged: boolean;
  private queue: Texture[] = [];
  constructor(gl: WebGLRenderer, tier: PbrTier, staged = true) {
    this.gl = gl;
    this.tier = tier;
    this.staged = staged;
  }

  /**
   * Upload up to `count` waiting textures (one KTX2 upload is a copy of its compressed mips: a 2K BC7 map is ~5.6 MB), then show the sets
   * whose maps are all up. Returns how many are still waiting. Called once a frame by the lots.
   */
  pump(count = 1): number {
    for (let n = 0; n < count && this.queue.length > 0; n++) {
      const t = this.queue.shift()!;
      try {
        this.gl.initTexture(t);
      } catch {
        // three uploads it on its first draw instead
      }
    }
    for (const e of this.sets.values()) {
      if (e.farStaged && !this.queue.includes(e.farStaged)) {
        e.farTex = e.farStaged;
        e.farStaged = null;
        this.changed = true;
      }
      const ns = e.nearStaged;
      if (ns && !this.queue.includes(ns.map) && !this.queue.includes(ns.normalMap) && !this.queue.includes(ns.orm)) {
        e.nearTex = ns;
        e.nearStaged = null;
        this.changed = true;
      }
    }
    return this.queue.length;
  }

  /** Every far albedo asked for is uploaded and shown (the lots may be drawn). */
  farReady(): boolean {
    for (const e of this.sets.values()) if (e.far && !e.farTex) return false;
    return true;
  }

  private stageFar(e: Entry, t: Texture): void {
    if (!this.staged) {
      e.farTex = t;
      this.changed = true;
      return;
    }
    e.farStaged = t;
    this.queue.push(t);
  }

  private stageNear(e: Entry, t: { map: Texture; normalMap: Texture; orm: Texture }): void {
    if (!this.staged) {
      e.nearTex = t;
      this.changed = true;
      return;
    }
    e.nearStaged = t;
    this.queue.push(t.map, t.normalMap, t.orm);
  }

  private entry(id: string): Entry {
    let e = this.sets.get(id);
    if (!e) this.sets.set(id, (e = { far: null, farTex: null, farStaged: null, nearStaged: null, near: null, nearTex: null, wanted: false, lastWanted: 0 }));
    return e;
  }

  private repeat(id: string, t: Texture): Texture {
    const c = t.clone();
    const tile = pbrSetInfo(id).tileMeters;
    c.repeat.set(1 / tile, 1 / tile);
    c.wrapS = c.wrapT = RepeatWrapping;
    c.needsUpdate = true;
    return c;
  }

  /** The far albedo of a set (1K, loaded once). */
  loadFar(id: string): Promise<Texture> {
    const e = this.entry(id);
    if (!e.far) {
      e.far = getPbrKtx2Loader(this.gl)
        .loadAsync(pbrUrl(id, "1k", "albedo"))
        .then((t) => {
          t.colorSpace = SRGBColorSpace;
          t.magFilter = LinearFilter;
          t.minFilter = LinearMipmapLinearFilter;
          t.anisotropy = Math.min(16, this.gl.capabilities.getMaxAnisotropy());
          t.name = `lotfar_${id}`;
          const c = this.repeat(id, t);
          if (this.sets.get(id) === e) this.stageFar(e, c);
          else c.dispose();
          return c;
        });
      e.far.catch(() => (e.far = null));
    }
    return e.far;
  }

  /** The full set now and for good (a room: everything in it is near). */
  loadNear(id: string): Promise<void> {
    const e = this.entry(id);
    e.wanted = true;
    e.lastWanted = Infinity;
    return this.requestNear(id, e);
  }

  private requestNear(id: string, e: Entry): Promise<void> {
    if (!e.near) {
      e.near = acquireSet(id, this.tier, this.gl).then((s) => {
        if (this.sets.get(id) !== e) {
          releaseSet(id, this.tier);
          return;
        }
        this.stageNear(e, { map: this.repeat(id, s.map), normalMap: this.repeat(id, s.normalMap), orm: this.repeat(id, s.orm) });
      });
      e.near.catch(() => {
        e.near = null;
        releaseSet(id, this.tier);
      });
    }
    return e.near;
  }

  /** Each repeat clone holds its own WebGL texture reference, even when its source is shared. */
  private releaseNear(id: string, e: Entry): void {
    const maps = e.nearTex ?? e.nearStaged;
    if (!maps) return; // requestNear releases a still-loading entry when it settles
    maps.map.dispose();
    maps.normalMap.dispose();
    maps.orm.dispose();
    e.near = null;
    e.nearTex = null;
    e.nearStaged = null;
    releaseSet(id, this.tier);
  }

  /** Mark which sets the detailed lots want now; starts their loads, lets go of the others after NEAR_KEEP_MS. */
  want(ids: ReadonlySet<string>, now: number): void {
    for (const id of ids) this.entry(id);
    for (const [id, e] of this.sets) {
      const w = ids.has(id);
      if (w) e.lastWanted = now;
      e.wanted = w;
      if (w && !e.near) void this.requestNear(id, e);
      if (!w && (e.nearTex || e.nearStaged) && now - e.lastWanted > NEAR_KEEP_MS) {
        const st = e.nearStaged;
        if (st) this.queue = this.queue.filter((q) => q !== st.map && q !== st.normalMap && q !== st.orm);
        this.releaseNear(id, e);
        this.changed = true;
      }
    }
  }

  /** What a material of this set shows now: the near set when it is in (and wanted or kept), else the far albedo. */
  textures(id: string): LotSetTextures | null {
    const e = this.sets.get(id);
    if (!e) return null;
    if (e.nearTex) return { ...e.nearTex, near: true };
    if (e.farTex) return { map: e.farTex, normalMap: FLAT_NORMAL, orm: FLAT_ORM, near: false };
    return null;
  }

  /** True once after any texture came in or went (the materials re-point their maps). */
  takeChanged(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }

  /** Estimated GPU bytes of what the bank holds now (KTX2Loader's formats: BC7 on a desktop, ETC2/ASTC on a phone). */
  gpuBytes(device: "desktop" | "mobile"): { far: number; near: number; sets: number; nearSets: number } {
    let far = 0;
    let near = 0;
    let nearSets = 0;
    for (const [id, e] of this.sets) {
      if (e.farTex) far += 1024 * 1024 * (device === "mobile" ? 0.5 : 1) * (4 / 3);
      if (e.nearTex) {
        nearSets++;
        const info = pbrSetInfo(id);
        for (const kind of ["albedo", "normal", "orm"] as const) {
          const side = info.tiers[this.tier]?.[kind] ? (this.tier === "2k" ? 2048 : 1024) : 1024;
          near += side * side * (kind === "albedo" && device === "mobile" ? 0.5 : 1) * (4 / 3);
        }
      }
    }
    return { far: Math.round(far), near: Math.round(near), sets: this.sets.size, nearSets };
  }

  dispose(): void {
    for (const [id, e] of this.sets) {
      e.farTex?.dispose();
      e.farStaged?.dispose();
      this.releaseNear(id, e);
    }
    this.sets.clear();
    this.queue = [];
  }
}

/**
 * Drops a compressed map's mip levels above `max` texels (on its long side); a map without mips is left as it is. A
 * level only becomes the top when both its sides are whole 4x4 blocks (a compressed texture's storage needs them: a
 * 96x250 top was "glTexStorage2D: Invalid compressed image size" on the phone), so a map may stay above the cap.
 */
export function capMips(t: Texture, max: number): void {
  const mips = (t as Texture & { mipmaps?: Array<{ width: number; height: number }> }).mipmaps;
  if (!mips || mips.length < 2) return;
  let k = 0;
  while (k < mips.length - 1 && Math.max(mips[k]!.width, mips[k]!.height) > max && mips[k + 1]!.width % 4 === 0 && mips[k + 1]!.height % 4 === 0) k++;
  if (k === 0) return;
  (t as Texture & { mipmaps: unknown[] }).mipmaps = mips.slice(k);
  t.image = { ...(t.image as object), width: mips[k]!.width, height: mips[k]!.height };
  t.needsUpdate = true;
}
