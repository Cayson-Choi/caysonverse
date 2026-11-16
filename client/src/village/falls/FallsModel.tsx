import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Plane, Vector3, type Material, type Mesh, type Object3D, type Texture } from "three";
import { configureLightmap } from "../../game/hub/hubModelPrep";
import { dayNight } from "../dayNightDriver";
import { useNightMapWanted } from "../nightLightmap";
import { villageClock } from "../villageClock";
import { freeTexture, type VillageTier } from "../villageModelPrep";
import type { SkyMapping } from "../villageWater";
import { createFallsAudio, type FallsAudio } from "./fallsAudio";
import {
  FALLS,
  OLD_POOL_LIFT,
  STUB_POOL_LIFT,
  distanceToImpact,
  fallsFxFrom,
  fallsNear,
  fallsTierFrom,
  kstHours,
  nearFade,
  pickLod,
  rainbowAmount,
  type FallsFx,
  type FallsRuntime,
} from "./fallsConfig";
import { loadFallsModel, loadTexture, nightLightmapUrl } from "./fallsLoader";
import { fallsDayNight, fallsUniforms, rockDayNight, rockUniforms } from "./fallsMaterials";
import { disposeFalls, hideOldFalls, prepareFalls, villageHasOldFalls, type FallsParts } from "./fallsPrep";
import { createFallsStub } from "./fallsStub";
import { wrapTime } from "../fountainLayout";

declare global {
  interface Window {
    /** Dev-only: the falls' runtime (FallsModel): numbers for the checks, and switches (`set`). Absent in production builds. */
    __cvFalls?: FallsProbe;
  }
}

export interface FallsStats {
  runtime: FallsRuntime;
  tier: VillageTier;
  baked: boolean;
  lod: 0 | 1;
  distance: number;
  triangles: number;
  /** Draw calls the falls add when all of them is in view (a multi-material mesh is one per material). */
  draws: number;
  meshes: number;
  droplets: number;
  mist: number;
  rainbow: number;
  audio: { target: number; running: boolean };
  /** DEV: the average time of the falls' own per-frame JavaScript (ms), since the last reset. */
  cpuMsPerFrame: number;
}
export interface FallsProbe {
  stats(): FallsStats | null;
  /** Every mesh of the falls: name, triangles, whether it is drawn, its materials. */
  list(): Array<{ name: string; tri: number; on: boolean; materials: string[] }>;
  /** Switch parts on or off at run time (DEV): `rainbow` a number forces its amount (null: the clock decides). */
  set(v: Partial<FallsFx> & { rainbowAmount?: number | null; pinEye?: [number, number, number] | null; visible?: boolean; resetCpu?: boolean; cut?: boolean }): void;
}

/** The site box (layout, W0) as clipping planes: a point is cut when it is inside all of them (clipIntersection). */
const SITE_CUT: Plane[] = (() => {
  const S = FALLS.site;
  return [
    new Plane(new Vector3(-1, 0, 0), S.minX),
    new Plane(new Vector3(1, 0, 0), -S.maxX),
    new Plane(new Vector3(0, 0, -1), S.minZ),
    new Plane(new Vector3(0, 0, 1), -S.maxZ),
    new Plane(new Vector3(0, 1, 0), -60),
  ];
})();

/** DEV: clip the village's materials inside the site box (on), or give them back (off). Returns the materials changed. */
function setSiteCut(villageRoot: Object3D, on: boolean, done: Material[]): Material[] {
  for (const m of done) {
    m.clippingPlanes = null;
    m.clipIntersection = false;
    m.needsUpdate = true;
  }
  if (!on) return [];
  const out = new Set<Material>();
  villageRoot.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (m.clippingPlanes?.length) continue;
      m.clippingPlanes = SITE_CUT;
      m.clipIntersection = true;
      m.needsUpdate = true;
      out.add(m);
    }
  });
  return [...out];
}

/** The falls start loading this long after the village mounts (ms): the village is drawn first. */
export const FALLS_LATE_MS = 1500;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function triangles(m: Mesh): number {
  const g = m.geometry;
  const n = g.index ? g.index.count / 3 : (g.getAttribute("position")?.count ?? 0) / 3;
  const inst = (m as Mesh & { isInstancedMesh?: boolean; count?: number }).isInstancedMesh ? (m as unknown as { count: number }).count : 1;
  return n * inst;
}

export interface FallsModelProps {
  /** The village model's root: its old waterfall is hidden while the falls are drawn. */
  villageRoot: Object3D;
  tier: VillageTier;
  sky: Texture | null;
  skyMapping: SkyMapping;
  runtime: "model" | "stub";
}

