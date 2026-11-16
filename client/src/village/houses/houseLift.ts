/**
 * 집 외관 A8 (X3): the raised porches' picture lift (shared houseExterior.ts `houseStepLift`, contract ch. 3). The server walks on
 * y = 0 everywhere; the client draws a body standing on a porch slab 0.30 m up and on the two treads 0.20 / 0.10 m up, eased over
 * `HOUSE_LIFT_EASE_S` so a step reads as a step, not a jump. The avatar, its name tag and speech bubble (children of the avatar's
 * group), its foot shadow, the first-person eye and the follow camera all take the same eased value (LocalPlayer, RemotePlayer,
 * CameraRig / followRig).
 *
 * A house's zones count only once its porch is drawn (`setPorchesDrawn`, VillageHouses: the houses' model holds a porch slab
 * at +0.30 for that house). Until then — the old village model's houses, the houses' model still loading or failed, an
 * X1 build without X2's porches — nobody floats over a lawn with nothing under their feet.
 *
 * A seat sets its own height (the porch bench's seatTop 0.75 is above the lawn, already including the porch): seated, the
 * larger of the two is drawn (`withSeatLift`), so the bench never adds the porch twice.
 */
import { houseLiftZones, houseStepLift, type LiftZone } from "@caysonverse/shared/village/houseExterior";
import { VILLAGE_LAYOUT } from "@caysonverse/shared/village/villageLayout";

/** Time constant of the lift's ease (s): ~0.12 s per contract ch. 3 (X3). */
export const HOUSE_LIFT_EASE_S = 0.12;

/** Every A8 house's lift zones (porch slab, treads), world boxes. */
export const HOUSE_LIFT_ZONES: readonly LiftZone[] = Object.freeze(
  VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house").flatMap((h) => houseLiftZones(h)),
);

let drawn: readonly LiftZone[] = [];
let drawnIds: ReadonlySet<string> = new Set();

/** The houses whose porch is drawn now (their zones lift); an empty list turns the lift off. */
export function setPorchesDrawn(ids: Iterable<string>): void {
  const set = new Set(ids);
  drawnIds = set;
  drawn = HOUSE_LIFT_ZONES.filter((z) => set.has(z.houseId));
}

/** The houses whose porches lift now. */
export function porchesDrawn(): ReadonlySet<string> {
  return drawnIds;
}

/** The target lift (m) at a ground point in the village (0 off every drawn porch and tread). */
export function stepLiftAt(x: number, z: number, zones: readonly LiftZone[] = drawn): number {
  if (zones.length === 0 || !Number.isFinite(x) || !Number.isFinite(z)) return 0;
  return houseStepLift(x, z, zones);
}

/** One frame of the ease toward `target` (exponential, time constant HOUSE_LIFT_EASE_S); snaps when within 1 mm. */
export function easeLift(current: number, target: number, dt: number): number {
  if (!(dt > 0)) return current;
  const next = current + (target - current) * (1 - Math.exp(-dt / HOUSE_LIFT_EASE_S));
  return Math.abs(next - target) < 0.001 ? target : next;
}

/** Seated (or sitting down / getting up), the seat's own lift and the porch's do not add up: the higher one is drawn. */
export function withSeatLift(step: number, seat: number): number {
  return Math.max(step, seat);
}

/** Our own avatar's eased step lift (LocalPlayer writes it every frame; the camera reads it). */
let localStep = 0;
export function publishLocalStepLift(v: number): void {
  localStep = v;
}
export function getLocalStepLift(): number {
  return localStep;
}

/** Our own avatar's ground position (LocalPlayer writes it every frame): the houses' detail is chosen round it and the camera. */
const localPose = { x: Number.NaN, z: Number.NaN };
export function publishLocalPose(x: number, z: number): void {
  localPose.x = x;
  localPose.z = z;
}
export function getLocalPose(): Readonly<{ x: number; z: number }> {
  return localPose;
}

/** A house's porch bench seat (`house_N_porch`, the village seat markers; 집 외관 A8): a tap walks there, "앉기" sits. */
export function isPorchSeat(seat: { bench?: string; id?: string } | undefined | null): boolean {
  const name = seat?.bench ?? seat?.id;
  return typeof name === "string" && /^house_\d+_porch$/.test(name);
}
