import { KST_OFFSET_MS } from "./constants";

/** The KST calendar parts of a UTC instant (ms). Pure: never reads the device clock or time zone. */
export interface KstParts {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
  /** 0 = Sunday */
  weekday: number;
  hour: number;
  minute: number;
}

export function kstParts(utcMs: number): KstParts {
  const d = new Date(utcMs + KST_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

/** `YYYY-MM-DD` of the KST day containing `utcMs`. */
export function kstDate(utcMs: number): string {
  const p = kstParts(utcMs);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The UTC ms of KST midnight starting the given KST calendar day. */
export function kstMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - KST_OFFSET_MS;
}

/** The UTC ms of a KST wall-clock time. */
export function kstTime(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
