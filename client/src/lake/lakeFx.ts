// The lake's little effects reachable from anywhere (lake v2): rings on the water and splashes / drops. The lake scene installs the
// real ones while it is drawn (LakeScene.tsx); until then they are no-ops, so a catch rig can call them whatever is loaded.

type Ripple = (x: number, z: number, strength: number) => void;
/** `n` drops at (x, y, z): a splash (`power` ~0.5..2 throws them up and out) or, with `drip`, single drops that just fall. */
type Splash = (x: number, y: number, z: number, n: number, power: number, drip?: boolean) => void;

let ripple: Ripple | null = null;
let splash: Splash | null = null;

export function installLakeFx(r: Ripple | null, s: Splash | null): void {
  ripple = r;
  splash = s;
}

export function lakeRipple(x: number, z: number, strength: number): void {
  ripple?.(x, z, strength);
}

export function lakeSplash(x: number, y: number, z: number, n: number, power: number, drip = false): void {
  splash?.(x, y, z, n, power, drip);
}
