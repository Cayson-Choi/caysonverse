import type { Material, MeshBasicMaterial } from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { hallNightUniform } from "./hallNight";

/**
 * The memorial hall's glass (케이슨 마을 추모관, review 2026-11-15 round 5): the east bank's cubby doors (`M_glass_e`) and the
 * window and door glass (`M_glass`) are unlit, nearly clear cards in the model (alpha 0.16), so the cubby doors did not read as
 * glass at all — the oak inside looked like a closed wooden door — and the entrance at night was a flat navy slab. The reference
 * (fourpaws_hall_store01_glassdoor) is clear glass you see the cubby through, with the ceiling's light lines and soft sheens
 * reflected in it, stronger at a grazing angle.
 *
 * Shaded here without any new texture: the face's normal from the screen-space derivatives of its world position, a Schlick
 * Fresnel term and soft broad sheens in the reflected direction, so the
 * reflections move as the camera moves. Head-on the glass stays clear (the cubby inside is in plain view); at night the sheens
 * dim with the hall's night weight. Patched once per material (idempotent), like hallNight.ts.
 */

/** The model's glass materials this shades. */
export const HALL_GLASS_MATERIALS: readonly string[] = ["M_glass_e", "M_glass"];

const patched = new WeakSet<Material>();

const VERT_PARS = /* glsl */ `varying vec3 vGlassWorld;
void main() {`;
const VERT_POS = /* glsl */ `#include <project_vertex>
	vec4 glassWorld = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		glassWorld = instanceMatrix * glassWorld;
	#endif
	vGlassWorld = ( modelMatrix * glassWorld ).xyz;`;

const FRAG_PARS = /* glsl */ `varying vec3 vGlassWorld;
uniform float uHallNight;
uniform float uGlassClear;
uniform float uGlassReflect;
uniform float uGlassFocus;
uniform vec4 uPane; // the east bank's run: start x, start z, along x, along z
uniform vec3 uPaneGrid; // pitch, first opening's lower edge (y), glint on (1) / off (0)
void main() {`;

/** Replaces the output: the glass colour and alpha from the view (see the header). */
const FRAG_OUT = /* glsl */ `#include <opaque_fragment>
	{
		vec3 V = normalize( cameraPosition - vGlassWorld );
		vec3 N = normalize( cross( dFdx( vGlassWorld ), dFdy( vGlassWorld ) ) );
		if ( dot( N, V ) < 0.0 ) N = -N;
		float ndv = clamp( dot( N, V ), 0.0, 1.0 );
		float fres = 0.04 + 0.96 * pow( 1.0 - ndv, 5.0 );
		vec3 R = reflect( -V, N );
		// soft broad sheens that slide with the view (the room's light reflected; no hard lines: in a close-up hard ceiling-strip
		// reflections fanned across every door)
		float d = ( vGlassWorld.y + 0.8 * ( vGlassWorld.x + vGlassWorld.z ) ) * 0.9 + R.y * 1.6 + R.x * 1.1;
		float sheen = smoothstep( 0.35, 1.0, sin( d * 3.1416 ) );
		float lit = 1.0 - 0.55 * uHallNight;
		// a glint across each cubby door (the east bank): a soft diagonal band in the pane's own square, as on a real glass door
		float glint = 0.0;
		if ( uPaneGrid.z > 0.5 ) {
			float along = dot( vGlassWorld.xz - uPane.xy, uPane.zw );
			vec2 uv = fract( vec2( along, vGlassWorld.y - uPaneGrid.y ) / uPaneGrid.x );
			float diag = uv.x + uv.y + 0.25 * R.y;
			glint = smoothstep( 0.12, 0.0, abs( diag - 0.82 ) ) * 0.8 + smoothstep( 0.04, 0.0, abs( diag - 1.05 ) ) * 0.35;
			// at night the room's light is low and there is nothing bright to mirror: the glint all but goes (round 7 review: in a
			// night close-up the white diagonal bands read as scratches)
			glint *= 1.0 - 0.85 * uHallNight;
			// and in a cubby close-up by day too (round 8 review: up close the white diagonal band was big and strong, the cubby
			// behind it hard to see — it read as rain): a faint band only, the sheens halved, so the cubby is in plain view
			glint *= 1.0 - 0.8 * uGlassFocus;
		}
		// 2026-11-17 (owner: "유리가 투명했으면 좋겠어. 흐릿해서 사진이 잘 안보이잖아"): clear glass. Head-on almost nothing is
		// added (the photo behind reads sharp); a faint sheen slides over it and the edges catch light only at a grazing angle.
		// In a close-up the sheen nearly goes.
		sheen *= 1.0 - 0.75 * uGlassFocus;
		float a = uGlassClear + 0.45 * fres + ( 0.06 * sheen + 0.08 * glint ) * lit * uGlassReflect;
		vec3 tint = vec3( 0.97, 0.99, 0.99 );
		vec3 col = mix( tint, vec3( 1.0 ), clamp( ( sheen * 0.7 + glint ) * lit, 0.0, 1.0 ) );
		gl_FragColor = vec4( col, clamp( a, 0.0, 0.85 ) );
	}`;

/** The cubby close-up's weight (0 .. 1, cubbyFocus.ts), shared by every patched glass material: MemorialHall writes it each frame. */
export const glassFocusUniform = { value: 0 };

/** How clear the glass is head-on, with no reflection over it (alpha). */
export const GLASS_CLEAR_ALPHA = 0.02;

const E_WALL = VILLAGE_LAYOUT.memorial.interior.cubbyWalls.find((w) => w.bank === "E");
/** The east bank's run on the floor (start, along) and its door grid (pitch, the first opening's lower edge) for the glint. */
const PANE_RUN = E_WALL ? [E_WALL.start.x, E_WALL.start.z, E_WALL.along.x, E_WALL.along.z] : [0, 0, 1, 0];
const PANE_GRID_OFF = [1, 0, 0];

/** Shade one of the hall's glass materials as reflective glass (idempotent). */
export function patchHallGlassMaterial(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const m = material as MeshBasicMaterial;
  m.transparent = true;
  m.depthWrite = false;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHallNight = hallNightUniform;
    shader.uniforms.uGlassClear = { value: GLASS_CLEAR_ALPHA };
    shader.uniforms.uGlassFocus = glassFocusUniform;
    // the cubby doors' sheens in full; the big window and the door (a garden behind them) half as strong
    shader.uniforms.uGlassReflect = { value: m.name === "M_glass_e" ? 1 : 0.5 };
    shader.uniforms.uPane = { value: PANE_RUN };
    // no painted glint bands any more (they read as frost / scratches): the sheen alone, on every bank's doors
    shader.uniforms.uPaneGrid = { value: PANE_GRID_OFF };
    shader.vertexShader = shader.vertexShader.replace("void main() {", VERT_PARS).replace("#include <project_vertex>", VERT_POS);
    shader.fragmentShader = shader.fragmentShader.replace("void main() {", FRAG_PARS).replace("#include <opaque_fragment>", FRAG_OUT);
  };
  m.customProgramCacheKey = () => "hall-glass";
  m.needsUpdate = true;
}

/** Whether `name` is one of the hall's glass materials. */
export function isHallGlass(name: string): boolean {
  return HALL_GLASS_MATERIALS.includes(name);
}
