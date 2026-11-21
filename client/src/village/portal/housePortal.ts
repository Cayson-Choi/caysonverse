import { BufferAttribute, Color, MeshBasicMaterial, Vector4, type BufferGeometry, type Texture } from "three";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";
import { HOUSE_NUMBERS, HOUSE_ROOM } from "@caysonverse/shared/village/houseAreas";
import { HOUSE_A8 } from "@caysonverse/shared/village/houseExterior";
import { EXTERIOR_BODY_A8 } from "@caysonverse/shared/village/exteriorWindows";
import { PORTAL_EYE_Y } from "./portalRooms";
import { PORTAL_PARS, portalShared } from "./interiorPortal";

/**
 * The ten houses' windows (집 외관 A8, village_houses.glb `M_window`: a card behind each pane, merged for all ten houses into one
 * mesh): each window shows its own house's real room on its floor (interiorPortal.ts; the bakes `house_<n>_<floor>`), with sheer
 * curtains drawn to the sides of the pane.
 *
 * One draw for all the houses: each card's vertices carry their house's index (`aPortalHouse`, added before the merge,
 * `tagHouseWindows`). The fragment finds its house's frame (`uPortalHouse[i]`: centre and door-side turn), maps itself and the
 * eye into the house's interior frame (exteriorWindows.ts: x across from the visitor's left, z in from the front wall, y up from
 * the ground floor), picks the floor by height, casts the eye's ray into that floor's room box (10.6 × 3.7 × 7.8) and reads the
 * room's bake from one of the loaded slots (`uPortalSlot[house × 2 + floor]`, InteriorPortals.tsx loads the nearest rooms).
 * A house whose rooms are not loaded shows the dim room of the fallback (by day) or a warm lit one (at night).
 */

/** Texture slots: rooms (house floors) loaded at once. */
export const HOUSE_PORTAL_SLOTS = { pc: 6, phone: 4 } as const;

/** The curtains' look. */
export const HOUSE_CURTAIN = {
  /** Each side's share of the pane's width, tied back (0..0.5). */
  width: 0.17,
  /** Linear colour (a warm off-white linen), lit by the room by day, glowing by its lamps at night. */
  colour: [0.62, 0.56, 0.47] as const,
  /** How see-through the sheer is (0 opaque). */
  sheer: 0.18,
};

const HOUSES = HOUSE_NUMBERS.map((n) => VILLAGE_LAYOUT.sceneryHouses.find((h) => h.id === `house_${n}`)!);
const TURN: Record<string, [number, number]> = { s: [1, 0], n: [-1, 0], e: [0, -1], w: [0, 1] };

/** The slot of each house floor (−1: not loaded), and the slots' textures. Written by InteriorPortals. */
export const housePortal = {
  uPortalHouse: { value: HOUSES.map((h) => new Vector4(h.centre.x, h.centre.z, ...TURN[h.doorSide]!)) },
  uPortalSlot: { value: new Array<number>(HOUSES.length * 2).fill(-1) },
  uPortalSlotTex: { value: new Array<Texture | null>(HOUSE_PORTAL_SLOTS.pc).fill(null) },
  uCurtain: { value: new Color(...HOUSE_CURTAIN.colour) },
};

/** The index of house `id` (house_1 → 0), or −1. */
export function housePortalIndex(id: string): number {
  return HOUSES.findIndex((h) => h.id === id);
}

/** Give the window cards of house `id` their house's index (before they are merged with the other houses'). */
export function tagHouseWindows(geo: BufferGeometry, id: string): void {
  const n = geo.getAttribute("position").count;
  geo.setAttribute("aPortalHouse", new BufferAttribute(new Float32Array(n).fill(housePortalIndex(id)), 1));
}

const f1 = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

const VERT_PARS = /* glsl */ `attribute float aPortalHouse;
varying float vPortalHouse;
varying vec3 vPortalWorld;
void main() {
	vPortalHouse = aPortalHouse;`;
const VERT_WORLD = /* glsl */ `#include <project_vertex>
	vPortalWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`;

