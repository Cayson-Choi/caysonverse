import { describe, it, expect } from "vitest";
import type { EscapeEventPayload } from "@caysonverse/shared/escape/messages";
import { HINT_GAP_MS } from "@caysonverse/shared/escape/constants";
import {
  FINALE_GUIDE,
  FIRST_TRY_START,
  HINT_CONFIRM_TEXT,
  HINT_START,
  circled,
  cooldownText,
  elapsedText,
  firstTryReduce,
  firstTryText,
  hintButtonState,
  hintReducer,
  hintWaitS,
  voteChips,
  voteProgress,
} from "./finale";

const members = [
  { sid: "s1", nickname: "가람" },
  { sid: "s2", nickname: "나래" },
  { sid: "s3", nickname: "다온" },
];

describe("voteChips", () => {
  it("voteChips groups nicknames by option and ignores departed members", () => {
    const chips = voteChips({ s1: "privacy", s2: "reliability", s3: "privacy", gone: "privacy" }, members);
    expect(chips).toEqual({ privacy: ["가람", "다온"], reliability: ["나래"] });
  });

  it("lists the names in the order the members came in, not the order of the votes", () => {
    const chips = voteChips({ s3: "a", s1: "a", s2: "a" }, members);
    expect(chips.a).toEqual(["가람", "나래", "다온"]);
  });

  it("is empty when nobody has chosen (or the only voters left) and never reads a prototype key", () => {
    expect(voteChips({}, members)).toEqual({});
    expect(voteChips({ gone: "privacy" }, members)).toEqual({});
    expect(voteChips({ s1: "privacy" }, [])).toEqual({});
    const chips = voteChips({ s1: "constructor", s2: "__proto__" }, members);
    expect(Object.keys(chips).sort()).toEqual(["__proto__", "constructor"].sort());
    expect(chips.constructor).toEqual(["가람"]);
    expect(Object.getPrototypeOf(chips)).toBe(null);
  });
});

describe("voteProgress", () => {
  it("counts the members who have chosen, ignoring departed voters", () => {
    expect(voteProgress({ s1: "a", s2: "b", gone: "a" }, members)).toEqual({ chosen: 2, total: 3 });
    expect(voteProgress({}, members)).toEqual({ chosen: 0, total: 3 });
    expect(voteProgress({ s1: "a" }, [])).toEqual({ chosen: 0, total: 0 });
  });
});

describe("hintButtonState", () => {
  it("hintButtonState shows the wait and the maxed state", () => {
    expect(hintButtonState({ tierInStage: 0, waitS: 0, maxed: false })).toEqual({ enabled: true, label: "힌트 받기" });
    expect(hintButtonState({ tierInStage: 1, waitS: 27, maxed: false })).toEqual({
      enabled: false,
      label: "다음 힌트까지 27초",
    });
    expect(hintButtonState({ tierInStage: 3, waitS: 0, maxed: true })).toEqual({
      enabled: false,
      label: "힌트를 모두 받았어요",
    });
  });

  it("the wait only counts once a hint of this stage was given; the end beats the wait", () => {
    expect(hintButtonState({ tierInStage: 0, waitS: 12, maxed: false }).enabled).toBe(true);
    expect(hintButtonState({ tierInStage: 2, waitS: 0, maxed: false })).toEqual({ enabled: true, label: "힌트 받기" });
    expect(hintButtonState({ tierInStage: 3, waitS: 20, maxed: true }).label).toBe("힌트를 모두 받았어요");
  });
});

