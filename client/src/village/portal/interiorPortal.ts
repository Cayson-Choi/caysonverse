import { BackSide, BoxGeometry, Color, Mesh, MeshBasicMaterial, Vector2, Vector3, Vector4, type Material, type Texture } from "three";
import layout from "./portalAtlas.json";
import bakes from "./portalBakes.json";
import type { PortalRoom } from "./portalRooms";

/**
 * Interior portals: the REAL room behind a window or an open door, seen from the village (clear glass, owner 2026-11-21:
 * "모든 유리창을 투명하게 만들어 건물 밖에서도 유리창을 통해서 안이 보이게"; and the temple's open door showed a brown backdrop).
 *
 * A building's room is a separate scene far away, so the glass cannot simply see through. Each room is baked instead
 * (e2e/interior-portal-bake.mjs: a cube from the middle of the room, at noon and at night, in the room's own light and exposure)
 * into one small KTX2 atlas (portal_atlas.mjs, portalAtlas.json's layout). A surface behind the glass or the doorway — a box the
 * size of the room inside a lot's shell (`portalBoxMesh`), or a house's window card (`patchHousePortal`) — casts the eye's ray into
 * the room's box (in the room's own frame, portalRooms.ts), takes the point on the far wall, floor or ceiling it meets, and reads
 * the cube in that point's direction from the bake's eye: the classic box-projected cube map. So the far wall, the floor and the
 * ceiling stand where they really are, the doorway shows the hall in perspective, and the view slides as one walks past. Things in
 * the middle of the room (a pillar, the altar) are drawn where the bake's eye saw them — a small error from the door, none from the
 * middle.
 *
 * Light: a texel holds w / (1 + w) (w = the room's light × the exposure it is seen at inside); the shader returns w ÷ the village's
 * exposure × a gain — by day the room is a little darker than the street (PORTAL_LOOK.dayGain: an unlit interior reads dim from a
 * sunny street, research: 20–50 % of the room's detail), at night its lamps glow warm through the glass. Dusk mixes the noon and
 * night bakes by the village's `lights` weight.
 *
 * Cost: one texture tap (two at dusk) and a few dozen ALU per fragment of a portal surface, which only shows through openings; a
 * box is 12 triangles and one draw. Textures are loaded only for rooms near the camera (InteriorPortals.tsx) — 0.5–1.1 MB each on
 * the GPU (BC7 / ASTC / ETC2 from Basis).
 *
 * Reuse (the café, feat/cafe-real): `portalBoxMesh(room, shared)` with a PortalRoom of the café's room (`lotPortalRoom` of
 * `lot_cafe_room`) and its bake (`--only=lot_cafe_room`), or `patchPortal(material, uniforms)` on any card behind its glass;
 * `clearGlass` (clearGlass.ts) for the panes themselves.
 */

export const PORTAL_LOOK = {
  /** How bright the room reads from outside by day (× its own look inside, against the village's exposure). */
  dayGain: 0.55,
  /** … and at night (its lamps on, the street dark). */
  nightGain: 1.0,
  /** Before a room's bake has loaded: a dim warm room by day, a lit one by night (linear). */
  fallbackDay: [0.035, 0.03, 0.026] as const,
  fallbackNight: [0.42, 0.24, 0.1] as const,
} as const;

export interface PortalBake {
  file: string;
  keys: Array<{ id: string; time: string; exposure: number }>;
}
export const PORTAL_BAKES = (bakes as { rooms: Record<string, PortalBake> }).rooms;

/** The uniforms every portal shares (one write per frame reaches all): the night weight, 1 / the village's exposure, the gains. */
export const portalShared = {
  uPortalNight: { value: 0 },
  uPortalInvExposure: { value: 1 },
  uPortalGain: { value: new Vector2(PORTAL_LOOK.dayGain, PORTAL_LOOK.nightGain) },
  uPortalFallbackDay: { value: new Color(...PORTAL_LOOK.fallbackDay) },
  uPortalFallbackNight: { value: new Color(...PORTAL_LOOK.fallbackNight) },
};

/** Per frame: the village's lit weight (DayNightState.lights, 0 by day, 1 at night) and its exposure. */
export function applyPortalDayNight(lights: number, exposure: number): void {
  portalShared.uPortalNight.value = Math.min(1, Math.max(0, lights));
  portalShared.uPortalInvExposure.value = 1 / Math.max(1e-3, exposure);
}

const F = layout.face;
const G = layout.gutter;
const TILE = F + 2 * G;
const W = 3 * TILE;
const H = 4 * TILE;
const f1 = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

/**
 * GLSL (declared before main): the atlas lookup and the ray's exit from a box. Face axes as portalAtlas.json and portal_atlas.mjs:
 * f the face's direction, u its up, r = f × u; s = d·r / d·f, t = d·u / d·f; column (s + 1) / 2, row (1 − t) / 2 (top first).
 */
