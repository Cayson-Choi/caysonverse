import { DoubleSide, Matrix3, MeshBasicMaterial, Vector3, type Texture } from "three";
import layout from "./gardenChart.json";
import views from "./windowViews.json";
import { WINDOW_VIEW_RADIUS } from "./windowView";

const { width, height, horizonTileHeight, gutter, bottomLatitude, topLatitude, blendDegrees } = layout;
const rowY = 2 * horizonTileHeight;
const radians = Math.PI / 180;
const northLimit = Math.sin((topLatitude - blendDegrees) * radians);
const southLimit = Math.sin((bottomLatitude + blendDegrees) * radians);

/** A room's baked view of the village (windowViews.json, written by window_view_atlas.mjs). */
export interface WindowViewKey {
  id: string;
  file: string;
  time: string;
  /** The clock's night and golden weights the key was baked at. */
  night: number;
  golden: number;
  /** The village's exposure when it was baked (a texel holds v / (1 + v), v = light x k). */
  k: number;
}
export interface WindowViewRoom {
  /** Room-frame (x, z) → village (x, z): [a b; c d] and its offset. */
  m: [number, number, number, number];
  t: [number, number];
  /** The bake's eye in the room's frame (x, y, z). */
  eyeRoom: [number, number, number];
  eyeVillage: [number, number, number];
  /** Day first (the manifest's own map), then the evening's golden hour and the night. */
  keys: WindowViewKey[];
}
export const WINDOW_VIEWS = (views as unknown as { rooms: Record<string, WindowViewRoom> }).rooms;

// Gradients come from the continuous eye ray. Clamp their texel footprint to a tile's guard pixels so a mip
// or an anisotropic tap cannot pull the other half of the horizon into a pane across the longitude seam.
const chartSampling = /* glsl */ `
vec3 viewTile(sampler2D tex, vec2 local, vec4 tile, vec2 dx, vec2 dy) {
  const vec2 atlas = vec2(${width}.0, ${height}.0);
  const float guard = ${gutter}.0;
  vec2 span = tile.zw - 2.0 * guard;
  vec2 uv = (tile.xy + guard + clamp(local, 0.0, 1.0) * span) / atlas;
  return textureGrad(tex, uv, clamp(dx * span, -guard, guard) / atlas, clamp(dy * span, -guard, guard) / atlas).rgb;
}
vec3 viewChart(sampler2D tex, vec3 ray) {
  float lon = atan(ray.x, ray.z) / (2.0 * PI) + 0.5;
  float lat = degrees(asin(clamp(ray.y, -1.0, 1.0)));
  vec2 du = vec2(dFdx(lon), dFdy(lon));
  du -= floor(du + 0.5);
  vec2 dLat = vec2(dFdx(lat), dFdy(lat));
  vec2 dUp = vec2(dFdx(ray.y), dFdy(ray.y));
  const float bot = ${bottomLatitude}.0, top = ${topLatitude}.0, blend = ${blendDegrees}.0;
  vec3 band = vec3(0.0);
  if (lat >= bot && lat <= top) {
    float halfTurn = min(floor(lon * 2.0), 1.0);
    vec2 local = vec2(lon * 2.0 - halfTurn, (top - lat) / (top - bot));
    vec4 tile = vec4(0.0, halfTurn * ${horizonTileHeight}.0, ${width}.0, ${horizonTileHeight}.0);
    vec2 dv = -dLat / (top - bot);
    band = viewTile(tex, local, tile, vec2(du.x * 2.0, dv.x), vec2(du.y * 2.0, dv.y));
    if (lat >= bot + blend && lat <= top - blend) return band;
  }
  // Equal-area caps keep more rows near the horizon and cover the zenith and nadir of a bay window.
  bool north = lat > 0.0;
  float upper = north ? 1.0 : ${southLimit.toFixed(9)};
  float lower = north ? ${northLimit.toFixed(9)} : -1.0;
  vec2 local = vec2(lon, (ray.y - upper) / (lower - upper));
  vec2 dv = dUp / (lower - upper);
  vec4 tile = vec4(north ? 0.0 : ${width / 2}.0, ${rowY}.0, ${width / 2}.0, ${height - rowY}.0);
  vec3 cap = viewTile(tex, local, tile, vec2(du.x, dv.x), vec2(du.y, dv.y));
  float bandWeight = north ? 1.0 - smoothstep(top - blend, top, lat) : smoothstep(bot, bot + blend, lat);
  return mix(cap, band, bandWeight);
}
// a texel holds v / (1 + v): back to the village's light (v / k)
vec3 viewLight(sampler2D tex, vec3 ray, float k) {
  vec3 y = min(viewChart(tex, ray), vec3(0.996));
  return y / (1.0 - y) / k;
}
uniform sampler2D uViewDusk;
uniform sampler2D uViewNight;
uniform vec3 uViewWeight;
uniform vec3 uViewK;
uniform float uViewGain;
uniform vec3 uViewEye;
uniform mat3 uViewTurn;
uniform float uViewRadius;
uniform float uViewGround;
varying vec3 vViewWorld;
`;

