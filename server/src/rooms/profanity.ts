/**
 * Korean profanity filter for the shared chat path (PlayerRoom). Pure and I/O-free: the room
 * hands over a line, gets a verdict, and decides what to do with it.
 *
 * SERVER ONLY. The word list lives here and nowhere else — it is never imported by the client or
 * `shared`, so it cannot end up in a browser bundle. And a blocked line is never logged: callers
 * pass on only `masked`, never the original text.
 *
 * How a line is judged (binding):
 *  1. Normalize: NFC for Hangul (never NFKC there — it would turn compatibility jamo such as ㅅ
 *     into composed forms), the child misspelling 쫒 → 쫓, fullwidth ASCII to ASCII, lowercase.
 *  2. Split into words. A word with at most one letter ("시", "발", "f") is glued to its
 *     neighbours that are also single letters, so "시 발" and "f u c k" read as one word —
 *     but words of two letters or more are never glued, which keeps "도시 발전" legal.
 *  3. Hangul is folded syllable by syllable into `initial + vowel-class + final` tokens joined
 *     by "|": fortis initials fold to their plain pair (씨→시), the vowel keeps seven classes
 *     (쉬→시), only the ㄲ/ㅆ finals fold, and an empty-initial repeat of the same vowel is
 *     dropped ("시이이발"→"시발"). Aspirates and the representative-sound finals are NOT folded,
 *     so "좋아" is not "좆" and "평신도" is not "병신". The "|" fences make a match always line
 *     up with whole syllables. Loose jamo are folded only for ㄸ ㅃ ㅆ ㅉ (ㄲ stays itself, so the
 *     kid shorthand ㄱㅅㄱㅅ is not the swear ㅅㄲ). A word typed one key at a time ("시ㅂㅏㄹ")
 *     is also composed back into syllables and judged in both forms.
 *  4. Latin letters go through NFKC (ⓕⓤⓒⓚ, 𝐟𝐮𝐜𝐤), are leet-decoded (s1bal, $h1t), stripped to a–z
 *     and de-duplicated per run.
 *  5. A word is bad when its folded form contains a folded listed word (after the ALLOW words
 *     such as "시발점" have been cut out) or its latin form contains a listed latin word (after
 *     ALLOW_LATIN such as "shiitake" have been cut out).
 *
 * Deliberately NOT listed: bare 씹, 씹년, 찐따, 보지, 자지, 죽어, 뒤져, 꺼져, 닥쳐, 새끼, 년, 놈, 미친,
 * 걸레 — under the fold they collide with everyday words (십, 쉽다, 진다, 보지 마, 자지 마 …).
 */

import { stripControl } from "./chat";

export type ProfanityResult = { ok: true } | { ok: false; masked: string };

/** Personal Korean notice for a sender whose line was held back. */
export const CHAT_NOT_NICE = "고운 말로 다시 써 볼까요?";

const CHO = "ㄱㄱㄴㄷㄷㄹㅁㅂㅂㅅㅅㅇㅈㅈㅊㅋㅌㅍㅎ"; // 19 초성, 된소리 → 예사소리
const JUNG = "aeaeveveoaeeouveiuwii"; // 21 중성 → a e v o u w i
const JONG = "_ㄱㄱㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅅㅇㅈㅊㅋㅌㅍㅎ"; // 28 종성, ㄲ·ㅆ만 접음
// Loose jamo. ㄲ is NOT folded: "ㄱㅅㄱㅅ"(감사감사) must not become the swear "ㅅㄲ".
const JAMO_FOLD: Record<string, string> = { ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ", ㅄ: "ㅂ|ㅅ" };

/** Listed Korean words (words of 2+ syllables are also matched in their first-consonant shorthand). */
const WORDS = [
  "시발", "씨발", "시팔", "씨팔", "시바", "병신", "븅신", "좆", "존나", "졸라", "지랄", "개새끼",
  "엠창", "느금", "미친놈", "미친년", "또라이", "ㅅㅂ", "ㅂㅅ", "ㅈㄴ", "ㅈㄹ", "ㄱㅅㄲ", "ㅗ",
  "좃", "ㅈ같", "ㅅㄲ", "씹새", "씹창", "개색기",
];
/** Innocent words that contain a listed sound; cut out before matching. */
const ALLOW = [
  "졸라맨", "졸라매", "졸라맸", "도시바", "이시바", // 졸라맨 그림, 허리띠를 졸라매다, Toshiba, 이시바 (a surname)
  "시발점", "시발역", "시바견", "시바이누",
];
const LATIN = ["sibal", "sival", "shibal", "fuck", "fuk", "shit", "bitch", "fck", "wtf", "stfu"];
/** Innocent latin words that contain a listed one; run-deduplicated spellings (shiitake → shitake). */
const ALLOW_LATIN = ["shitake", "fukuoka", "fukushima", "fukui"];
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
  // "시발" → ["시발", "ㅅ발"]. A single syllable gets no bare-jamo form: "좆" → "ㅈ" would
  // block every lone ㅈ/ㅉ (ㅇㅈ, ㅈㅅ, ㅉㅉ, ㅈㅈ …). The one real case, "ㅈ같", is listed itself.
  const c = w.codePointAt(0)!;
  return isSyllable(c) && [...w].length >= 2 ? [w, CHO_JAMO[Math.floor((c - 0xac00) / 588)] + w.slice(1)] : [w];
};
const PATTERNS = [...new Set(WORDS.flatMap(variants).map(foldHangul))];
const ALLOW_F = ALLOW.map(foldHangul);

