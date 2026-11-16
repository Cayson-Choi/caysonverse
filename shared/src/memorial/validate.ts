import { CLAIM_DATE_MIN, CLAIM_LINE_MAX, PET_NAME_MAX, PET_NAME_MIN, SPECIES, type Species } from "./constants";
import { kstDate } from "./kst";
import type { ClaimCreateBody, DatePrecision, IsoDate } from "./types";

/**
 * Shape checks of the claim form, shared by the client (live hints) and the server (the authority). Pure. The server ALSO runs
 * its profanity / advertising filter on the name and the line (server-only, never shipped to the browser).
 */

export interface ClaimFields {
  petName: string;
  species: Species;
  born: IsoDate | null;
  bornPrec: DatePrecision;
  passed: IsoDate | null;
  passedPrec: DatePrecision;
  line: string;
}

export type FieldResult<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

/** Control characters, zero-width and bidi marks are removed; runs of spaces become one. */
export function cleanText(s: string): string {
  return s
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Letters (any script), digits, spaces and a little punctuation. */
const NAME_PATTERN = /^[\p{L}\p{N} .'·\-]+$/u;

export const CLAIM_COPY = {
  name: `이름은 ${PET_NAME_MIN}~${PET_NAME_MAX}자로 적어 주세요`,
  nameChars: "이름에는 글자와 숫자만 쓸 수 있어요",
  species: "아이의 종류를 골라 주세요",
  line: `한 줄은 ${CLAIM_LINE_MAX}자까지 적을 수 있어요`,
  date: "날짜를 다시 확인해 주세요",
  order: "무지개다리 건넌 날이 태어난 날보다 앞서 있어요",
} as const;

/** Is `d` a real calendar date `YYYY-MM-DD` (or `0000-MM-DD` for month-day only)? */
export function isCalendarDate(d: string, prec: DatePrecision): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (prec === "md") {
    if (y !== 0) return false;
    const leap = new Date(Date.UTC(2000, mo - 1, day)); // 2000 is leap: Feb 29 allowed
    return leap.getUTCMonth() === mo - 1 && leap.getUTCDate() === day;
  }
  const dt = new Date(Date.UTC(y, mo - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === day;
}

function checkDate(raw: unknown, rawPrec: unknown, now: number, field: string): FieldResult<{ d: IsoDate | null; p: DatePrecision }> {
  const prec: DatePrecision = rawPrec === "day" || rawPrec === "md" ? rawPrec : raw ? "day" : "unknown";
  if (prec === "unknown" || raw === null || raw === undefined || raw === "") return { ok: true, value: { d: null, p: "unknown" } };
  if (typeof raw !== "string" || !isCalendarDate(raw, prec)) return { ok: false, field, message: CLAIM_COPY.date };
  if (prec === "day" && (raw < CLAIM_DATE_MIN || raw > kstDate(now))) return { ok: false, field, message: CLAIM_COPY.date };
  return { ok: true, value: { d: raw, p: prec } };
}

/** Validate a full create body (`partial` = a PATCH: only the given fields, merged onto `base`). */
export function validateClaimFields(body: unknown, now: number, base?: ClaimFields): FieldResult<ClaimFields> {
  if (typeof body !== "object" || body === null) return { ok: false, field: "body", message: CLAIM_COPY.name };
  const b = body as Partial<Record<keyof ClaimCreateBody, unknown>>;
  const out: ClaimFields = base
    ? { ...base }
    : { petName: "", species: "dog", born: null, bornPrec: "unknown", passed: null, passedPrec: "unknown", line: "" };

  if (!base || b.petName !== undefined) {
    if (typeof b.petName !== "string") return { ok: false, field: "petName", message: CLAIM_COPY.name };
    const name = cleanText(b.petName);
    const len = [...name].length;
    if (len < PET_NAME_MIN || len > PET_NAME_MAX) return { ok: false, field: "petName", message: CLAIM_COPY.name };
    if (!NAME_PATTERN.test(name)) return { ok: false, field: "petName", message: CLAIM_COPY.nameChars };
    out.petName = name;
  }
  if (!base || b.species !== undefined) {
    if (typeof b.species !== "string" || !(SPECIES as readonly string[]).includes(b.species)) {
      return { ok: false, field: "species", message: CLAIM_COPY.species };
    }
    out.species = b.species as Species;
  }
  if (!base || b.born !== undefined || b.bornPrec !== undefined) {
    const r = checkDate(b.born, b.bornPrec, now, "born");
    if (!r.ok) return r;
    out.born = r.value.d;
    out.bornPrec = r.value.p;
  }
  if (!base || b.passed !== undefined || b.passedPrec !== undefined) {
    const r = checkDate(b.passed, b.passedPrec, now, "passed");
    if (!r.ok) return r;
    out.passed = r.value.d;
    out.passedPrec = r.value.p;
  }
  if (out.bornPrec === "day" && out.passedPrec === "day" && out.born && out.passed && out.passed < out.born) {
    return { ok: false, field: "passed", message: CLAIM_COPY.order };
  }
  if (!base || b.line !== undefined) {
    if (b.line !== undefined && b.line !== null && typeof b.line !== "string") return { ok: false, field: "line", message: CLAIM_COPY.line };
    const line = cleanText(typeof b.line === "string" ? b.line : "");
    if ([...line].length > CLAIM_LINE_MAX) return { ok: false, field: "line", message: CLAIM_COPY.line };
    out.line = line;
  }
  return { ok: true, value: out };
}

/** "2011 – 2024", "2011 –", "– 2024" or "" from the stored dates (the card's years line). */
export function claimYears(c: Pick<ClaimFields, "born" | "bornPrec" | "passed" | "passedPrec">): string {
  const y = (d: IsoDate | null, p: DatePrecision) => (p === "day" && d ? d.slice(0, 4) : "");
  const a = y(c.born, c.bornPrec);
  const b = y(c.passed, c.passedPrec);
  if (!a && !b) return "";
  return `${a}${a || b ? " – " : ""}${b}`.trim();
}
