/**
 * What the park adds to the sky as the eye rises (land/parkAltitude.ts): the probe that turns the camera's height into the altitude factor, and
 * a layer of cloud puffs at 88-190 m that come into view as the lift climbs (a painted dome has no parallax: these are real things you rise
 * toward, so the clouds get nearer). Hidden on the ground and at the low rides, so every ground view is exactly what it was.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial } from "three";
import { dayNight } from "../village/dayNightDriver";
import { isTouchDevice } from "../device";
import { altitudeFactor, parkAltitude } from "./parkAltitude";
import { viewState } from "../game/viewState";
import { coasterTrack } from "@caysonverse/shared/land/coaster";

/** Writes `parkAltitude.a` once a frame from the camera's height (0 in the overview camera: it looks down from far above on purpose). */
export function ParkAltitudeProbe() {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    parkAltitude.a = altitudeFactor(camera.position.y) * (1 - Math.min(1, Math.max(0, viewState.ovBlend)));
  });
  useEffect(
    () => () => {
      parkAltitude.a = 0;
    },
    [],
  );
  return null;
}

/** One soft cumulus puff (alpha picture): lit white top, grey-blue belly, ragged edge. Painted once. */
function puffTexture(w: number, h: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  let seed = 9173;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const blob = (x: number, y: number, r: number, k: number): void => {
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    const shade = Math.round(255 - 30 * Math.min(1, Math.max(0, (y - h * 0.2) / (h * 0.7))));
    g.addColorStop(0, `rgba(${shade},${shade},${Math.min(255, shade + 6)},${0.9 * k})`);
    g.addColorStop(0.6, `rgba(${shade},${shade},${Math.min(255, shade + 6)},${0.45 * k})`);
    g.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < 26; i++) {
    const t = rnd();
    const x = w * (0.16 + 0.68 * t);
    const lift = Math.sin(t * Math.PI); // taller in the middle
    const y = h * (0.62 - 0.3 * lift * rnd());
    blob(x, y, h * (0.22 + 0.3 * lift * rnd()), 0.8);
  }
  for (let i = 0; i < 10; i++) blob(w * (0.2 + 0.6 * rnd()), h * (0.66 + 0.1 * rnd()), h * 0.2, 0.5); // the flat belly
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
}

/** The puffs' places (park metres): round the lift and the circuit, 88-190 m up, 70-220 m wide. Deterministic. */
export function highCloudPlaces(n: number): Puff[] {
  let seed = 424242;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out: Puff[] = [];
  for (let i = 0; i < n; i++) {
    const ring = i % 3; // near, mid, far
    const r = ring === 0 ? 50 + rnd() * 110 : ring === 1 ? 200 + rnd() * 200 : 420 + rnd() * 300;
    const a = rnd() * Math.PI * 2;
    const w = 70 + rnd() * 80 + ring * 35;
    out.push({ x: 40 + Math.cos(a) * r, z: -40 + Math.sin(a) * r, y: 88 + rnd() * 90 + ring * 10, w, h: w * (0.42 + rnd() * 0.14) });
  }
  // a few right along the lift's line, over its crest: the first things the climbing rider sees come toward him
  const tr = coasterTrack();
  const i = Math.round(tr.liftTo);
  const cx = tr.pos[3 * i]!;
  const cz = tr.pos[3 * i + 2]!;
  const tx = tr.tan[3 * i]!;
  const tz = tr.tan[3 * i + 2]!;
  const hl = Math.hypot(tx, tz) || 1;
  [[70, -30, 84, 80], [105, 38, 96, 100], [150, -45, 112, 120], [200, 20, 128, 140]].forEach(([d, side, y, w]) => {
    out.push({ x: cx + (tx / hl) * d! - (tz / hl) * side!, z: cz + (tz / hl) * d! + (tx / hl) * side!, y: y!, w: w!, h: w! * 0.48 });
  });
  return out;
}

export function ParkHighClouds() {
  const group = useRef<Group>(null);
  const places = useMemo(() => highCloudPlaces(isTouchDevice ? 18 : 33), []);
  const material = useMemo(() => {
    const m = new SpriteMaterial({ map: puffTexture(isTouchDevice ? 256 : 512, isTouchDevice ? 128 : 256), transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0 });
    return m;
  }, []);
  const sprites = useMemo(
    () =>
      places.map((p) => {
        const s = new Sprite(material);
        s.position.set(p.x, p.y, p.z);
        s.scale.set(p.w, p.h, 1);
        s.frustumCulled = false;
        s.raycast = () => {};
        s.renderOrder = -5;
        return s;
      }),
    [places, material],
  );
  useEffect(
    () => () => {
      material.map?.dispose();
      material.dispose();
    },
    [material],
  );
  useFrame(() => {
    const a = parkAltitude.a;
    // nothing on the ground; they fade in over the lift's middle third and are full near the top
    const show = Math.min(1, Math.max(0, (a - 0.12) / 0.5));
    const g = group.current;
    if (!g) return;
    g.visible = show > 0.01;
    if (!g.visible) return;
    material.opacity = 0.92 * show;
    const t = dayNight.applied.domeTint;
    material.color.setRGB(Math.min(1, t[0]), Math.min(1, t[1]), Math.min(1, t[2]));
  });
  return (
    <group ref={group} visible={false}>
      {sprites.map((s, i) => (
        <primitive key={i} object={s} />
      ))}
    </group>
  );
}