/**
 * The waterfall (B1, W4): `waterfall.glb` read late (fallsLoader.ts), dressed (fallsPrep.ts), and animated by a few
 * uniforms per frame: the clock, the time of day, how much spray and mist show, the rainbow, the cliff's LOD, and the
 * sound's distance (fallsAudio.ts). The old falls in village.glb stay until the model is in (then they are hidden;
 * the village rebuild, W6, removes them). Everything it makes is freed when it unmounts.
 */
export function FallsModel({ villageRoot, tier: tierProp, sky, skyMapping, runtime }: FallsModelProps) {
  const dev = !!import.meta.env.DEV;
  const search = typeof location === "undefined" ? "" : location.search;
  const tier = fallsTierFrom(search, dev, tierProp);
  const [parts, setParts] = useState<FallsParts | null>(null);
  const partsRef = useRef<FallsParts | null>(null);
  const fx = useRef<FallsFx>(fallsFxFrom(search, dev));
  const rainbowForce = useRef<number | null>(null);
  const audioRef = useRef<FallsAudio | null>(null);
  const lodRef = useRef<0 | 1>(0);
  const cpu = useRef({ ms: 0, n: 0 });
  const pinEye = useRef<[number, number, number] | null>(null);
  const lastDistance = useRef(0);
  const lastRainbow = useRef(0);
  const night = useNightMapWanted();
  const cutRef = useRef<Material[]>([]);
  const gl = useThree((st) => st.gl);
  // DEV `?fallsCut=1`: preview of the village rebuild (W6) — the village's own ground, old cliff and pond inside the site box
  // are clipped away so the falls are seen as they will be. Production keeps the old village there until W6 cuts the hole.
  useEffect(() => {
    if (!dev || new URLSearchParams(search).get("fallsCut") !== "1") return;
    gl.localClippingEnabled = true;
    cutRef.current = setSiteCut(villageRoot, true, cutRef.current);
    return () => {
      cutRef.current = setSiteCut(villageRoot, false, cutRef.current);
    };
  }, [dev, search, villageRoot, gl]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let made: FallsParts | null = null;
    let hidden: Object3D[] = [];
    const finish = (root: Object3D, lightmap: Texture | null, stubLift: number | null): void => {
      if (!alive) {
        // cancelled while loading: free what arrived
        root.traverse((n) => {
          const m = n as Mesh;
          if (m.isMesh) m.geometry.dispose();
        });
        if (lightmap) freeTexture(lightmap);
        return;
      }
      const lift = stubLift ?? (villageHasOldFalls(villageRoot) ? OLD_POOL_LIFT : 0);
      made = prepareFalls(root, { tier, sky, skyMapping, lightmap, poolLift: lift });
      hidden = hideOldFalls(villageRoot);
      lodRef.current = made.params.lod0Within > 0 ? 0 : 1;
      audioRef.current = createFallsAudio();
      partsRef.current = made;
      setParts(made);
    };
    timer = setTimeout(() => {
      timer = null;
      if (runtime === "stub") {
        finish(createFallsStub(0), null, villageHasOldFalls(villageRoot) ? STUB_POOL_LIFT : 0);
        return;
      }
      loadFallsModel()
        .then((l) => finish(l.root, l.lightmap, null))
        .catch((e: unknown) => {
          // no falls this visit (the old ones stay): never an error in the console
          console.warn("[falls] model not loaded", e);
        });
    }, FALLS_LATE_MS);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      audioRef.current?.dispose();
      audioRef.current = null;
      partsRef.current = null;
      setParts(null);
      if (made) disposeFalls(made);
      for (const o of hidden) o.visible = true;
      rockUniforms.uNightMap.value = null;
    };
  }, [runtime, tier, villageRoot, sky, skyMapping]);

  // The night light map, only when night is near (as the village's: nightLightmap.ts).
  useEffect(() => {
    const url = nightLightmapUrl();
    if (!parts || !parts.baked || !night || !url) return;
    let alive = true;
    let tex: Texture | null = null;
    void loadTexture(url).then((t) => {
      if (!t) return;
      if (!alive) {
        freeTexture(t);
        return;
      }
      tex = configureLightmap(t);
      rockUniforms.uNightMap.value = tex;
    });
    return () => {
      alive = false;
      if (rockUniforms.uNightMap.value === tex) rockUniforms.uNightMap.value = null;
      if (tex) freeTexture(tex);
    };
  }, [parts, night]);

  useEffect(() => {
    if (!dev) return;
    window.__cvFalls = {
      list() {
        const p = partsRef.current;
        if (!p) return [];
        return p.meshes.map((m) => {
          let on = m.visible;
          for (let a = m.parent; on && a; a = a.parent) on = a.visible;
          return { name: m.name, tri: triangles(m), on, materials: (Array.isArray(m.material) ? m.material : [m.material]).map((x) => x.name) };
        });
      },
      stats() {
        const p = partsRef.current;
        if (!p) return null;
        let tri = 0;
        let draws = 0;
        for (const m of p.meshes) {
          let on = m.visible;
          for (let a = m.parent; on && a; a = a.parent) on = a.visible;
          if (on) {
            tri += triangles(m);
            draws += Array.isArray(m.material) ? Math.max(1, m.geometry.groups.length) : 1;
          }
        }
        const sp = p.spray;
        const drops = p.params.spray + p.params.peel + p.params.churn;
        if (sp.droplets.visible) {
          tri += drops * 2;
          draws++;
        }
        if (sp.mist.visible) draws++;
        if (sp.rainbow?.visible) draws++;
        if (sp.rainbow?.visible) tri += triangles(sp.rainbow);
        if (sp.mist.visible) tri += p.params.mist * 2;
        const a = audioRef.current;
        return {
          runtime,
          tier: p.tier,
          baked: p.baked,
          lod: lodRef.current,
          distance: lastDistance.current,
          triangles: Math.round(tri),
          draws,
          meshes: p.meshes.length,
          droplets: sp.droplets.visible ? drops : 0,
          mist: sp.mist.visible ? p.params.mist : 0,
          rainbow: lastRainbow.current,
          audio: { target: a?.target ?? 0, running: a?.running ?? false },
          cpuMsPerFrame: cpu.current.n ? cpu.current.ms / cpu.current.n : 0,
        };
      },
      set(v) {
        const f = fx.current;
        if (v.spray !== undefined) f.spray = v.spray;
        if (v.mist !== undefined) f.mist = v.mist;
        if (v.sound !== undefined) f.sound = v.sound;
        if (v.water !== undefined) f.water = v.water;
        if (v.rainbow !== undefined) f.rainbow = v.rainbow;
        if (v.rainbowAmount !== undefined) rainbowForce.current = v.rainbowAmount;
        if (v.pinEye !== undefined) pinEye.current = v.pinEye;
        // draw nothing of the falls (and keep the old falls hidden): the same page measured with and without them
        if (v.resetCpu) cpu.current = { ms: 0, n: 0 };
        if (v.visible !== undefined && partsRef.current) partsRef.current.root.visible = v.visible;
        if (v.cut) gl.localClippingEnabled = true;
        if (v.cut !== undefined) cutRef.current = setSiteCut(villageRoot, v.cut, cutRef.current);
      },
    };
    return () => {
      delete window.__cvFalls;
    };
  }, [dev, runtime, gl, villageRoot]);

  useFrame(({ clock, camera }) => {
    const p = partsRef.current;
    if (!p) return;
    const t0 = dev ? performance.now() : 0;
    // (DEV: a harness that pins the drawn camera tells the falls where it is, `pinEye`)
    const eye = pinEye.current;
    const d = eye ? distanceToImpact(eye[0], eye[1], eye[2]) : distanceToImpact(camera.position.x, camera.position.y, camera.position.z);
    lastDistance.current = d;
    const s = dayNight.applied;
    // the fountain's wrapped clock: every rate in the falls' shaders repeats over it (no jump, no float drift)
    fallsUniforms.uTime.value = wrapTime(clock.elapsedTime);
    fallsDayNight(s, p.pools);
    rockDayNight(s);
    const f = fx.current;
    const near = fallsNear(d);
    const far = 1 - smooth(90, 120, d);
    // the morning rainbow: the clock's hours in the layout's window, high tier only (or forced by the DEV switch)
    let rb = rainbowForce.current ?? rainbowAmount(kstHours(villageClock.nowMs()), p.tier, s.day);
    if (f.rainbow && p.tier === "high") rb = Math.max(rb, 1);
    rb *= far * nearFade(d, [3, 8]);
    lastRainbow.current = rb;
    p.spray.set({ spray: near && f.spray ? far : 0, mist: near && f.mist ? far : 0, rainbow: rb });
    // the cliff's LOD
    if (p.lod0.length && p.lod1.length) {
      const next = pickLod(d, p.params.lod0Within, lodRef.current);
      if (next !== lodRef.current) {
        lodRef.current = next;
        for (const o of p.lod0) o.visible = next === 0;
        for (const o of p.lod1) o.visible = next === 1;
      }
    }
    audioRef.current?.update(f.sound ? d : Infinity);
    if (dev) {
      cpu.current.ms += performance.now() - t0;
      cpu.current.n++;
    }
  });

  return parts ? <primitive object={parts.root} dispose={null} /> : null;
}
