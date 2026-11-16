import { checkProfanity } from "../rooms/profanity";

/**
 * Text people leave in the memorial (claim name / line now; guestbook and captions in memorial-2 W1): the chat's profanity
 * filter plus advertising shapes (memorial-2 Appendix "Moderation filter additions"). Server only. A refused text is never
 * stored or logged.
 */
const AD_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /www\./i,
  /\.(com|net|kr|io|me|co|org|xyz|shop|site|link|ly)\b/i,
  /0\d{1,2}[- .]?\d{3,4}[- .]?\d{4}/, // phone
  /\d{9,}/, // account / phone number runs
  /@[A-Za-z0-9_.]{2,}/, // handles
  /오픈\s*채팅|카톡|텔레\s*그램|텔레|라인\s*아이디|디엠|dm\s*주세요/i,
  /(.)\1{5,}/u, // the same character more than 5 times in a row
];

export function isAdLike(text: string): boolean {
  const compact = text.normalize("NFC");
  return AD_PATTERNS.some((re) => re.test(compact));
}

/** True when the text may be shown to other visitors. */
export function textIsNice(text: string): boolean {
  if (!text) return true;
  return checkProfanity(text).ok && !isAdLike(text);
}