/** The day / golden-hour / night weights for the clock's look now (barycentric in (night, golden) between the three keys). */
export function windowViewWeights(keys: readonly WindowViewKey[], night: number, golden: number, evening: boolean, into: Vector3): Vector3 {
  if (keys.length < 3) return into.set(1 - night, 0, keys.length > 1 ? night : 0);
  // the morning's golden hour has its sun in the east: the evening's bake would show its glow on the wrong side, so mornings
  // blend the day and the night only
  const g = evening ? golden : 0;
  const [A, B, C] = keys as [WindowViewKey, WindowViewKey, WindowViewKey];
  const det = (B.night - A.night) * (C.golden - A.golden) - (C.night - A.night) * (B.golden - A.golden);
  let wb = ((night - A.night) * (C.golden - A.golden) - (C.night - A.night) * (g - A.golden)) / det;
  let wc = ((B.night - A.night) * (g - A.golden) - (night - A.night) * (B.golden - A.golden)) / det;
  let wa = 1 - wb - wc;
  wa = Math.max(0, wa);
  wb = Math.max(0, wb);
  wc = Math.max(0, wc);
  const s = wa + wb + wc || 1;
  return into.set(wa / s, wb / s, wc / s);
}

/**
 * The village seen through a room's glass: each fragment follows the eye ray out of the pane to the surroundings' proxy (the
 * ground out to WINDOW_VIEW_RADIUS, a cylinder beyond), turns that point into the village's frame around the bake's eye and
 * reads the panoramas there, blended by `uViewWeight` (set each frame from the clock: windowViewWeights).
 * `maps`: day, golden hour, night (a missing one repeats the day). `view`: the room's frame; `origin`: where the room's frame
 * stands in the game (LotRoom.origin). `gain`: 1 / the room's exposure lift (the panorama is the village's light; the room's
 * frame is exposed LOT_ROOM_LIGHT.exposure higher).
 */
export function gardenWindow(maps: readonly (Texture | undefined)[], view: WindowViewRoom | undefined, origin: { x: number; z: number }, gain = 1): MeshBasicMaterial {
  const day = maps[0];
  const material = new MeshBasicMaterial({ name: "M_garden", map: day ?? null, side: DoubleSide, fog: false });
  if (!day || !view) {
    material.color.set("#809489");
    return material;
  }
  const [a, b, c, d] = view.m;
  // a room direction (x, y, z) → the village's: y stays up, the floor plan turns (a proper rotation: no mirror)
  const turn = new Matrix3().set(a, 0, b, 0, 1, 0, c, 0, d);
  const k = view.keys.map((x) => x.k);
  const uniforms = {
    uViewDusk: { value: maps[1] ?? day },
    uViewNight: { value: maps[2] ?? day },
    uViewWeight: { value: new Vector3(1, 0, 0) },
    uViewK: { value: new Vector3(k[0] ?? 1, k[1] ?? k[0] ?? 1, k[2] ?? k[0] ?? 1) },
    uViewGain: { value: gain },
    uViewEye: { value: new Vector3(origin.x + view.eyeRoom[0], view.eyeRoom[1], origin.z + view.eyeRoom[2]) },
    uViewTurn: { value: turn },
    uViewRadius: { value: WINDOW_VIEW_RADIUS },
    uViewGround: { value: 0 },
  };
  material.userData.windowView = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vViewWorld;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vViewWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + chartSampling)
      .replace(
        "#include <map_fragment>",
        /* glsl */ `{
          vec3 dir = normalize(vViewWorld - cameraPosition);
          // from the pane out to the proxy: the cylinder round the bake's eye (we are inside it), or the ground before it
          vec2 rel = vViewWorld.xz - uViewEye.xz;
          float qa = dot(dir.xz, dir.xz), qb = dot(rel, dir.xz), qc = dot(rel, rel) - uViewRadius * uViewRadius;
          float t = 1e6;
          float disc = qb * qb - qa * qc;
          if (qa > 1e-6 && disc > 0.0) t = (-qb + sqrt(disc)) / qa;
          if (dir.y < -1e-4) t = min(t, (uViewGround - vViewWorld.y) / dir.y);
          vec3 seen = t < 1e5 ? vViewWorld + dir * t - uViewEye : dir;
          vec3 ray = normalize(uViewTurn * seen);
          vec3 light = vec3(0.0);
          if (uViewWeight.x > 0.0) light += uViewWeight.x * viewLight(map, ray, uViewK.x);
          if (uViewWeight.y > 0.0) light += uViewWeight.y * viewLight(uViewDusk, ray, uViewK.y);
          if (uViewWeight.z > 0.0) light += uViewWeight.z * viewLight(uViewNight, ray, uViewK.z);
          diffuseColor.rgb *= light * uViewGain;
        }`,
      );
  };
  material.customProgramCacheKey = () => "lot-window-village-view";
  return material;
}