const JAMO_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"; // 19, syllable order
const JAMO_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"; // 21, syllable order
const JAMO_JONG = "_ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"; // 28, syllable order

/**
 * Compose loose jamo typed one key at a time back into syllables: "시ㅂㅏㄹ" → "시발",
 * "ㅂㅕㅇㅅㅣㄴ" → "병신". A consonant followed by a vowel starts a syllable; a consonant that
 * is not followed by a vowel closes the syllable that was composed just before it. Real
 * syllables in the input are never touched, so "아ㅅㅂ" keeps its loose ㅅㅂ.
 */
function composeJamo(s: string): string {
  const chars = [...s];
  const out: string[] = [];
  let open = false; // the last element of `out` was composed here and has no final yet
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    const nextIsVowel = next !== undefined && JAMO_JUNG.includes(next);
    const cho = JAMO_CHO.indexOf(ch);
    if (cho >= 0 && nextIsVowel) {
      out.push(String.fromCharCode(0xac00 + (cho * 21 + JAMO_JUNG.indexOf(next)) * 28));
      open = true;
      i++;
      continue;
    }
    const jong = JAMO_JONG.indexOf(ch);
    if (open && jong > 0 && !nextIsVowel) {
      out[out.length - 1] = String.fromCharCode(out[out.length - 1].charCodeAt(0) + jong);
      open = false;
      continue;
    }
    out.push(ch);
    open = false;
  }
  return out.join("");
}

/** Fullwidth ASCII (！ … ～) to plain ASCII; written with code points so no lookalike sits in the source. */
function foldFullwidth(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c >= 0xff01 && c <= 0xff5e ? String.fromCharCode(c - 0xfee0) : ch;
  }
  return out;
}

const normalize = (s: string) =>
  foldFullwidth(
    s
      .normalize("NFC") // NFKC 금지: 호환 자모(ㅅ)를 조합형으로 바꿔 버린다
      .replace(/쫒/g, "쫓"), // a common child misspelling of 쫓다; it would fold to 좆
  ).toLowerCase();

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

/** Does the Hangul in `s` contain a listed word (after cutting out the allowed ones)? */
function hangulHit(s: string): boolean {
  let f = foldHangul(s);
  for (const a of ALLOW_F) f = f.split(a).join("|");
  return PATTERNS.some((p) => f.includes(p));
}

/** Does the Latin in `w` contain a listed word? NFKC here only: it unmasks ⓕⓤⓒⓚ and 𝐟𝐮𝐜𝐤. */
function latinHit(w: string): boolean {
  let latin = [...w.normalize("NFKC").toLowerCase()]
    .map((ch) => LEET[ch] ?? ch)
    .join("")
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
  for (const a of ALLOW_LATIN) latin = latin.split(a).join("|");
  return LATIN.some((p) => latin.includes(p));
}

/**
 * Judge one chat line. `{ ok: true }` lets it through; otherwise `masked` is the line with each
 * offending word replaced by ● (at most six, one per letter) — safe to show a teacher.
 */
export function checkProfanity(text: string): ProfanityResult {
  let hit = false;
  const masked = units(stripControl(text))
    .map((w) => {
      // Judge the word as typed AND with typed-out jamo composed: the composed form catches
      // "시ㅂㅏㄹ", the original keeps catching what composing would hide ("그ㅅㅂㅗㅗ").
      const composed = composeJamo(w);
      const bad = hangulHit(w) || (composed !== w && hangulHit(composed)) || latinHit(w);
      if (bad) hit = true;
      return bad ? "●".repeat(Math.min([...w].length, 6)) : w;
    })
    .join(" ");
  return hit ? { ok: false, masked } : { ok: true };
}
