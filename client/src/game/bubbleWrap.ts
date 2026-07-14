/**
 * Pure word-wrap + ellipsis helper for speech bubbles. Width measurement is
 * INJECTED (`measure`) so this is exhaustively testable with a char-count stub
 * and, in the browser, driven by the real `CanvasRenderingContext2D.measureText`.
 *
 * Greedy line breaking: pack space-separated words while they fit; a word (or a
 * space-free run, e.g. Korean) wider than the line is broken at the code-point
 * boundary that still fits. Beyond `maxLines`, the last kept line is ellipsized.
 */

export type MeasureWidth = (text: string) => number;

const ELLIPSIS = "…";

/** Wrap `text` into at most `maxLines` lines each within `maxWidth` (measured). */
export function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: MeasureWidth,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const all = wrapWords(words, maxWidth, measure);
  if (all.length <= maxLines) return all;

  const kept = all.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(kept[maxLines - 1], maxWidth, measure);
  return kept;
}

/** Greedy pack (unbounded line count); over-wide words are broken per code point. */
function wrapWords(words: string[], maxWidth: number, measure: MeasureWidth): string[] {
  const lines: string[] = [];
  let line = "";
  const flush = () => {
    if (line) {
      lines.push(line);
      line = "";
    }
  };

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    flush();
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    // The word alone overflows the line — break it character by character.
    for (const ch of word) {
      const next = line + ch;
      if (measure(next) <= maxWidth) {
        line = next;
      } else {
        flush();
        line = ch; // a single code point is assumed to fit
      }
    }
  }
  flush();
  return lines;
}

/** Append an ellipsis, dropping trailing code points until it fits `maxWidth`. */
function ellipsize(line: string, maxWidth: number, measure: MeasureWidth): string {
  if (measure(line + ELLIPSIS) <= maxWidth) return line + ELLIPSIS;
  const chars = [...line];
  while (chars.length > 0 && measure(chars.join("") + ELLIPSIS) > maxWidth) {
    chars.pop();
  }
  return chars.join("") + ELLIPSIS;
}
