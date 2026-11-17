/**
 * What a house's owner slots show (집 외관 A8, design 6): the nameplate's text, the yard sign's state and, later, the owner's
 * name. Today a constant table (`HOUSE_EXTERIOR_DEFAULT`: "N번 집", sign hidden); when houses can be bought (owner roadmap
 * 2026-11-16) the server sends this state instead. The client draws the boards (houseSigns.ts, X3) at houseSlots().
 */

export type HouseSignState = "hidden" | "forSale" | "owned";

export interface HouseExteriorState {
  /** House number 1..10. */
  n: number;
  /** The nameplate's text. */
  label: string;
  sign: HouseSignState;
  /** Shown on the nameplate and the mailbox once the house has an owner. */
  ownerName?: string;
}

export const HOUSE_NUMBERS: readonly number[] = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

/** Every house's state today: "N번 집" on the nameplate, the mailbox blank, the yard sign hidden. */
export const HOUSE_EXTERIOR_DEFAULT: Readonly<Record<string, Readonly<HouseExteriorState>>> = Object.freeze(
  Object.fromEntries(HOUSE_NUMBERS.map((n) => [`house_${n}`, Object.freeze({ n, label: `${n}번 집`, sign: "hidden" as const })])),
);
