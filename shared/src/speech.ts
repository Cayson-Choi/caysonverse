/**
 * Speech-text sanitizing shared by BOTH sides of the NPC voice path (design 31
 * 후속 — 발주자: 이모지는 음성으로 출력하지 않기): the client strips before
 * requesting synthesis/fallback speech, the server strips before synthesis and
 * caching, so the two can never disagree on what a line "sounds like".
 * Browser-safe (pure string code, no DOM/Node APIs).
 */

/**
 * Everything an emoji can be built from: pictographs, skin-tone modifiers,
 * variation selector-16, ZWJ (sequence glue), keycap combiner and the regional
 * flag letters. Text (letters, digits, punctuation) is untouched — `#`/`*`/
 * digits carry the Unicode Emoji property but are real text, so they are NOT
 * matched (only their invisible combiners are removed).
 */
const EMOJI_PARTS =
  /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu;

/**
 * `text` with every emoji removed and whitespace re-collapsed, for the voice
 * only — bubbles/panels keep the original text. May return "" (nothing
 * speakable) — callers skip speech entirely then.
 */
export function stripEmojiForSpeech(text: string): string {
  return text.replace(EMOJI_PARTS, "").replace(/\s+/g, " ").trim();
}

/** Letters/digits in any script (what a voice can actually pronounce). */
const SPEAKABLE = /[\p{L}\p{N}]/gu;

/** Symbol glyphs ASCII/emoji art is drawn with (never counting whitespace). */
const ART_SYMBOLS = /[^\p{L}\p{N}\s.,!?'"~%·…—-]/gu;

/**
 * True when one LINE reads as drawing, not prose: nothing pronounceable at all,
 * or at least as many drawing symbols as letters — a slash-and-bracket cat
 * sketch (`( o.o )`: 2 symbols vs 2 letters) trips it, while a normal sentence
 * (symbols are rare against its letters) and a one-word reply like "네!"
 * (common punctuation is not counted as a drawing symbol) never do.
 */
export function isArtLine(line: string): boolean {
  const stripped = stripEmojiForSpeech(line);
  const letters = stripped.match(SPEAKABLE)?.length ?? 0;
  const symbols = stripped.match(ART_SYMBOLS)?.length ?? 0;
  return letters === 0 || symbols >= letters;
}

/**
 * "노바(Nova)" → "노바": a parenthetical containing ONLY ASCII (romanized
 * spelling) doubles the name when read aloud (발주자 지적 — "노바 노바" 금지),
 * so it is dropped from SPEECH. Korean parentheticals ("(참고)") are kept.
 */
const ASCII_PARENTHETICAL = /\s*\(\s*[A-Za-z0-9 .,'/-]*\s*\)/g;

/**
 * The SPEAKABLE prose of a reply (발주자: 이모지·문자 그림은 낭독 금지, 글로
 * 적은 것만): emojis + romanized parentheticals stripped, then every art-like
 * line dropped whole, keeping only real sentences. May return "" (an art-only
 * reply is simply not spoken).
 */
export function speechOnlyText(text: string): string {
  return text
    .replace(ASCII_PARENTHETICAL, "")
    .split(/\r?\n/)
    .filter((line) => !isArtLine(line))
    .map((line) => stripEmojiForSpeech(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
