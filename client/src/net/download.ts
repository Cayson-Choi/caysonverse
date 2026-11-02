/**
 * The teacher's results CSV: its file name and the browser save. The server builds the CSV
 * (`ClassMsg.ResultsCsv`, nicknames only, starting with a UTF-8 BOM so Excel reads the Hangul); the
 * client names it and hands it to the browser. The BOM does not survive the trip — the browser's
 * message decoder reads the text as UTF-8 and drops a leading U+FEFF (seen in the Task 16 browser
 * check: the received string starts at the first header cell) — so `downloadCsv` makes sure the
 * saved file starts with exactly one.
 */

const two = (n: number): string => String(n).padStart(2, "0");

/**
 * "AI학교탈출_<CODE>_<YYYYMMDD-HHMM>.csv" in local time, e.g.
 * resultsFilename("AB2CDE", new Date(2026, 9, 31, 14, 5)) → "AI학교탈출_AB2CDE_20261031-1405.csv".
 * Only letters and digits of the code are kept, so the name can never carry a path.
 */
export function resultsFilename(code: string, d: Date): string {
  const safeCode = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const day = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`;
  const time = `${two(d.getHours())}${two(d.getMinutes())}`;
  return `AI학교탈출_${safeCode}_${day}-${time}.csv`;
}

/** How long the temporary object URL lives after the click (the save has started by then). */
const REVOKE_AFTER_MS = 1000;

const BOM = "\uFEFF";

/** Save `csv` as `filename` through a temporary a[download] link, starting with exactly one UTF-8 BOM. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv.startsWith(BOM) ? csv : BOM + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
