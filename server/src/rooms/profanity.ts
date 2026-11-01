/**
 * Korean profanity filter for the shared chat path (PlayerRoom). Pure and I/O-free: the room
 * hands over a line, gets a verdict, and decides what to do with it.
 *
 * SERVER ONLY. The word list lives here and nowhere else — it is never imported by the client or
 * `shared`, so it cannot end up in a browser bundle. And a blocked line is never logged: callers
 * pass on only `masked`, never the original text.
 *
 * How a line is judged (binding):
 *  1. Normalize: NFC (never NFKC — it would turn compatibility jamo such as ㅅ into composed
 *     forms), fullwidth ASCII to ASCII, lowercase.
 *  2. Split into words. A word with at most one letter ("시", "발", "f") is glued to its
 *     neighbours that are also single letters, so "시 발" and "f u c k" read as one word —
 *     but words of two letters or more are never glued, which keeps "도시 발전" legal.
 *  3. Hangul is folded syllable by syllable into `initial + vowel-class + final` tokens joined
 *     by "|": fortis initials fold to their plain pair (씨→시), the vowel keeps seven classes
 *     (쉬→시), only the ㄲ/ㅆ finals fold, and an empty-initial repeat of the same vowel is
 *     dropped ("시이이발"→"시발"). Aspirates and the representative-sound finals are NOT folded,
 *     so "좋아" is not "좆" and "평신도" is not "병신". The "|" fences make a match always line
 *     up with whole syllables.
 *  4. Latin letters are leet-decoded (s1bal, $h1t), stripped to a–z and de-duplicated per run.
 *  5. A word is bad when its folded form contains a folded listed word (after the ALLOW words
 *     such as "시발점" have been cut out) or its latin form contains a listed latin word.
 */

import { stripControl } from "./chat";

export type ProfanityResult = { ok: true } | { ok: false; masked: string };

/** Personal Korean notice for a sender whose line was held back. */
export const CHAT_NOT_NICE = "고운 말로 다시 써 볼까요?";

const CHO = "ㄱㄱㄴㄷㄷㄹㅁㅂㅂㅅㅅㅇㅈㅈㅊㅋㅌㅍㅎ"; // 19 초성, 된소리 → 예사소리
const JUNG = "aeaeveveoaeeouveiuwii"; // 21 중성 → a e v o u w i
const JONG = "_ㄱㄱㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅅㅇㅈㅊㅋㅌㅍㅎ"; // 28 종성, ㄲ·ㅆ만 접음
const JAMO_FOLD: Record<string, string> = { ㄲ: "ㄱ", ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ", ㅄ: "ㅂ|ㅅ" };

/** Listed Korean words (also matched in their first-consonant shorthand, see `variants`). */
const WORDS = [
  "시발", "씨발", "시팔", "씨팔", "시바", "병신", "븅신", "좆", "존나", "졸라", "지랄", "개새끼",
  "엠창", "느금", "미친놈", "미친년", "또라이", "ㅅㅂ", "ㅂㅅ", "ㅈㄴ", "ㅈㄹ", "ㄱㅅㄲ", "ㅗ",
];
/** Innocent words that contain a listed sound; cut out before matching. */
const ALLOW = ["시발점", "시발역", "시바견", "시바이누"];
const LATIN = ["sibal", "sival", "shibal", "fuck", "fuk", "shit", "bitch"];
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };
const CHO_JAMO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

const isSyllable = (c: number): boolean => c >= 0xac00 && c <= 0xd7a3;

/** Fold Hangul text into `|초성+모음갈래+종성|` tokens; everything else is dropped. */
export function foldHangul(word: string): string {
  const out: string[] = [];
  for (const ch of word) {
    const c = ch.codePointAt(0)!;
    if (isSyllable(c)) {
      const i = c - 0xac00;
      const cho = CHO[Math.floor(i / 588)],
        v = JUNG[Math.floor((i % 588) / 28)],
        jong = JONG[i % 28];
      const prev = out[out.length - 1];
      if (cho === "ㅇ" && jong === "_" && prev?.length === 3 && prev[1] === v) continue; // "시이이발" → "시발"
      out.push(cho + v + jong);
    } else if (c >= 0x3131 && c <= 0x314e) out.push(JAMO_FOLD[ch] ?? ch);
    else if (ch === "ㅗ") out.push("ㅗ");
  }
  return out.length ? `|${out.join("|")}|` : "";
}

const variants = (w: string): string[] => {
  // "시발" → ["시발", "ㅅ발"]
  const c = w.codePointAt(0)!;
  return isSyllable(c) ? [w, CHO_JAMO[Math.floor((c - 0xac00) / 588)] + w.slice(1)] : [w];
};
const PATTERNS = [...new Set(WORDS.flatMap(variants).map(foldHangul))];
const ALLOW_F = ALLOW.map(foldHangul);

const normalize = (s: string) =>
  s
    .normalize("NFC") // NFKC 금지: 호환 자모(ㅅ)를 조합형으로 바꿔 버린다
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();

function units(text: string): string[] {
  const out: string[] = [];
  let run = "";
  for (const w of normalize(text).split(/\s+/).filter(Boolean)) {
    if ([...w.replace(/[^\p{L}]/gu, "")].length <= 1) {
      run += w; // 글자 0~1개짜리 조각은 이어 붙임
      continue;
    }
    if (run) {
      out.push(run);
      run = "";
    }
    out.push(w);
  }
  if (run) out.push(run);
  return out;
}

/**
 * Judge one chat line. `{ ok: true }` lets it through; otherwise `masked` is the line with each
 * offending word replaced by ● (at most six, one per letter) — safe to show a teacher.
 */
export function checkProfanity(text: string): ProfanityResult {
  let hit = false;
  const masked = units(stripControl(text))
    .map((w) => {
      let f = foldHangul(w);
      for (const a of ALLOW_F) f = f.split(a).join("|");
      const latin = [...w]
        .map((ch) => LEET[ch] ?? ch)
        .join("")
        .replace(/[^a-z]/g, "")
        .replace(/(.)\1+/g, "$1");
      const bad = PATTERNS.some((p) => f.includes(p)) || LATIN.some((p) => latin.includes(p));
      if (bad) hit = true;
      return bad ? "●".repeat(Math.min([...w].length, 6)) : w;
    })
    .join(" ");
  return hit ? { ok: false, masked } : { ok: true };
}