describe("hint state over the room's events", () => {
  const hint = (tier: number, stageId = "uv"): EscapeEventPayload => ({ e: "hint", stageId, tier, text: "힌트" });

  it("a hint starts the wait for the next one of the same stage", () => {
    const s = hintReducer(HINT_START, hint(1), 10_000);
    expect(s).toMatchObject({ stageId: "uv", tier: 1, maxed: false });
    expect(hintWaitS(s, 10_000)).toBe(HINT_GAP_MS / 1000);
    expect(hintWaitS(s, 10_000 + 1)).toBe(30);
    expect(hintWaitS(s, 10_000 + 29_001)).toBe(1);
    expect(hintWaitS(s, 10_000 + HINT_GAP_MS)).toBe(0);
    expect(hintWaitS(s, 10_000 + HINT_GAP_MS + 5000)).toBe(0);
  });

  it("the third hint is the last of the stage", () => {
    expect(hintReducer(HINT_START, hint(3), 0).maxed).toBe(true);
    expect(hintReducer(HINT_START, hint(2), 0).maxed).toBe(false);
  });

  it("the server's own wait wins (hintWait), rounded up to whole seconds", () => {
    const s = hintReducer(HINT_START, { e: "hintWait", waitS: 17 }, 5000);
    expect(hintWaitS(s, 5000)).toBe(17);
    expect(hintWaitS(s, 5000 + 16_500)).toBe(1);
    expect(hintButtonState({ tierInStage: s.tier, waitS: hintWaitS(s, 5000), maxed: s.maxed }).label).toBe("다음 힌트까지 17초");
    // A wait is a wait even if this client has not seen the hint before it (a refreshed tab).
    expect(s.tier).toBeGreaterThan(0);
  });

  it("hintMax closes the button until the stage changes", () => {
    const maxed = hintReducer(HINT_START, { e: "hintMax" }, 0);
    expect(maxed.maxed).toBe(true);
    expect(hintReducer(maxed, { e: "say", lineId: "x" }, 1).maxed).toBe(true);
  });

  it("a solved lock or a coop switch may start a new stage: the button opens again", () => {
    const waiting = hintReducer(HINT_START, hint(3), 0);
    expect(hintReducer(waiting, { e: "solved", lockId: "cabinet_lock", by: "s1" }, 100)).toEqual(HINT_START);
    expect(hintReducer(waiting, { e: "coopDone", coopId: "safe_keys" }, 100)).toEqual(HINT_START);
  });

  it("other events change nothing, and the old state is never modified", () => {
    const s = hintReducer(HINT_START, hint(1), 0);
    const frozen = JSON.stringify(s);
    for (const ev of [
      { e: "votes" },
      { e: "members" },
      { e: "finale", step: 1 },
      { e: "picked", item: "x", by: "s1" },
      { e: "wrong", lockId: "cabinet_lock" },
    ] as EscapeEventPayload[]) {
      expect(hintReducer(s, ev, 99)).toBe(s);
    }
    expect(JSON.stringify(s)).toBe(frozen);
    expect(HINT_START).toEqual({ stageId: null, tier: 0, waitUntil: 0, maxed: false });
  });

  it("no wait is read from a stage that has not had a hint", () => {
    expect(hintWaitS(HINT_START, 0)).toBe(0);
    expect(hintWaitS({ ...HINT_START, waitUntil: 99_000 }, 0)).toBe(0);
  });
});

describe("first try at the principle", () => {
  const step0 = "pick_principle";
  const wrong = (stepId: string): EscapeEventPayload => ({ e: "finaleWrong", stepId, optionId: "x", explain: "..." });

  it("a team that saw the whole last door and chose right at once says so", () => {
    const s = firstTryReduce(FIRST_TRY_START, { e: "finale", step: 0 }, step0);
    expect(firstTryText(s)).toBe("원칙을 한 번에 맞혔어요!");
  });

  it("counts the wrong cards of the first step only", () => {
    let s = firstTryReduce(FIRST_TRY_START, { e: "finale", step: 0 }, step0);
    s = firstTryReduce(s, wrong(step0), step0);
    s = firstTryReduce(s, wrong("tell_ari"), step0);
    expect(s.wrongOnFirstStep).toBe(1);
    expect(firstTryText(s)).toBe("다시 생각해서 원칙을 맞혔어요!");
  });

  it("says nothing when this player did not see the start of the last door", () => {
    expect(firstTryText(FIRST_TRY_START)).toBe(null);
    const late = firstTryReduce(FIRST_TRY_START, wrong(step0), step0);
    expect(firstTryText(late)).toBe(null);
    // a later step on its own does not make the start "seen"
    expect(firstTryText(firstTryReduce(FIRST_TRY_START, { e: "finale", step: 1 }, step0))).toBe(null);
  });

  it("going on to the next step keeps what was seen and counted", () => {
    let s = firstTryReduce(FIRST_TRY_START, { e: "finale", step: 0 }, step0);
    s = firstTryReduce(s, wrong(step0), step0);
    s = firstTryReduce(s, { e: "finale", step: 1 }, step0);
    expect(s.wrongOnFirstStep).toBe(1);
    expect(FIRST_TRY_START).toEqual({ seen: false, wrongOnFirstStep: 0 });
  });
});

describe("words and numbers", () => {
  it("circled numbers for the hint and summary lists, then a plain number", () => {
    expect([1, 2, 3].map(circled)).toEqual(["①", "②", "③"]);
    expect(circled(15)).toBe("⑮");
    expect(circled(20)).toBe("⑳");
    expect(circled(21)).toBe("21.");
    expect(circled(0)).toBe("0.");
  });

  it("the play time in minutes and seconds", () => {
    expect(elapsedText(0)).toBe("0초");
    expect(elapsedText(45)).toBe("45초");
    expect(elapsedText(60)).toBe("1분");
    expect(elapsedText(372)).toBe("6분 12초");
    expect(elapsedText(901.7)).toBe("15분 1초");
    expect(elapsedText(-4)).toBe("0초");
    expect(elapsedText(Number.NaN)).toBe("0초");
  });

  it("the cooldown sentence names the seconds", () => {
    expect(cooldownText(30)).toBe("30초 뒤에 다시 고를 수 있어요");
    expect(cooldownText(1)).toBe("1초 뒤에 다시 고를 수 있어요");
  });

  it("carries the brief's fixed sentences word for word", () => {
    expect(FINALE_GUIDE).toBe("모두 같은 카드를 고르면 아리에게 말해요");
    expect(HINT_CONFIRM_TEXT).toBe("힌트를 쓰면 별이 줄 수 있어요. 받을까요?");
  });
});