export const PORTAL_PARS = /* glsl */ `
uniform float uPortalNight;
uniform float uPortalInvExposure;
uniform vec2 uPortalGain;
uniform vec3 uPortalFallbackDay;
uniform vec3 uPortalFallbackNight;
/** The atlas coordinates of direction d (face rows from row0) and their footprint, for textureGrad (call in uniform flow). */
void portalUv( vec3 d, float row0, out vec2 uv, out vec2 dx, out vec2 dy ) {
	vec3 ad = abs( d );
	vec3 f; vec3 u; vec3 r; float idx;
	if ( ad.x >= ad.y && ad.x >= ad.z ) {
		if ( d.x > 0.0 ) { f = vec3( 1.0, 0.0, 0.0 ); r = vec3( 0.0, 0.0, 1.0 ); idx = 0.0; }
		else { f = vec3( -1.0, 0.0, 0.0 ); r = vec3( 0.0, 0.0, -1.0 ); idx = 1.0; }
		u = vec3( 0.0, 1.0, 0.0 );
	} else if ( ad.y >= ad.z ) {
		if ( d.y > 0.0 ) { f = vec3( 0.0, 1.0, 0.0 ); u = vec3( 0.0, 0.0, 1.0 ); idx = 2.0; }
		else { f = vec3( 0.0, -1.0, 0.0 ); u = vec3( 0.0, 0.0, -1.0 ); idx = 3.0; }
		r = vec3( 1.0, 0.0, 0.0 );
	} else {
		if ( d.z > 0.0 ) { f = vec3( 0.0, 0.0, 1.0 ); r = vec3( -1.0, 0.0, 0.0 ); idx = 4.0; }
		else { f = vec3( 0.0, 0.0, -1.0 ); r = vec3( 1.0, 0.0, 0.0 ); idx = 5.0; }
		u = vec3( 0.0, 1.0, 0.0 );
	}
	float df = dot( d, f );
	vec2 st = vec2( dot( d, r ), dot( d, u ) ) / df;
	vec2 local = vec2( st.x * 0.5 + 0.5, 0.5 - st.y * 0.5 );
	vec2 tile = vec2( mod( idx, 3.0 ), floor( idx / 3.0 ) + row0 ) * ${f1(TILE)};
	const vec2 atlas = vec2( ${f1(W)}, ${f1(H)} );
	uv = ( tile + ${f1(G)} + clamp( local, 0.0, 1.0 ) * ${f1(F)} ) / atlas;
	// the footprint from the continuous ray, kept inside a tile's gutter (a face's edge must not pull a neighbour tile in)
	dx = clamp( dFdx( local ) * ${f1(F)}, - ${f1(G)}, ${f1(G)} ) / atlas;
	dy = clamp( dFdy( local ) * ${f1(F)}, - ${f1(G)}, ${f1(G)} ) / atlas;
}
/** A texel's stored w / (1 + w) back to w. */
vec3 portalDecode( vec3 t ) {
	return t / max( vec3( 1.0 ) - t, vec3( 1.0 / 64.0 ) );
}
vec3 portalTap( sampler2D tex, vec3 d, float row0 ) {
	vec2 uv; vec2 dx; vec2 dy;
	portalUv( d, row0, uv, dx, dy );
	return portalDecode( textureGrad( tex, uv, dx, dy ).rgb );
}
/** The room's light in direction d from the bake's eye (the village's linear light, for its tone curve). */
vec3 portalRoomLight( sampler2D tex, float ready, vec3 d ) {
	float n = uPortalNight;
	if ( ready < 0.5 ) return mix( uPortalFallbackDay, uPortalFallbackNight, n );
	vec3 c = vec3( 0.0 );
	if ( n < 0.999 ) c += portalTap( tex, d, 0.0 ) * ( 1.0 - n ) * uPortalGain.x;
	if ( n > 0.001 ) c += portalTap( tex, d, 2.0 ) * n * uPortalGain.y;
	return c * uPortalInvExposure;
}
/** Where the ray from o through p leaves the box [lo, hi] (all in the room's frame). */
vec3 portalExit( vec3 o, vec3 p, vec3 lo, vec3 hi ) {
	vec3 d = p - o;
	d = sign( d ) * max( abs( d ), vec3( 1e-5 ) );
	vec3 inv = 1.0 / d;
	vec3 tf = max( ( lo - o ) * inv, ( hi - o ) * inv );
	float s = min( min( tf.x, tf.y ), tf.z );
	return clamp( o + d * s, lo, hi );
}
`;

/** One room's uniforms (a box mesh, or a card that looks into one room). */
export interface PortalRoomUniforms {
  uPortalTex: { value: Texture | null };
  uPortalReady: { value: number };
  /** Village → room frame: (a, b, c, d) of X = a·x + b·z + e, Z = c·x + d·z + f, and (e, f, lift). */
  uPortalRot: { value: Vector4 };
  uPortalOff: { value: Vector3 };
  uPortalLo: { value: Vector3 };
  uPortalHi: { value: Vector3 };
  uPortalEye: { value: Vector3 };
}

