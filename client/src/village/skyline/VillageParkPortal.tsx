/**
 * 케이슨랜드 seen from the village through its open gate (owner 2026-11-21: the two sides of the gate must agree). Behind the wall the
 * village only has the park's far skyline (a 0.4-scale stand-in for the view over the wall): through the gateway it showed toy tents and
 * a white slab where the real promenade, its shops and the star plaza are.
 *
 * So the gateway is a window onto the REAL park: a ring of photos taken in the park from the spot that corresponds to the forecourt
 * (e2e/probes/gate-park-view-capture.mjs; the park's (40, -194.5) is the village's (-24, 86)), stitched into a cylinder strip, its sky cut
 * out (tools/park-village-view.py --portal). It is drawn on a card standing just behind the gatehouse - but each pixel looks the strip up
 * where its own line of sight meets that cylinder (60 m round the forecourt spot), so the park moves behind the arch as one walks, as a
 * place does and a poster does not. A pixel is drawn only when its line of sight really passes through the gateway (the arch on the gate's
 * line and the wall's gap behind it): from anywhere else the card is not there, and the skyline over the wall is as it was.
 *
 * Cost: one draw call, 2 triangles, three 2048 x 1024 pictures (1024 x 512 on a phone; day, dusk, night).
 */
import { useEffect, useMemo } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import { ClampToEdgeWrapping, LinearFilter, PlaneGeometry, ShaderMaterial, SRGBColorSpace, TextureLoader, Vector2, Vector4, type Texture } from "three";
import { VILLAGE_GATE_PASSAGE, VILLAGE_WALL_FRONT_Z, WALL } from "@caysonverse/shared/village/parkWall";
import { isTouchDevice } from "../../device";
import { dayNight } from "../dayNightDriver";
import { villageViewWeights } from "../../land/ParkVillageView";

/** The strip's cylinder (the stitcher's --portal numbers) round the forecourt spot the photos stand for, and the card behind the gate. */
export const PARK_PORTAL = Object.freeze({
  eye: { x: -24, z: 86 },
  radius: 60,
  bottom: 0,
  top: 40,
  spanDeg: 120,
  /** The card: its plane (behind the gatehouse's turnstile canopy, in front of the skyline's stand-in), half width and height. */
  z: 101.7,
  halfWidth: 10,
  height: 18,
  /** The two openings a line of sight must pass: the arch on the gate's line and the wall's gap (z, top). */
  arch: { z: 93.8, top: 7.5 },
  gap: { z: VILLAGE_WALL_FRONT_Z + 2 * WALL.halfThickness, top: 9.5 },
});

const urls = (low: boolean) => ["day", "dusk", "night"].map((t) => `/textures/park/park_view_${t}${low ? "_1k" : ""}.webp`);

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */ `
uniform sampler2D tDay;
uniform sampler2D tDusk;
uniform sampler2D tNight;
uniform vec3 uW;
uniform vec4 uEye;      // x, z of the strip's centre, its radius, its span (rad)
uniform vec2 uHeights;  // bottom, top
uniform vec4 uPassage;  // minX, maxX of the gateway, the arch's z, the arch's top
uniform vec2 uGap;      // the wall gap's z, its top
varying vec3 vWorld;
void main() {
  vec3 d = vWorld - cameraPosition;
  if ( d.z <= 0.01 ) discard; // only from the village's side
  // the line of sight must pass the arch and the wall's gap
  float tA = ( uPassage.z - cameraPosition.z ) / d.z;
  float tG = ( uGap.x - cameraPosition.z ) / d.z;
  vec3 a = cameraPosition + d * tA;
  vec3 g = cameraPosition + d * tG;
  if ( tA < 0.0 || a.x < uPassage.x || a.x > uPassage.y || a.y > uPassage.w ) discard;
  if ( g.x < uPassage.x || g.x > uPassage.y || g.y > uGap.y ) discard;
  // where it meets the strip's cylinder
  vec2 o = cameraPosition.xz - uEye.xy;
  vec2 dir = normalize( d.xz );
  float b = dot( o, dir );
  float c = dot( o, o ) - uEye.z * uEye.z;
  float t = - b + sqrt( max( b * b - c, 0.0 ) );
  vec2 h = o + dir * t;
  float y = cameraPosition.y + d.y * ( t / length( d.xz ) );
  // bearing from south (+z), positive toward west (-x): the photos' own
  float u = atan( - h.x, h.y ) / uEye.w + 0.5;
  float v = clamp( ( y - uHeights.x ) / ( uHeights.y - uHeights.x ), 0.003, 0.997 );
  vec2 uv = vec2( clamp( u, 0.002, 0.998 ), v );
  vec4 p = texture2D( tDay, uv );
  vec4 q = texture2D( tDusk, uv );
  vec4 n = texture2D( tNight, uv );
  float al = p.a * uW.x + q.a * uW.y + n.a * uW.z;
  // the strip's sky is cut out: there the village's own sky (and the park's far skyline over the wall) shows
  if ( al < 0.5 || u < 0.0 || u > 1.0 ) discard;
  vec3 col = ( p.rgb * p.a * uW.x + q.rgb * q.a * uW.y + n.rgb * n.a * uW.z ) / al;
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}`;

export function VillageParkPortal() {
  const maps = useLoader(TextureLoader, urls(isTouchDevice)) as Texture[];
  const P = PARK_PORTAL;
  const geo = useMemo(() => new PlaneGeometry(P.halfWidth * 2, P.height).rotateY(Math.PI).translate((VILLAGE_GATE_PASSAGE.minX + VILLAGE_GATE_PASSAGE.maxX) / 2, P.height / 2, P.z), [P]);
  const mat = useMemo(() => {
    for (const t of maps) {
      t.colorSpace = SRGBColorSpace;
      t.wrapS = t.wrapT = ClampToEdgeWrapping;
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = LinearFilter;
      t.needsUpdate = true;
    }
    return new ShaderMaterial({
      name: "M_village_park_portal",
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tDay: { value: maps[0] },
        tDusk: { value: maps[1] },
        tNight: { value: maps[2] },
        uW: { value: [1, 0, 0] },
        uEye: { value: new Vector4(P.eye.x, P.eye.z, P.radius, (P.spanDeg * Math.PI) / 180) },
        uHeights: { value: new Vector2(P.bottom, P.top) },
        uPassage: { value: new Vector4(VILLAGE_GATE_PASSAGE.minX, VILLAGE_GATE_PASSAGE.maxX, P.arch.z, P.arch.top) },
        uGap: { value: new Vector2(P.gap.z, P.gap.top) },
      },
      fog: false,
      toneMapped: false,
    });
  }, [maps, P]);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame(() => {
    const w = villageViewWeights(dayNight.applied.night);
    const u = mat.uniforms.uW!.value as number[];
    u[0] = w[0];
    u[1] = w[1];
    u[2] = w[2];
  });
  return <mesh geometry={geo} material={mat} name="village_park_portal" />;
}
