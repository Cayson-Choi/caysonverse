import { DoubleSide, MeshBasicMaterial, type Texture } from "three";
import layout from "./gardenChart.json";

const { width, height, horizonTileHeight, gutter, bottomLatitude, topLatitude, blendDegrees } = layout;
const rowY = 2 * horizonTileHeight;
const radians = Math.PI / 180;
const northLimit = Math.sin((topLatitude - blendDegrees) * radians);
const southLimit = Math.sin((bottomLatitude + blendDegrees) * radians);

// Gradients come from the continuous eye ray. Clamp their texel footprint to a tile's guard pixels so a mip
// or an anisotropic tap cannot pull the other half of the horizon into a pane across the longitude seam.
const gardenSampling = /* glsl */ `
vec3 gardenTile(sampler2D tex, vec2 local, vec4 tile, vec2 dx, vec2 dy) {
  const vec2 atlas = vec2(${width}.0, ${height}.0);
  const float guard = ${gutter}.0;
  vec2 span = tile.zw - 2.0 * guard;
  vec2 uv = (tile.xy + guard + clamp(local, 0.0, 1.0) * span) / atlas;
  return textureGrad(tex, uv, clamp(dx * span, -guard, guard) / atlas, clamp(dy * span, -guard, guard) / atlas).rgb;
}
vec3 gardenColour(sampler2D tex, vec3 ray) {
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
    band = gardenTile(tex, local, tile, vec2(du.x * 2.0, dv.x), vec2(du.y * 2.0, dv.y));
    if (lat >= bot + blend && lat <= top - blend) return band;
  }
  // Equal-area caps keep more rows near the horizon and cover the zenith and nadir of a bay window.
  bool north = lat > 0.0;
  float upper = north ? 1.0 : ${southLimit.toFixed(9)};
  float lower = north ? ${northLimit.toFixed(9)} : -1.0;
  vec2 local = vec2(lon, (ray.y - upper) / (lower - upper));
  vec2 dv = dUp / (lower - upper);
  vec4 tile = vec4(north ? 0.0 : ${width / 2}.0, ${rowY}.0, ${width / 2}.0, ${height - rowY}.0);
  vec3 cap = gardenTile(tex, local, tile, vec2(du.x, dv.x), vec2(du.y, dv.y));
  float bandWeight = north ? 1.0 - smoothstep(top - blend, top, lat) : smoothstep(bot, bot + blend, lat);
  return mix(cap, band, bandWeight);
}
`;

/** Each opening samples the same complete garden sphere along the eye ray, including canted panes. */
export function gardenWindow(map: Texture | undefined): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ name: "M_garden", map: map ?? null, side: DoubleSide, fog: false });
  if (!map) {
    material.color.set("#809489");
    return material;
  }
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGardenRay;")
      .replace("#include <project_vertex>", `#include <project_vertex>
        vGardenRay = (modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGardenRay;\n" + gardenSampling)
      .replace("#include <map_fragment>", "diffuseColor.rgb *= gardenColour(map, normalize(vGardenRay));");
  };
  material.customProgramCacheKey = () => "lot-garden-horizon-and-caps";
  return material;
}