export function portalRoomUniforms(room: PortalRoom, liftExtra = 0): PortalRoomUniforms {
  const fr = room.frame;
  return {
    uPortalTex: { value: null },
    uPortalReady: { value: 0 },
    uPortalRot: { value: new Vector4(fr.a, fr.b, fr.c, fr.d) },
    uPortalOff: { value: new Vector3(fr.e, fr.f, fr.lift + liftExtra) },
    uPortalLo: { value: new Vector3(...room.min) },
    uPortalHi: { value: new Vector3(...room.max) },
    uPortalEye: { value: new Vector3(...room.eye) },
  };
}

const ROOM_PARS = /* glsl */ `
uniform sampler2D uPortalTex;
uniform float uPortalReady;
uniform vec4 uPortalRot;
uniform vec3 uPortalOff;
uniform vec3 uPortalLo;
uniform vec3 uPortalHi;
uniform vec3 uPortalEye;
varying vec3 vPortalWorld;
vec3 portalToRoom( vec3 v ) {
	return vec3( uPortalRot.x * v.x + uPortalRot.y * v.z + uPortalOff.x, v.y - uPortalOff.z, uPortalRot.z * v.x + uPortalRot.w * v.z + uPortalOff.y );
}
vec3 portalColour() {
	vec3 o = portalToRoom( cameraPosition );
	vec3 p = portalToRoom( vPortalWorld );
	vec3 hit = portalExit( o, p, uPortalLo, uPortalHi );
	return portalRoomLight( uPortalTex, uPortalReady, hit - uPortalEye );
}
`;

const VERT_PARS = /* glsl */ `varying vec3 vPortalWorld;
void main() {`;
const VERT_WORLD = /* glsl */ `#include <project_vertex>
	vec4 portalWorld = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		portalWorld = instanceMatrix * portalWorld;
	#endif
	vPortalWorld = ( modelMatrix * portalWorld ).xyz;`;

/**
 * Make `material` (a MeshBasicMaterial: unlit, the room's own light) draw the room seen through it: its colour is replaced by the
 * room's light along the eye's ray. Its own map and colour are dropped.
 */
export function patchPortal(material: MeshBasicMaterial, room: PortalRoomUniforms, key = "room"): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, portalShared, room);
    shader.vertexShader = shader.vertexShader.replace("void main() {", VERT_PARS).replace("#include <project_vertex>", VERT_WORLD);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", PORTAL_PARS + ROOM_PARS + "void main() {")
      .replace("#include <map_fragment>", "diffuseColor.rgb = portalColour();");
  };
  material.customProgramCacheKey = () => `village-portal-${key}`;
  material.needsUpdate = true;
}

/**
 * A lot's or the memorial's room as a box inside its building's shell, drawn from inside (back faces): through an open door or a
 * clear window one sees its far walls, floor and ceiling, which the shader paints with the baked room. `inset` keeps it a hair
 * inside the shell's own walls (no flicker), and its floor a hair below the building's (the threshold's boards win).
 */
export function portalBoxMesh(room: PortalRoom, uniforms: PortalRoomUniforms, liftExtra = 0, inset = 0.03): Mesh {
  const lo = new Vector3(...room.min).addScalar(inset);
  const hi = new Vector3(...room.max).addScalar(-inset);
  lo.y = room.min[1] - 0.02;
  const fr = room.frame;
  // the box's corners in the village (the rotation is a quarter-turn multiple for every building: its box stays axis-aligned)
  const a = toVillageXZ(fr, lo.x, lo.z);
  const b = toVillageXZ(fr, hi.x, hi.z);
  const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]);
  const minZ = Math.min(a[1], b[1]), maxZ = Math.max(a[1], b[1]);
  const y0 = lo.y + fr.lift + liftExtra, y1 = hi.y + fr.lift + liftExtra;
  const geo = new BoxGeometry(maxX - minX, y1 - y0, maxZ - minZ);
  const material = new MeshBasicMaterial({ name: `M_portal_${room.id}`, side: BackSide, color: 0xffffff });
  patchPortal(material, uniforms, "box");
  const mesh = new Mesh(geo, material);
  mesh.name = `portal__${room.id}${liftExtra ? `_up${liftExtra}` : ""}`;
  mesh.position.set((minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // a room's box is not a wall: the camera's and the click's rays pass it (LiveSunShadows and the pickers skip `cvPortal`)
  mesh.userData.cvPortal = true;
  mesh.raycast = () => undefined;
  return mesh;
}

function toVillageXZ(fr: PortalRoom["frame"], X: number, Z: number): [number, number] {
  const x0 = X - fr.e, z0 = Z - fr.f;
  return [fr.a * x0 + fr.c * z0, fr.b * x0 + fr.d * z0];
}

/** Dispose a portal box's own geometry and material (its texture is the loader's). */
export function disposePortalBox(mesh: Mesh): void {
  mesh.geometry.dispose();
  (mesh.material as Material).dispose();
}
