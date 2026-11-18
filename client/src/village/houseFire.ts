import { Vector3 } from "three";

/**
 * The fireplaces of the houses (houses 1, 2, 7 and 10 have one; the other six have none). Every fireplace model carries its flame as a few
 * cones of the lamp material (`M_lamp` in houses 1-5, `E_H_lamp` in 6-10): the first two houses' bake lit a warm glow round them and they read as
 * a fire at entry, the other two showed the same cones as plain white triangles in a dark opening. The lamp material's shader (houseNight.ts)
 * now colours whatever of it lies in a fireplace's hearth box as a flickering flame (orange at the foot, yellow at the tip), the same in every house.
 * The boxes are the fireplace colliders (shared/.../generated/houses/*_colliders.ts, col__hN_1_fireplace) opened to the room, 0.05 - 1.05 m up.
 */
export interface HearthBox {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export const HOUSE_HEARTHS: Readonly<Record<number, HearthBox>> = {
  1: { min: [361.52, 0.05, -7.75], max: [363.28, 1.05, -7.0] },
  2: { min: [392.42, 0.05, -7.75], max: [394.18, 1.05, -7.0] },
  7: { min: [504.04, 0.05, -3.08], max: [505.0, 1.05, -1.32] },
  10: { min: [576.0, 0.05, -6.93], max: [577.25, 1.05, -4.87] },
};

/** The hearth box uniforms shared by every patched lamp material: an empty box (min > max) when the house has no fireplace. */
export const houseHearthMin = { value: new Vector3(1, 1, 1) };
export const houseHearthMax = { value: new Vector3(0, 0, 0) };
export const houseFireTime = { value: 0 };

export function setHouseHearth(n: number): void {
  const b = HOUSE_HEARTHS[n];
  if (b) {
    houseHearthMin.value.set(...b.min);
    houseHearthMax.value.set(...b.max);
  } else {
    houseHearthMin.value.set(1, 1, 1);
    houseHearthMax.value.set(0, 0, 0);
  }
}

export const FLAME_GLSL = /* glsl */ `
	if ( all( greaterThanEqual( vHouseWorld, uHearthMin ) ) && all( lessThanEqual( vHouseWorld, uHearthMax ) ) ) {
		float fh = clamp( ( vHouseWorld.y - uHearthMin.y ) / 0.55, 0.0, 1.0 );
		float ff = 0.86 + 0.14 * sin( uHouseFireTime * 7.0 + vHouseWorld.x * 9.0 ) + 0.07 * sin( uHouseFireTime * 13.0 + vHouseWorld.z * 7.0 + fh * 4.0 );
		diffuseColor.rgb = mix( vec3( 1.0, 0.1, 0.0 ), vec3( 1.0, 0.48, 0.04 ), smoothstep( 0.0, 0.9, fh ) ) * ff * 1.35;
	}`;
