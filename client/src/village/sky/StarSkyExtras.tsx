import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  DoubleSide,
  Matrix3,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { equatorialUnit, moonAt, refract, applyMat3, type MoonPosition, type Vec3 } from "@caysonverse/shared/village/skyMath";
import { STAR_SPHERE } from "./starShader";
import { sky } from "./skyRuntime";

/** The Milky Way's pole and centre (J2000: NGP 12h51.4m +27°07.7', galactic centre 17h45.7m -28°56'). */
const NGP = equatorialUnit((192.85948 * Math.PI) / 180, (27.12825 * Math.PI) / 180);
const GC = equatorialUnit((266.40499 * Math.PI) / 180, (-28.93617 * Math.PI) / 180);

/** The moon's drawn radius: the real 0.26° drawn 1.6x (a true-size moon reads as a dot on a phone). */
export const MOON_RADIUS_DEG = 0.42;
const MOON_SPHERE_R = 1380;

/** The current moon (recomputed every 30 s of village time) and its apparent altitude. */
export const moonState: { at: number; moon: MoonPosition | null; alt: number } = { at: -Infinity, moon: null, alt: -90 };

export function currentMoon(utcMs: number): MoonPosition {
  if (!moonState.moon || Math.abs(utcMs - moonState.at) > 30_000) {
    moonState.moon = moonAt(utcMs);
    moonState.at = utcMs;
  }
  return moonState.moon;
}

/** The moon's apparent scene direction (parallax and refraction in) into `out`. */
export function moonDirection(m: MoonPosition, out: Vec3 = [0, 0, 0]): Vec3 {
  applyMat3(sky.matrix, m.eq[0], m.eq[1], m.eq[2], out);
  out[1] -= Math.sin((m.parallaxDeg * Math.PI) / 180);
  const l = Math.hypot(out[0], out[1], out[2]) || 1;
  out[0] /= l;
  out[1] /= l;
  out[2] /= l;
  return refract(out);
}

const MW_VERTEX = /* glsl */ `
uniform vec3 uCentre;
uniform float uRadius;
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec3 o = cameraPosition - uCentre;
  float b = dot(o, vDir);
  float c2 = dot(o, o) - uRadius * uRadius;
  float t = -b + sqrt(max(b * b - c2, 0.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + vDir * t, 1.0);
}
`;

const MW_FRAGMENT = /* glsl */ `
uniform mat3 uSky;
uniform vec3 uNgp;
uniform vec3 uGc;
uniform float uWeight;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

void main() {
  vec3 d = normalize(vDir);
  if (d.y < 0.0 || uWeight < 0.002) discard;
  vec3 eq = d * uSky; // the transpose: scene -> J2000 equatorial
  float b = asin(clamp(dot(eq, uNgp), -1.0, 1.0)) * 57.29578;
  float cenDot = dot(eq, uGc);
  // brightest toward Sagittarius / Scutum, thin toward Auriga / Gemini (the anticentre)
  float along = 0.28 + 0.72 * pow(0.5 + 0.5 * cenDot, 1.6);
  float width = mix(7.0, 11.0, 0.5 + 0.5 * cenDot);
  float band = exp(-(b * b) / (width * width));
  float core = exp(-(b * b) / (3.2 * 3.2));
  float n1 = vnoise(eq * 9.0);
  float n2 = vnoise(eq * 21.0 + 3.7);
  float n3 = vnoise(eq * 46.0 + 9.1);
  float clump = 0.38 + 1.0 * n1 * n2 + 0.28 * n1 + 0.45 * n3 * n2;
  // the Great Rift splits the band toward Cygnus and Sagittarius
  float lane = 1.0 - 0.55 * exp(-pow((b - 1.5 * sin(eq.y * 9.0)) / 1.6, 2.0)) * smoothstep(-0.2, 0.6, cenDot) * (0.5 + 0.5 * n2);
  float v = (band * 0.75 + core * 0.55) * along * clump * lane;
  v *= smoothstep(0.0, 0.18, d.y); // thick air near the horizon
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(0.95, 0.88, 0.75), clamp(cenDot * 0.5 + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col * v * 0.058 * uWeight, 1.0);
  #include <colorspace_fragment>
}
`;

