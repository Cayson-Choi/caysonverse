import type { DatePrecision, DaysSettings, IsoDate, Occasion } from "./types";
import { isLeapYear } from "./kst";

/**
 * F1 occasion rules (memorial-2 design Appendix "Clocks"), pure. `today` is the server's KST date (`kstDate(now)`).
 * - birthday: on the month-day of `born` (Feb 29 → Feb 28 in a non-leap year); `years` = age when the birth year is known.
 * - anniv: on the month-day of `passed`, for years ≥ 1 (`N주기`); with the year unknown (`md`) it is marked without a number.
 * - d49 / d100: passed + 48 / + 99 days (Korean count: the day itself is day 1), full dates only, only when enabled.
 */

export interface OccasionDates {
  born: IsoDate | null;
  bornPrec: DatePrecision;
  passed: IsoDate | null;
  passedPrec: DatePrecision;
}

function parse(d: IsoDate | null): { y: number; m: number; day: number } | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), day: Number(m[3]) };
}

/** Does a month-day fall on `today`, moving Feb 29 to Feb 28 in a non-leap year? */
function sameMonthDay(md: { m: number; day: number }, today: { y: number; m: number; day: number }): boolean {
  if (md.m === 2 && md.day === 29 && !isLeapYear(today.y)) return today.m === 2 && today.day === 28;
  return md.m === today.m && md.day === today.day;
}

/** Days from `a` to `b` (calendar dates, UTC arithmetic so no time zone enters). */
function daysBetween(a: { y: number; m: number; day: number }, b: { y: number; m: number; day: number }): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.day) - Date.UTC(a.y, a.m - 1, a.day)) / 86_400_000);
}

export function occasionsOn(today: IsoDate, dates: OccasionDates, days: Pick<DaysSettings, "birthday" | "anniv" | "d49" | "d100">): Occasion[] {
  const t = parse(today);
  if (!t) return [];
  const out: Occasion[] = [];
  const born = dates.bornPrec === "unknown" ? null : parse(dates.born);
  if (days.birthday && born && sameMonthDay(born, t)) {
    const age = dates.bornPrec === "day" ? t.y - born.y : undefined;
    if (age === undefined || age >= 1) out.push(age === undefined ? { kind: "birthday" } : { kind: "birthday", years: age });
  }
  const passed = dates.passedPrec === "unknown" ? null : parse(dates.passed);
  if (passed) {
    if (days.anniv && sameMonthDay(passed, t)) {
      if (dates.passedPrec === "md") out.push({ kind: "anniv" });
      else if (t.y - passed.y >= 1) out.push({ kind: "anniv", years: t.y - passed.y });
    }
    if (dates.passedPrec === "day") {
      const n = daysBetween(passed, t);
      if (days.d49 && n === 48) out.push({ kind: "d49" });
      if (days.d100 && n === 99) out.push({ kind: "d100" });
    }
  }
  return out;
}

/** The card's quiet line: "오늘은 콩이의 무지개다리 1주기예요" / "오늘은 콩이의 생일이에요. 함께 기억해 주세요". */
export function occasionLine(petName: string, o: Occasion): string {
  const subj = `${petName}${hasBatchim(petName) ? "이의" : "의"}`;
  switch (o.kind) {
    case "birthday":
      return `오늘은 ${subj} 생일이에요. 함께 기억해 주세요`;
    case "anniv":
      return o.years ? `오늘은 ${subj} 무지개다리 ${o.years}주기예요` : `오늘은 ${subj} 무지개다리 건넌 날이에요`;
    case "d49":
      return `오늘은 ${subj} 49일이에요`;
    case "d100":
      return `오늘은 ${subj} 100일이에요`;
  }
}

/** Whether the last syllable has a final consonant (콩 → 콩이의, 초코 → 초코의). Non-Hangul endings count as none. */
export function hasBatchim(word: string): boolean {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}
