import { describe, it, expect } from "vitest";
import { CHAT_NOT_NICE, checkProfanity, foldHangul } from "./profanity";

// The cases from the task brief: spacing, digits, fortis, elongation, fullwidth, jamo.
const BAD = [
  "시발", "씨발", "씨1발", "시.발", "시 발", "시이이발", "쉬발", "씨팔", "ㅅㅂ", "ㅆㅂ", "ㅅ발", "ㅄ",
  "병신", "븅신", "좆", "존나 웃겨", "개새끼", "게세끼", "sibal", "s1bal", "f u c k", "SHIT", "ｆｕｃｋ", "ㅗ",
];
const GOOD = [
  "좋아", "상자", "평신도", "시발점", "도시 발전", "시 발표 했어", "수박", "사발면", "시바견 귀여워",
  "새끼 고양이", "발표 시작해요", "ㅋㅋㅋ", "안녕 반가워",
];

// Every entry of the word lists, so a typo in the table cannot hide behind the spot checks.
const KOREAN_WORDS = [
  "시발", "씨발", "시팔", "씨팔", "시바", "병신", "븅신", "좆", "존나", "졸라", "지랄", "개새끼",
  "엠창", "느금", "미친놈", "미친년", "또라이", "ㅅㅂ", "ㅂㅅ", "ㅈㄴ", "ㅈㄹ", "ㄱㅅㄲ", "ㅗ",
];
const LATIN_WORDS = ["sibal", "sival", "shibal", "fuck", "fuk", "shit", "bitch"];

// Ordinary classroom talk that must never trip the filter (children use this chat).
const KID_TALK = [
  "안녕하세요!", "반가워요~", "오늘 여기 사람 많네요", "화이팅!", "다들 뭐하고 계세요?", "ㅎㅎㅎ",
  "좋은 하루 되세요", "여기 좋다", "서랍이 안 열려요", "비밀번호가 뭘까?", "힌트 좀 줘", "정답 찾았다",
  "자물쇠 번호 맞아?", "열쇠는 책장 뒤에 있어", "개인정보는 소중해요", "친구랑 같이 풀자", "hello world", "good job",
];

