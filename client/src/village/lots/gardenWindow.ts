import { DoubleSide, MeshBasicMaterial, RepeatWrapping, type Texture } from "three";

/** Each opening samples the same distant garden along the eye ray, including the canted panes of a bay. */
export function gardenWindow(map: Texture | undefined): MeshBasicMaterial {
  if (map) map.wrapS = RepeatWrapping;
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
      .replace("#include <common>", "#include <common>\nvarying vec3 vGardenRay;")
      .replace("#include <map_fragment>", `
        vec3 ray = normalize(vGardenRay);
        vec2 uv = vec2(atan(ray.x, ray.z) / (2.0 * PI) + 0.5, acos(clamp(ray.y, -1.0, 1.0)) / PI);
        // Keep the mip footprint small across the +/-180 degree meridian.
        vec2 dx = dFdx(uv), dy = dFdy(uv);
        dx.x -= floor(dx.x + 0.5);
        dy.x -= floor(dy.x + 0.5);
        diffuseColor.rgb *= textureGrad(map, uv, dx, dy).rgb;`);
  };
  material.customProgramCacheKey = () => "lot-garden-panorama";
  return material;
}
