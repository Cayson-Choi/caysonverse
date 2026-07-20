import { describe, expect, it } from "vitest";
import { isArtLine, speechOnlyText, stripEmojiForSpeech } from "./speech";

describe("stripEmojiForSpeech (NPC 음성 이모지 제외)", () => {
  it("strips simple emojis while keeping the sentence intact", () => {
    expect(stripEmojiForSpeech("안녕하세요! 🙂 반가워요 👋")).toBe("안녕하세요! 반가워요");
  });

  it("strips ZWJ sequences, skin tones, flags and keycaps as whole units", () => {
    expect(stripEmojiForSpeech("가족 👨‍👩‍👧‍👦 여행 🇰🇷 좋아요 👍🏽")).toBe("가족 여행 좋아요");
    expect(stripEmojiForSpeech("1️⃣번을 눌러요")).toBe("1번을 눌러요");
  });

  it("keeps ordinary text, digits and punctuation untouched", () => {
    const plain = "AI 조교예요. 3가지 방(강의실/갤러리/미로)이 있어요 — #1 추천!";
    expect(stripEmojiForSpeech(plain)).toBe(plain);
  });

  it("collapses the whitespace holes emojis leave behind", () => {
    expect(stripEmojiForSpeech("좋아요 🎉 🎉 🎉 최고")).toBe("좋아요 최고");
  });

  it("returns an empty string for emoji-only lines (caller skips speech)", () => {
    expect(stripEmojiForSpeech("🙂🙂🎉")).toBe("");
    expect(stripEmojiForSpeech("  🙂  ")).toBe("");
  });
});

describe("speechOnlyText (문자 그림 낭독 금지 — 글로 적은 것만)", () => {
  const catReply = [
    "귀여운 고양이를 그려 드릴게요!",
    " /\\_/\\ ",
    "( o.o )",
    " > ^ < ",
    "마음에 드셨으면 좋겠어요.",
  ].join("\n");

  it("classifies drawing lines as art and prose lines as speech", () => {
    expect(isArtLine("( o.o )")).toBe(true);
    expect(isArtLine(" /\\_/\\ ")).toBe(true);
    expect(isArtLine("🐱🐱🐱")).toBe(true);
    expect(isArtLine("귀여운 고양이를 그려 드릴게요!")).toBe(false);
    expect(isArtLine("미로는 서쪽에 있어요.")).toBe(false);
  });

  it("speaks only the prose around an ASCII drawing", () => {
    expect(speechOnlyText(catReply)).toBe("귀여운 고양이를 그려 드릴게요! 마음에 드셨으면 좋겠어요.");
  });

  it("returns empty for an art-only reply (nothing is spoken)", () => {
    expect(speechOnlyText(" /\\_/\\ \n( o.o )\n > ^ < ")).toBe("");
  });

  it("keeps a plain multi-line prose reply intact (joined by spaces)", () => {
    expect(speechOnlyText("첫째 줄이에요.\n둘째 줄이에요.")).toBe("첫째 줄이에요. 둘째 줄이에요.");
  });

  it("drops romanized parentheticals so '노바(Nova)' is spoken ONCE (발주자 지적)", () => {
    expect(speechOnlyText("제 이름은 노바(Nova)예요.")).toBe("제 이름은 노바예요.");
    expect(speechOnlyText("아르티(Arty)라고 불러 주세요.")).toBe("아르티라고 불러 주세요.");
    // Korean parentheticals stay — they carry real content.
    expect(speechOnlyText("3가지 방(강의실/갤러리/미로)이 있어요.")).toBe(
      "3가지 방(강의실/갤러리/미로)이 있어요.",
    );
  });
});
