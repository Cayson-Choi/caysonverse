import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, type Texture, Vector3 } from "three";
import { lampPositions, CAFE_CENTRE } from "./cafeLayout";

/**
 * The furniture's light. The café's room is lit by its own baked light map (day: window light and soft lamps; night: the
 * warm pendants), which a live mesh cannot read, and the scene's sun must not shine through the roof onto it. So these
 * surfaces are lit by a small model of the room itself, in world space: a sky/floor ambient that follows the day and night
 * (`uNight`, `uDay`), the window light entering from the glass front and the side walls, the lamps (the baked three pendants
 * and the new ones; weak by day, full when the village's lights are on: `uLit`), a faint sheen from them, and a floor
 * contact darkening. No scene lights are read (a MeshBasicMaterial), so the room costs no light passes.
 */
export const cafeUniforms = {
  uNight: { value: 0 },
  uDay: { value: 1 },
  uLit: { value: 0 },
  uLamps: { value: lampPositions().map((p) => new Vector3(CAFE_CENTRE.x - p.z, p.y, CAFE_CENTRE.z + p.x)) },
  uAmbDay: { value: new Color(0.46, 0.425, 0.385) },
  uAmbNight: { value: new Color(0.05, 0.055, 0.085) },
  uLampColor: { value: new Color(1.0, 0.64, 0.34) },
};
export const LAMP_COUNT = cafeUniforms.uLamps.value.length;

const VERT_PARS = /* glsl */ `attribute vec2 aMat;
varying vec3 vCP;
varying vec3 vCN;
varying vec2 vCM;`;

const VERT_WORLD = /* glsl */ `#include <begin_vertex>
vec4 cwp = vec4( transformed, 1.0 );
vec3 cwn = normal;
#ifdef USE_INSTANCING
	cwp = instanceMatrix * cwp;
	cwn = mat3( instanceMatrix ) * cwn;
#endif
cwp = modelMatrix * cwp;
vCP = cwp.xyz;
vCN = normalize( mat3( modelMatrix ) * cwn );
vCM = aMat;`;

const FRAG_PARS = /* glsl */ `varying vec3 vCP;
varying vec3 vCN;
varying vec2 vCM;
uniform float uNight;
uniform float uDay;
uniform float uLit;
uniform vec3 uLamps[${LAMP_COUNT}];
uniform vec3 uAmbDay;
uniform vec3 uAmbNight;
uniform vec3 uLampColor;
vec3 cafeShade( vec3 albedo, vec3 n, vec3 p, vec2 m ) {
	// sky and floor ambient (the ceiling side brighter, the floor side bounced and dimmer)
	vec3 amb = mix( uAmbDay, uAmbNight, uNight );
	amb *= mix( 0.62, 1.0, n.y * 0.5 + 0.5 );
	// window light: the glass front (west, -x) and the side walls (+-z) throw daylight across the room
	float wl = max( dot( n, normalize( vec3( -1.0, 0.25, 0.0 ) ) ), 0.0 ) * 0.34
		+ max( dot( n, normalize( vec3( 0.0, 0.25, 1.0 ) ) ), 0.0 ) * 0.12
		+ max( dot( n, normalize( vec3( 0.0, 0.25, -1.0 ) ) ), 0.0 ) * 0.12;
	vec3 sky = vec3( 0.95, 0.9, 0.82 ) * wl * uDay;
	// contact darkening: the floor and the wall feet are darker, the ceiling a little
	float ao = mix( 0.58, 1.0, smoothstep( 0.0, 0.3, p.y ) ) * mix( 1.0, 0.82, smoothstep( 3.2, 4.3, p.y ) );
	// lamps: weak by day (a café has them on), full when the village's lights are on
	float lampK = 0.4 + 1.25 * uLit;
	vec3 V = normalize( cameraPosition - p );
	vec3 lampSum = vec3( 0.0 );
	vec3 spec = vec3( 0.0 );
	for ( int i = 0; i < ${LAMP_COUNT}; i ++ ) {
		vec3 d = uLamps[ i ] - p;
		float d2 = dot( d, d );
		vec3 L = d * inversesqrt( max( d2, 1e-4 ) );
		float att = 1.0 / ( 1.0 + d2 * 0.55 );
		float nl = max( dot( n, L ), 0.0 ) * 0.8 + 0.2 * max( dot( n, L ) * 0.5 + 0.5, 0.0 );
		lampSum += uLampColor * ( att * nl );
		vec3 H = normalize( L + V );
		spec += uLampColor * ( att * pow( max( dot( n, H ), 0.0 ), 28.0 ) );
	}
	vec3 lit = albedo * ( ( amb + sky ) * ao + lampSum * lampK * mix( 0.8, 1.0, ao ) ) + spec * lampK * m.y * 0.9;
	// bulbs and lamp glass glow (a little by day, bright at night: the rich tier's bloom picks them up)
	lit = mix( lit, albedo * ( 0.8 + 1.6 * uLit ) * m.x, step( 0.01, m.x ) * clamp( m.x * 1.2, 0.0, 1.0 ) );
	return lit;
}`;

