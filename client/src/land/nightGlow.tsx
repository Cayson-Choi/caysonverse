/**
 * Night glow for 케이슨랜드 (night audit 2026-11-18): the park's lamps and ride bulbs were plain emissive spheres that looked the
 * same at noon and at midnight, with no light on the paving. Two cheap tricks, no real-time light per lamp (phones):
 *  - `BulbHalos`: one `Points` draw of soft additive halos at the bulbs' places (a radial-gradient sprite), fading in with the
 *    clock's `lights` weight (dayNight.applied.lights, 0 by day);
 *  - `LampPools`: one instanced draw of flat additive discs on the ground under the lamps (a warm pool of light on the paving).
 * Both are invisible (not drawn) by day.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  PlaneGeometry,
} from "three";
import { dayNight } from "../village/dayNightDriver";

/** A soft round gradient (white centre to transparent), the shape of both the halo and the pool. */
function gradientTexture(inner: number): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(inner, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Soft halos round bulbs. `places` are in the parent group's frame (a turning ride's halos turn with it). */
export function BulbHalos({ places, size, color = "#ffc873", strength = 1 }: { places: readonly (readonly [number, number, number])[]; size: number; color?: string; strength?: number }) {
  const ref = useRef<Points>(null);
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(places.flat(), 3));
    return g;
  }, [places]);
  const map = useMemo(() => gradientTexture(0.18), []);
  const mat = useMemo(
    () => new PointsMaterial({ map, color, size, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false }),
    [map, color, size],
  );
  useEffect(
    () => () => {
      geo.dispose();
      map.dispose();
      mat.dispose();
    },
    [geo, map, mat],
  );
  useFrame(() => {
    const o = dayNight.applied.lights * strength;
    mat.opacity = Math.min(1, o);
    if (ref.current) ref.current.visible = o > 0.01;
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={5} />;
}

/** Warm pools of light on the ground at `places` (x, z), radius `radius` m. */
export function LampPools({ places, radius, y = 0.05, color = "#ffb766", strength = 0.55 }: { places: readonly { x: number; z: number }[]; radius: number; y?: number; color?: string; strength?: number }) {
  const ref = useRef<InstancedMesh>(null);
  const geo = useMemo(() => new PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), [radius]);
  const map = useMemo(() => gradientTexture(0.0), []);
  const mat = useMemo(
    () => new MeshBasicMaterial({ map, color, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    [map, color],
  );
  useEffect(() => {
    const m = new Matrix4();
    places.forEach((p, i) => {
      m.makeTranslation(p.x, y, p.z);
      ref.current?.setMatrixAt(i, m);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [places, y]);
  useEffect(
    () => () => {
      geo.dispose();
      map.dispose();
      mat.dispose();
    },
    [geo, map, mat],
  );
  useFrame(() => {
    const o = dayNight.applied.lights * strength;
    mat.opacity = Math.min(1, o);
    if (ref.current) ref.current.visible = o > 0.01;
  });
  return <instancedMesh ref={ref} args={[geo, mat, places.length]} frustumCulled={false} renderOrder={1} />;
}
