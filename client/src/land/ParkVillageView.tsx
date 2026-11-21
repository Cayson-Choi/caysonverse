/**
 * The village seen from inside 케이슨랜드, through the gate arch (owner 2026-11-21: "왜 입장했는데 문 사이로 저런 모습이 보이는거야" - the arch
 * showed bare grass and hills where the village one has just left should be).
 *
 * The park is its own place (the village's model is not mounted in it), so the view is a picture: the REAL village photographed in a ring
 * from the spot that corresponds to the park's arrival spot (e2e/probes/gate-view-capture.mjs: the gatehouse, the wall and the sky taken
 * away), stitched into a cylinder strip (tools/park-village-view.py) and drawn on a cylinder of the same radius round the arrival spot,
 * beyond the north wall. From where a visitor arrives every roof stands exactly where it does in the village; walking about, the picture
 * is far enough (45 m and more beyond the arch) to keep reading as the place outside. Three strips (day, dusk, night) follow the clock;
 * the strip's sky is cut out (alpha), so the park's own sky, stars and moon show over the roofs.
 *
 * Cost: one draw call, 48 triangles, three 2048 x 512 textures (1024 x 256 on a phone), not mipmapped: ~12 MB (3 MB) of GPU memory.
 * Only drawn while the camera is below the wall's top: from a ride, high up, the strip would be seen for the flat curtain it is.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { BufferGeometry, ClampToEdgeWrapping, Float32BufferAttribute, LinearFilter, ShaderMaterial, SRGBColorSpace, TextureLoader, type Mesh, type Texture } from "three";
import { PARK_ARRIVAL } from "@caysonverse/shared/village/parkArea";
import { PARK_WALL_RECT, WALL } from "@caysonverse/shared/village/parkWall";
import { isTouchDevice } from "../device";
import { dayNight } from "../village/dayNightDriver";

/** The strip's cylinder: the stitcher's numbers (tools/park-village-view.py R, H0, H1, SPAN_DEG). */
export const VILLAGE_VIEW = Object.freeze({ radius: 60, bottom: 0, top: 15, spanDeg: 180 });
/** The camera height (m) above which the strip is not drawn (the wall-walk's height: from above it the curtain would show its edge). */
export const VILLAGE_VIEW_MAX_EYE = WALL.walk;

const urls = (low: boolean) => ["day", "dusk", "night"].map((t) => `/textures/park/village_view_${t}${low ? "_1k" : ""}.webp`);

/**
 * The part of the cylinder that stands beyond the north wall (the rest would stand inside the park): bearings from north whose point
 * on the cylinder is at least `clear` m outside the wall's outer face. Returns the half angle (rad).
 */
export function villageViewHalfAngle(clear = 4): number {
  const outer = PARK_WALL_RECT.minZ - WALL.halfThickness - WALL.footing - clear; // the line the strip must stand beyond (north = -z)
  const need = PARK_ARRIVAL.z - outer; // how far north of the arrival spot that line is
  return Math.acos(Math.min(1, need / VILLAGE_VIEW.radius));
}

/** The strip's geometry: an arc of the cylinder (inner face drawn), u by the bearing over the whole strip's span, v up. */
export function villageViewGeometry(segments = 24): BufferGeometry {
  const V = VILLAGE_VIEW;
  const half = villageViewHalfAngle();
  const span = (V.spanDeg * Math.PI) / 180;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = -half + (2 * half * i) / segments; // bearing from north (-z), positive toward +x (east)
    const x = PARK_ARRIVAL.x + Math.sin(a) * V.radius;
    const z = PARK_ARRIVAL.z - Math.cos(a) * V.radius;
    const u = a / span + 0.5;
    pos.push(x, V.bottom, z, x, V.top, z);
    uv.push(u, 0, u, 1);
    if (i < segments) {
      const k = i * 2;
      // seen from inside the cylinder (the park): counter-clockwise from there
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The three strips' weights for a night weight (0 day .. 1 night): dusk peaks in between. */
export function villageViewWeights(night: number): [number, number, number] {
  const n = Math.min(1, Math.max(0, night));
  const dusk = 1 - Math.min(1, Math.abs(n - 0.45) / 0.45);
  const dark = Math.min(1, Math.max(0, (n - 0.45) / 0.45));
  const day = Math.max(0, 1 - dusk - dark);
  return [day, dusk, dark];
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;
const FRAG = /* glsl */ `
uniform sampler2D tDay;
uniform sampler2D tDusk;
uniform sampler2D tNight;
uniform vec3 uW;
varying vec2 vUv;
void main() {
  vec4 a = texture2D( tDay, vUv );
  vec4 b = texture2D( tDusk, vUv );
  vec4 n = texture2D( tNight, vUv );
  float al = a.a * uW.x + b.a * uW.y + n.a * uW.z;
  if ( al < 0.02 ) discard;
  // the photos are finished pictures (tone-mapped): their colours go to the screen as they are, weighted by their own cover
  vec3 col = ( a.rgb * a.a * uW.x + b.rgb * b.a * uW.y + n.rgb * n.a * uW.z ) / al;
  gl_FragColor = vec4( col, al );
  #include <colorspace_fragment>
}`;

export function ParkVillageView() {
  const maps = useLoader(TextureLoader, urls(isTouchDevice)) as Texture[];
  const ref = useRef<Mesh>(null);
  const geo = useMemo(() => villageViewGeometry(), []);
  const mat = useMemo(() => {
    for (const t of maps) {
      t.colorSpace = SRGBColorSpace;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = LinearFilter;
      t.needsUpdate = true;
    }
    return new ShaderMaterial({
      name: "M_park_village_view",
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { tDay: { value: maps[0] }, tDusk: { value: maps[1] }, tNight: { value: maps[2] }, uW: { value: [1, 0, 0] } },
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
  }, [maps]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    m.visible = camera.position.y < VILLAGE_VIEW_MAX_EYE;
    if (!m.visible) return;
    const w = villageViewWeights(dayNight.applied.night);
    (mat.uniforms.uW!.value as number[])[0] = w[0];
    (mat.uniforms.uW!.value as number[])[1] = w[1];
    (mat.uniforms.uW!.value as number[])[2] = w[2];
  });
  // before the lawn's far grass and the wall are tested against it nothing needs sorting: it is the farthest thing but the sky
  return <mesh ref={ref} geometry={geo} material={mat} renderOrder={-5} />;
}