describe("checkProfanity", () => {
  it.each(BAD)("blocks %s", (t) => expect(checkProfanity(t).ok).toBe(false));
  it.each(GOOD)("allows %s", (t) => expect(checkProfanity(t)).toEqual({ ok: true }));

  it.each(KOREAN_WORDS)("blocks the listed word %s on its own", (w) => {
    expect(checkProfanity(w).ok).toBe(false);
  });
  it.each(KOREAN_WORDS)("blocks the listed word %s inside a sentence", (w) => {
    expect(checkProfanity(`너 정말 ${w} 같아`).ok).toBe(false);
  });
  it.each(LATIN_WORDS)("blocks the listed latin word %s", (w) => {
    expect(checkProfanity(w).ok).toBe(false);
    expect(checkProfanity(w.toUpperCase()).ok).toBe(false);
  });
  it.each(KID_TALK)("allows ordinary classroom talk: %s", (t) => {
    expect(checkProfanity(t)).toEqual({ ok: true });
  });

  it("masks only the offending word for the teacher view", () =>
    expect(checkProfanity("너 진짜 시발 왜 그래")).toEqual({ ok: false, masked: "너 진짜 ●● 왜 그래" }));

  it("masks a spaced-out word as one word, and caps a long mask at six dots", () => {
    expect(checkProfanity("시 발")).toEqual({ ok: false, masked: "●●" });
    expect(checkProfanity("ㅅㅂㅅㅂㅅㅂㅅㅂㅅㅂ")).toEqual({ ok: false, masked: "●●●●●●" });
    expect(checkProfanity("진짜 f u c k 해요")).toEqual({ ok: false, masked: "진짜 ●●●● 해요" });
  });

  it("never carries the offending text into the masked line", () => {
    const r = checkProfanity("진짜 개새끼 같네");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.masked).toBe("진짜 ●●● 같네");
      expect(r.masked).not.toContain("새끼");
    }
  });

  it("masks every offending word, not just the first", () => {
    expect(checkProfanity("시발 병신 아님")).toEqual({ ok: false, masked: "●● ●● 아님" });
  });

  it("sees through elongation, fortis and the first-consonant shorthand", () => {
    for (const t of ["시이이이이발", "씨이이발", "씨씨발", "ㅅ발", "ㅅㅂ", "ㅆㅂ", "ㅆ발"]) {
      expect(checkProfanity(t).ok, t).toBe(false);
    }
  });

  it("sees through digits, punctuation and fullwidth letters inside latin words", () => {
    for (const t of ["sh1t", "F.U.C.K", "fffuuuck", "b!tch", "ｓｈｉｔ", "s h i t", "$h1t"]) {
      expect(checkProfanity(t).ok, t).toBe(false);
    }
  });

  it("ignores zero-width and control characters slipped between letters", () => {
    expect(checkProfanity("시​발").ok).toBe(false);
    expect(checkProfanity("씨\u0007발").ok).toBe(false);
    expect(checkProfanity("f‍uck").ok).toBe(false);
  });

  it("keeps the allow-listed words that merely contain a blocked sound", () => {
    for (const t of ["시발점", "시발역", "시바견", "시바이누", "이번 시발역에서 만나"]) {
      expect(checkProfanity(t), t).toEqual({ ok: true });
    }
    // The allow-list removes only the allowed word: a real swear next to it still blocks.
    expect(checkProfanity("시발점 시발").ok).toBe(false);
  });

  it("does not glue two-letter-or-longer words together", () => {
    expect(checkProfanity("도시 발전")).toEqual({ ok: true });
    expect(checkProfanity("도시 발표")).toEqual({ ok: true });
  });

  it("allows an empty line or one that is only spaces and punctuation", () => {
    for (const t of ["", "   ", "...", "?!"]) expect(checkProfanity(t), t).toEqual({ ok: true });
  });

  it("is a pure function: the same line gives the same answer every time", () => {
    const first = checkProfanity("너 진짜 시발 왜 그래");
    expect(checkProfanity("너 진짜 시발 왜 그래")).toEqual(first);
    expect(checkProfanity("좋아")).toEqual(checkProfanity("좋아"));
  });
});

describe("foldHangul", () => {
  it("folds fortis and elongation but keeps aspirates and finals", () => {
    expect(foldHangul("씨발")).toBe(foldHangul("시발"));
    expect(foldHangul("좋")).not.toBe(foldHangul("좆"));
  });

  it("folds only the ㄲ and ㅆ finals, never the representative-sound ones", () => {
    expect(foldHangul("밖")).toBe(foldHangul("박"));
    expect(foldHangul("있")).toBe(foldHangul("잇"));
    expect(foldHangul("밭")).not.toBe(foldHangul("받"));
    expect(foldHangul("평신도")).not.toBe(foldHangul("병신도"));
  });

  it("collapses a repeated empty-consonant vowel into one syllable", () => {
    expect(foldHangul("시이이발")).toBe(foldHangul("시발"));
    expect(foldHangul("아아아")).toBe(foldHangul("아"));
  });

  it("brackets every syllable with | so a match can never straddle half a syllable", () => {
    const folded = foldHangul("시발");
    expect(folded.startsWith("|")).toBe(true);
    expect(folded.endsWith("|")).toBe(true);
    expect(folded.split("|").filter(Boolean)).toHaveLength(2);
  });

  it("returns an empty string for text without hangul", () => {
    expect(foldHangul("abc 123")).toBe("");
    expect(foldHangul("")).toBe("");
  });

  it("splits ㅄ into ㅂ and ㅅ, and folds the doubled jamo", () => {
    expect(foldHangul("ㅄ")).toBe(foldHangul("ㅂㅅ"));
    expect(foldHangul("ㅆㅂ")).toBe(foldHangul("ㅅㅂ"));
  });
});

describe("CHAT_NOT_NICE", () => {
  it("is the kind Korean sentence the sender sees", () => {
    expect(CHAT_NOT_NICE).toBe("고운 말로 다시 써 볼까요?");
  });
});