const FRAG_LIGHT = /* glsl */ `{
	vec3 cn = normalize( vCN );
	#ifdef DOUBLE_SIDED
		if ( ! gl_FrontFacing ) cn = - cn;
	#endif
	outgoingLight = cafeShade( diffuseColor.rgb, cn, vCP, vCM );
}
#include <opaque_fragment>`;

// A local reflection probe photographed from the glass at noon and night (two 640 × 400 images packed vertically).
// Intersecting the reflected ray with the room first keeps the counter and shelving in place as the viewer shifts.
const MIRROR = /* glsl */ `uniform sampler2D uMirrorProbe;
vec3 roomReflection(vec3 surface) {
  const vec3 probe = vec3(46.94, 1.75, -9.10);
  const vec3 roomMin = vec3(46.90, 0.0, -21.90);
  const vec3 roomMax = vec3(54.70, 4.3, -8.30);
  vec3 ray = reflect(normalize(surface - cameraPosition), vec3(1., 0., 0.));
  vec3 dir = mix(vec3(-1.), vec3(1.), step(vec3(0.), ray));
  vec3 t = (mix(roomMin, roomMax, step(vec3(0.), ray)) - surface) / (dir * max(abs(ray), vec3(1e-5)));
  vec3 sampleRay = surface + ray * min(t.x, min(t.y, t.z)) - probe;
  // The source camera looks along +X. Its right vector is +Z, vertical FOV 115 degrees, aspect 1.6.
  vec2 uv = 0.5 + 0.5 * vec2(sampleRay.z / 1.6, sampleRay.y) / (max(sampleRay.x, 1e-4) * 1.5696856);
  uv = clamp(uv, vec2(0.003), vec2(0.997));
  vec3 noon = texture2D(uMirrorProbe, vec2(uv.x, 0.5 + 0.5 * uv.y)).rgb;
  vec3 night = texture2D(uMirrorProbe, vec2(uv.x, 0.5 * uv.y)).rgb;
  return mix(noon, night, uNight) * vec3(0.91, 0.94, 0.93);
}`;

/** A MeshBasicMaterial lit by the room's model (see above): vertex colours, optionally a map, double-sided. */
export function cafeMaterial(key: string, map: Texture | null = null, mirror: Texture | null = null): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, map });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cafeUniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${VERT_PARS}`).replace("#include <begin_vertex>", VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${FRAG_PARS}`).replace("#include <opaque_fragment>", FRAG_LIGHT);
    if (mirror) {
      shader.uniforms.uMirrorProbe = { value: mirror };
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", MIRROR + "\nvoid main() {")
        .replace("#include <opaque_fragment>", "if (vCM.y > 0.99) outgoingLight = roomReflection(vCP);\n#include <opaque_fragment>");
    }
  };
  m.customProgramCacheKey = () => `cafe-room-${key}-${LAMP_COUNT}-${mirror ? "probe" : "plain"}`;
  return m;
}

/** Soft contact shadows under the furniture (dark, multiplied by the disc's alpha). */
export function blobMaterial(disc: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: 0x000000, map: disc, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

/** The warm light of a pendant on the floor under it (additive), strength follows the lights. */
export function poolMaterial(disc: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: new Color(1.0, 0.62, 0.3), map: disc, transparent: true, blending: AdditiveBlending, opacity: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
}