/** The Milky Way: a faint additive band from the galactic plane's real place in the J2000 sky (the star matrix turns it). */
function MilkyWay() {
  const mesh = useMemo(() => {
    const m = new ShaderMaterial({
      uniforms: {
        uCentre: { value: new Vector3(...STAR_SPHERE.centre) },
        uRadius: { value: STAR_SPHERE.radius },
        uSky: { value: new Matrix3() },
        uNgp: { value: new Vector3(...NGP) },
        uGc: { value: new Vector3(...GC) },
        uWeight: { value: 0 },
      },
      vertexShader: MW_VERTEX,
      fragmentShader: MW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const o = new Mesh(new SphereGeometry(1, 40, 24, 0, Math.PI * 2, 0, Math.PI / 2 + 0.1), m);
    o.name = "village_milky_way";
    o.frustumCulled = false;
    o.renderOrder = -3;
    o.visible = false;
    return o;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    },
    [mesh],
  );
  useFrame(() => {
    const u = (mesh.material as ShaderMaterial).uniforms;
    const m = sky.matrix;
    (u.uSky!.value as Matrix3).set(m[0]!, m[1]!, m[2]!, m[3]!, m[4]!, m[5]!, m[6]!, m[7]!, m[8]!);
    // only under a dark sky (the twilight's limit must reach ~4.5); a bright moon washes it out
    const dark = Math.min(1, Math.max(0, (sky.limit - 3.2) / 2.0));
    const moon = moonState.moon;
    const wash = moon && moonState.alt > 0 ? 1 - 0.75 * moon.illuminated * Math.min(1, moonState.alt / 15) : 1;
    u.uWeight!.value = sky.fade > 0.01 ? dark * wash : 0;
    mesh.visible = (u.uWeight!.value as number) > 0.003;
  });
  return <primitive object={mesh} />;
}

const MOON_VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy * 2.0; // the plane of size 1 -> -1..1
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MOON_FRAGMENT = /* glsl */ `
uniform vec2 uSun;      // unit direction to the sun in the plane's (right, up) frame
uniform float uCosElong;
uniform float uWeight;
uniform float uScale;   // plane half-size / disc radius
varying vec2 vP;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float blob(vec2 p, vec2 c, float k) { vec2 q = p - c; return exp(-dot(q, q) * k); }

void main() {
  vec2 p = vP * uScale;     // in disc radii
  float r = length(p);
  vec3 tint = vec3(1.0, 0.96, 0.88);
  vec3 outc = tint * (0.16 / (1.0 + r * r * 1.8)); // the soft glow round the moon
  if (r < 1.0) {
    float disc = 1.0 - smoothstep(0.93, 1.0, r);
    float chord = sqrt(max(1.0 - r * r, 0.0));
    float along = dot(p, uSun);
    float perp = abs(p.x * uSun.y - p.y * uSun.x);
    float edge = uCosElong * sqrt(max(1.0 - perp * perp, 0.0));
    float lit = smoothstep(edge - 0.035, edge + 0.035, along);
    float m = blob(p, vec2(-0.30, 0.35), 9.0) + 0.9 * blob(p, vec2(0.05, 0.28), 11.0) + 0.8 * blob(p, vec2(0.38, 0.30), 14.0)
            + 0.7 * blob(p, vec2(-0.08, -0.05), 12.0) + 0.6 * blob(p, vec2(0.25, -0.02), 16.0) + 0.6 * blob(p, vec2(-0.45, 0.02), 10.0);
    float grain = vnoise(p * 7.0) * 0.5 + vnoise(p * 17.0) * 0.5;
    float albedo = 0.95 - 0.30 * clamp(m, 0.0, 1.0) - 0.10 * grain;
    float limb = 0.82 + 0.18 * chord;
    float earthshine = 0.035;
    outc += tint * albedo * limb * (earthshine + (1.0 - earthshine) * lit) * disc * 1.15;
  }
  gl_FragColor = vec4(outc * uWeight, 1.0);
  #include <colorspace_fragment>
}
`;

const HALO = 5; // the plane's half-size in disc radii

/** The real moon: drawn at its place with its phase (lit side toward the sun), under the same twilight as the stars. */
function SkyMoon() {
  const mesh = useMemo(() => {
    const m = new ShaderMaterial({
      uniforms: {
        uSun: { value: new Vector2(1, 0) },
        uCosElong: { value: 1 },
        uWeight: { value: 0 },
        uScale: { value: HALO },
      },
      vertexShader: MOON_VERTEX,
      fragmentShader: MOON_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const o = new Mesh(new PlaneGeometry(1, 1), m);
    o.name = "village_moon";
    o.frustumCulled = false;
    o.renderOrder = -1;
    o.visible = false;
    return o;
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as ShaderMaterial).dispose();
    },
    [mesh],
  );
  const tmp = useMemo(() => ({ d: [0, 0, 0] as Vec3, s: [0, 0, 0] as Vec3, basis: new Matrix4() }), []);
  useFrame(({ camera }) => {
    if (!sky.catalog) {
      mesh.visible = false;
      return;
    }
    const moon = currentMoon(sky.utcMs);
    const d = moonDirection(moon, tmp.d);
    moonState.alt = (Math.asin(Math.max(-1, Math.min(1, d[1]))) * 180) / Math.PI;
    const weight = sky.fade * Math.min(1, Math.max(0, (moonState.alt + 0.5) / 4));
    if (weight < 0.003) {
      mesh.visible = false;
      return;
    }
    const u = (mesh.material as ShaderMaterial).uniforms;
    // the sun's direction in the scene, its tangent at the moon
    const sd = applyMat3(sky.matrix, moon.sunEq[0], moon.sunEq[1], moon.sunEq[2], tmp.s);
    const dot = sd[0] * d[0] + sd[1] * d[1] + sd[2] * d[2];
    const sx = sd[0] - dot * d[0];
    const sy = sd[1] - dot * d[1];
    const sz = sd[2] - dot * d[2];
    // the plane's frame: z toward the camera (-d), y = the zenith's tangent at the moon, x = y × z
    const zx = -d[0], zy = -d[1], zz = -d[2];
    let yx = -d[1] * d[0];
    let yy = 1 - d[1] * d[1];
    let yz = -d[1] * d[2];
    const yl = Math.hypot(yx, yy, yz) || 1;
    yx /= yl;
    yy /= yl;
    yz /= yl;
    const xx = yy * zz - yz * zy;
    const xy = yz * zx - yx * zz;
    const xz = yx * zy - yy * zx;
    tmp.basis.set(xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, 0, 0, 0, 1);
    mesh.quaternion.setFromRotationMatrix(tmp.basis);
    // on the stars' ray sphere from the camera
    const ox = camera.position.x - STAR_SPHERE.centre[0];
    const oy = camera.position.y - STAR_SPHERE.centre[1];
    const oz = camera.position.z - STAR_SPHERE.centre[2];
    const b = ox * d[0] + oy * d[1] + oz * d[2];
    const c2 = ox * ox + oy * oy + oz * oz - MOON_SPHERE_R * MOON_SPHERE_R;
    const t = -b + Math.sqrt(Math.max(b * b - c2, 0));
    mesh.position.set(camera.position.x + d[0] * t, camera.position.y + d[1] * t, camera.position.z + d[2] * t);
    mesh.scale.setScalar(2 * Math.tan((MOON_RADIUS_DEG * Math.PI) / 180) * t * HALO);
    (u.uSun!.value as Vector2).set(sx * xx + sy * xy + sz * xz, sx * yx + sy * yy + sz * yz).normalize();
    u.uCosElong!.value = Math.cos((moon.elongationDeg * Math.PI) / 180);
    u.uWeight!.value = weight;
    mesh.visible = true;
  });
  return <primitive object={mesh} />;
}

/** The Milky Way and the moon (with the stars; the hills and houses hide them by depth). */
export function SkyExtras() {
  return (
    <>
      <MilkyWay />
      <SkyMoon />
    </>
  );
}
