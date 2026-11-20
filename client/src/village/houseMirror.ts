import { Color, ShaderMaterial } from "three";
import { houseNightUniform } from "./houseNight";

/**
 * The glass of the houses' round and arched wall mirrors (owner 2026-11-20: "왜 이런 원들이 여기 저기 있는거야": the old mirror glass was
 * the windows' 84 % see-through `M_glass`, so a mirror looked like an empty brass hoop on the wall). The kit now builds mirror glass in
 * its own opaque material, `M_mirror` (houses 1–5) / `E_H_mirror` (houses 6–10), and the game draws it as silvered glass: a small
 * shader that reflects a painted room — warm lit ceiling, cream walls at the horizon, two bright windows and a door's glass round the
 * azimuth, a wooden floor, a soft diagonal sheen — along the REAL reflection vector, so the reflection moves as the viewer walks and
 * reads as glass, not as a grey disc. The face's normal comes from screen-space derivatives (the export's normals are not the faces').
 * A cool tint, a slightly darker rim by the Fresnel term; the night dims the room in the glass.
 */
export const HOUSE_MIRROR_MATERIALS: ReadonlySet<string> = new Set(["M_mirror", "E_H_mirror"]);

let shared: ShaderMaterial | null = null;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform float uNight;
uniform vec3 uTint;
varying vec3 vWorld;
vec3 room(vec3 r) {
  float up = r.y;
  vec3 ceil = vec3(0.98, 0.93, 0.84);
  vec3 wall = vec3(0.86, 0.76, 0.62);
  vec3 floorC = vec3(0.43, 0.30, 0.19);
  vec3 c = mix(wall, ceil, smoothstep(0.05, 0.55, up));
  c = mix(c, floorC, smoothstep(-0.05, -0.45, up));
  float az = atan(r.x, r.z);
  // two tall windows and a glazed door round the room (bright, a little blue), only at wall height
  float band = smoothstep(-0.22, -0.1, up) * (1.0 - smoothstep(0.32, 0.5, up));
  float w1 = smoothstep(0.30, 0.22, abs(az - 0.9));
  float w2 = smoothstep(0.30, 0.22, abs(az + 1.1));
  float w3 = smoothstep(0.42, 0.34, abs(abs(az) - 2.6));
  c = mix(c, vec3(0.93, 0.97, 1.0), clamp(w1 + w2, 0.0, 1.0) * band);
  c = mix(c, vec3(1.0, 0.97, 0.9), w3 * band * 0.9);
  // a dark piece of furniture low down
  c *= 1.0 - 0.35 * smoothstep(0.18, 0.1, abs(az - 2.0)) * smoothstep(-0.05, -0.12, up) * smoothstep(-0.42, -0.3, up);
  return c;
}
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 v = normalize(vWorld - cameraPosition);
  if (dot(n, v) > 0.0) n = -n;
  vec3 r = reflect(v, n);
  vec3 c = room(r) * uTint;
  float f = pow(1.0 - clamp(dot(n, -v), 0.0, 1.0), 2.0);
  c *= 1.0 - 0.28 * f;                                   // edge-on: darker (the silvering's fall-off)
  float sheen = smoothstep(0.82, 0.97, dot(r, normalize(vec3(0.55, 0.35, 0.6))));
  c += 0.08 * sheen;                                      // a faint diagonal glint
  c *= mix(1.0, 0.32, uNight);                            // the room is dim at night: so is its reflection
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The one shared mirror material (every house, every mirror). */
export function houseMirrorMaterial(): ShaderMaterial {
  if (shared) return shared;
  const m = new ShaderMaterial({
    name: "house_mirror",
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uNight: houseNightUniform, uTint: { value: new Color(0.84, 0.92, 0.94) } },
    toneMapped: true,
  });
  m.userData.shared = true;
  shared = m;
  return m;
}

/** Whether `name` is a house's mirror-glass material. */
export function isHouseMirrorMaterial(name: string): boolean {
  return HOUSE_MIRROR_MATERIALS.has(name);
}