function fragPars(slots: number): string {
  const samplers = Array.from({ length: slots }, (_, i) => `uniform sampler2D uPortalSlotTex${i};`).join("\n");
  const taps = Array.from({ length: slots }, (_, i) => `${i ? "else " : ""}if ( s == ${i} ) t = textureGrad( uPortalSlotTex${i}, uv, dx, dy ).rgb;`).join("\n\t");
  return /* glsl */ `
${PORTAL_PARS}
uniform vec4 uPortalHouse[${HOUSES.length}];
uniform float uPortalSlot[${HOUSES.length * 2}];
uniform vec3 uCurtain;
${samplers}
varying float vPortalHouse;
varying vec3 vPortalWorld;
vec3 portalSlotTap( int s, vec2 uv, vec2 dx, vec2 dy ) {
	vec3 t = vec3( 0.0 );
	${taps}
	return portalDecode( t );
}
/** A point in the village → house h's interior frame (x across, y up from the ground floor's floor, z in from the front wall). */
vec3 houseInterior( vec4 h, vec3 v ) {
	vec2 d = v.xz - h.xy;
	float lx = h.z * d.x + h.w * d.y;
	float lz = - h.w * d.x + h.z * d.y;
	return vec3( lx + ${f1(EXTERIOR_BODY_A8.halfWidth)}, v.y - ${f1(HOUSE_A8.floorLift)}, ${f1(EXTERIOR_BODY_A8.front)} - lz );
}
vec3 housePortalColour() {
	float floorOf;
	int hi = int( vPortalHouse + 0.5 );
	vec4 h = uPortalHouse[ hi ];
	vec3 p = houseInterior( h, vPortalWorld );
	vec3 o = houseInterior( h, cameraPosition );
	floorOf = p.y >= ${f1(HOUSE_ROOM.storey - 0.2)} ? 1.0 : 0.0;
	vec3 lift = vec3( 0.0, floorOf * ${f1(HOUSE_ROOM.storey)}, 0.0 );
	p -= lift;
	o -= lift;
	vec3 hit = portalExit( o, p, vec3( 0.0 ), vec3( ${f1(HOUSE_ROOM.width)}, ${f1(HOUSE_ROOM.ceiling)}, ${f1(HOUSE_ROOM.depth)} ) );
	vec3 d = hit - vec3( ${f1(HOUSE_ROOM.width / 2)}, ${f1(PORTAL_EYE_Y)}, ${f1(HOUSE_ROOM.depth / 2)} );
	// the bake's frame (the floor's area: X = origin + x, Z = origin − z)
	d.z = - d.z;
	int s = int( uPortalSlot[ hi * 2 + int( floorOf ) ] + 0.5 );
	if ( uPortalSlot[ hi * 2 + int( floorOf ) ] < -0.5 ) s = -1;
	float n = uPortalNight;
	vec2 uv; vec2 dx; vec2 dy;
	vec3 c = vec3( 0.0 );
	if ( n < 0.999 ) {
		portalUv( d, 0.0, uv, dx, dy );
		c += ( s < 0 ? uPortalFallbackDay / max( uPortalGain.x * uPortalInvExposure, 1e-3 ) : portalSlotTap( s, uv, dx, dy ) ) * ( 1.0 - n ) * uPortalGain.x;
	}
	if ( n > 0.001 ) {
		portalUv( d, 2.0, uv, dx, dy );
		c += ( s < 0 ? uPortalFallbackNight / max( uPortalGain.y * uPortalInvExposure, 1e-3 ) : portalSlotTap( s, uv, dx, dy ) ) * n * uPortalGain.y;
	}
	return c * uPortalInvExposure;
}
`;
}

/**
 * Sheer linen curtains tied back at each side of the pane: the card's UV runs 0..1 across its pane (village_houses.glb), so the
 * curtains are the outer `width` of it, with soft vertical folds; they let a little of the room through (sheer), are lit by the
 * day (dimly: they are inside) and glow warm with the room's lamps at night.
 */
const FRAG_MAIN = /* glsl */ `#include <map_fragment>
	{
		vec3 room = housePortalColour();
		float u = vUv.x;
		float side = min( u, 1.0 - u );
		float w = ${f1(HOUSE_CURTAIN.width)};
		float edge = smoothstep( w, w - 0.03, side );
		float folds = 0.75 + 0.25 * sin( u * 120.0 ) * sin( u * 47.0 + 1.3 );
		float tie = 1.0 - 0.18 * smoothstep( 0.06, 0.0, abs( vUv.y - 0.42 ) );
		vec3 lit = uCurtain * mix( 0.55 * uPortalGain.x, 0.9, uPortalNight ) * folds * tie;
		diffuseColor.rgb = mix( room, mix( lit, room, ${f1(HOUSE_CURTAIN.sheer)} ), edge );
	}`;

/** The houses' window-card material: unlit, the rooms behind the panes. `slots`: how many room textures it can hold. */
export function housePortalMaterial(slots: number, name = "M_window"): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ name, color: 0xffffff });
  // the card's UV is needed for the curtains (three declares vUv when a map is set; a 1×1 stand-in would cost a tap): define it
  m.defines = { USE_UV: "" };
  const own: Record<string, { value: unknown }> = {};
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, portalShared, housePortal, own);
    for (let i = 0; i < slots; i++) {
      shader.uniforms[`uPortalSlotTex${i}`] = { get value() { return housePortal.uPortalSlotTex.value[i] ?? null; } } as never;
    }
    shader.vertexShader = shader.vertexShader.replace("void main() {", VERT_PARS).replace("#include <project_vertex>", VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", fragPars(slots) + "void main() {")
      .replace("#include <map_fragment>", FRAG_MAIN);
  };
  m.customProgramCacheKey = () => `village-house-portal-${slots}`;
  return m;
}
