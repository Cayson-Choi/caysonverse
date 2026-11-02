import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { AdditiveBlending, BufferAttribute, CylinderGeometry, DoubleSide, MeshBasicMaterial } from "three";
import { prefersReducedMotion } from "../escape/reducedMotion";
import { useQualityTier } from "./QualityEffects";
import { QUALITY, sparklesPerPoint } from "./quality";

/**
 * Sun shafts through the windows (AI 학교 탈출, Task 21) — the rich tier only. One faint additive cone per
 * window, hanging from the window into the room, with a few sparkles drifting in it.
 *
 * The windows are the room model's `shaft__<n>` empty nodes (Tasks 23-24): the scene reads their world
 * positions and hands them over as `points`. A point is the window's centre; `rotY` is the yaw of its inward
 * direction (the node's local +Z points into the room). Before the model arrives a scene passes an empty
 * array and nothing is drawn.
 *
 * Everything is shared and made once: one cone geometry (its colours fade from the window to nothing, so the
 * additive blend dies out smoothly), one material. The only per-frame work is a slow shimmer on that one
 * material's opacity (left still when the player asked for less motion) — nothing is allocated.
 */

export interface ShaftPoint {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/** The cone, in metres: it starts at the window (radius TOP), widens to RADIUS_BOTTOM over LENGTH and leans TILT toward the room. */
const SHAFT = { length: 4.2, top: 0.3, bottom: 1.0, tilt: (35 * Math.PI) / 180, segments: 20 } as const;
const SHAFT_COLOR = "#FFF1D6";
const SHAFT_OPACITY = 0.2;
/** Slow shimmer: opacity swings by this fraction of itself, once every ~10 s. */
const SHIMMER = { depth: 0.18, speed: 0.6 } as const;
/** The sparkles live in the cone's middle, in a box this big (m). */
const SPARKLE_BOX: [number, number, number] = [1.6, 2.6, 1.6];

/** A cone whose top is at the origin pointing down -Y, colours fading from full (the window) to black (the far end). */
function makeShaftGeometry(): CylinderGeometry {
  const g = new CylinderGeometry(SHAFT.top, SHAFT.bottom, SHAFT.length, SHAFT.segments, 1, true);
  g.translate(0, -SHAFT.length / 2, 0);
  const pos = g.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const fade = 1 - Math.min(1, Math.max(0, -pos.getY(i) / SHAFT.length));
    colors[i * 3] = fade;
    colors[i * 3 + 1] = fade;
    colors[i * 3 + 2] = fade;
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  return g;
}

export function LightShafts({ points }: { points: readonly ShaftPoint[] }) {
  const tier = useQualityTier();
  const spec = QUALITY[tier];
  const geometry = useMemo(makeShaftGeometry, []);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: SHAFT_COLOR,
        vertexColors: true,
        transparent: true,
        opacity: SHAFT_OPACITY,
        blending: AdditiveBlending,
        side: DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  );
  const still = useMemo(() => prefersReducedMotion(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const on = spec.shafts && points.length > 0;
  useFrame(({ clock }) => {
    if (!on || still) return;
    material.opacity = SHAFT_OPACITY * (1 + SHIMMER.depth * Math.sin(clock.elapsedTime * SHIMMER.speed));
  });
  if (!on) return null;

  const sparkles = sparklesPerPoint(spec.sparkles, points.length);
  // Local to a shaft: the cone's middle, a little inside the room (the cone leans toward local +Z).
  const midY = (-SHAFT.length / 2) * Math.cos(SHAFT.tilt);
  const midZ = (SHAFT.length / 2) * Math.sin(SHAFT.tilt);
  return (
    <group>
      {points.map((p, i) => (
        <group key={i} position={[p.x, p.y, p.z]} rotation-y={p.rotY}>
          <mesh geometry={geometry} material={material} rotation-x={-SHAFT.tilt} renderOrder={3} dispose={null} />
          {sparkles > 0 && (
            <Sparkles
              count={sparkles}
              scale={SPARKLE_BOX}
              size={6}
              speed={0.25}
              opacity={0.9}
              color={SHAFT_COLOR}
              position={[0, midY, midZ]}
            />
          )}
        </group>
      ))}
    </group>
  );
}
