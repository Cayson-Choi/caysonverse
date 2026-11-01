import { describe, expect, expectTypeOf, it } from "vitest";
import type { PublicLock, RoomContent } from "@caysonverse/shared/escape/messages";
import { bundleNeedles, publicContent, resolveText, secretStrings } from "./content";
import { miniRoom } from "./__fixtures__/miniRoom";
import type { RoomDef } from "./types";

const def = miniRoom;

/** Every string (keys and values) inside a JSON-like value. */
function leaves(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) for (const v of x) leaves(v, out);
  else if (x && typeof x === "object")
    for (const [k, v] of Object.entries(x)) {
      out.push(k);
      leaves(v, out);
    }
  return out;
}

/** A string as esbuild prints it with charset=ascii: each non-ASCII UTF-16 unit as a \uXXXX escape. */
function asciiEscaped(s: string, upper = true): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7e) {
      const h = c.toString(16).padStart(4, "0");
      out += "\\u" + (upper ? h.toUpperCase() : h);
    } else out += s[i];
  }
  return out;
}

const hit = (needles: readonly RegExp[], text: string) => needles.filter((n) => n.test(text)).map(String);

describe("resolveText", () => {
  it("picks the level's sentence; a plain string serves both levels", () => {
    expect(resolveText({ easy: "쉬운 말", hard: "어려운 말" }, "easy")).toBe("쉬운 말");
    expect(resolveText({ easy: "쉬운 말", hard: "어려운 말" }, "hard")).toBe("어려운 말");
    expect(resolveText("한 문장", "hard")).toBe("한 문장");
  });
});

describe("publicContent", () => {
  it("publicContent(miniRoom) contains none of secretStrings(miniRoom) and resolves Text by level", () => {
    const secrets = secretStrings(def);
    expect(secrets.length).toBeGreaterThan(10);
    for (const level of ["easy", "hard"] as const) {
      const strings = leaves(publicContent(def, level));
      const leaked = secrets.filter((sec) => strings.some((p) => p.includes(sec)));
      expect(leaked, level).toEqual([]);
    }

    const easy = publicContent(def, "easy");
    const hard = publicContent(def, "hard");
    expect(easy.locks[0].plate).toBe("숫자 세 개를 맞춰요");
    expect(hard.locks[0].plate).toBe("세 자리 수를 입력하시오");
    expect(easy.lines.intro1).toEqual({ speaker: "ari", text: "안녕! 문을 함께 열어 보자." });
    expect(hard.lines.intro1.text).toBe("반가워. 함께 이 방을 빠져나가 보자.");
    expect(easy.finale.claim).toBe("친구 사진은 그냥 올려도 돼!");
    expect(hard.finale.steps[0].prompt).toBe("어떤 말로 설득할까?");
  });

  it("keeps only the public fields (no answers, requires, onSolve, explain, inspect text)", () => {
    const c: RoomContent = publicContent(def, "easy");
    expect(c.roomId).toBe("counsel");
    expect(c.title).toBe("작은 시험 방");
    expect(c.objects).toContainEqual({ id: "exit_door", label: "마지막 문", kind: "door" });
    for (const o of c.objects) expect(Object.keys(o).sort()).toEqual(["id", "kind", "label"]);
    expect(c.items[0]).toEqual({ id: "a", label: "손전등", icon: "flashlight" });
    expect(c.locks).toEqual([
      { id: "lk_d", objectId: "panel", plate: "숫자 세 개를 맞춰요", kind: "digits", length: 3 },
      { id: "lk_l", objectId: "panel", plate: "글자 두 개를 맞춰요", kind: "letters", wheels: [["가", "나"], ["다", "라"]] },
      {
        id: "lk_s",
        objectId: "board",
        plate: "카드를 알맞은 칸에 놓아요",
        kind: "sort",
        bins: [
          { id: "x", label: "나만 보기" },
          { id: "y", label: "함께 보기" },
        ],
        cards: [
          { id: "c1", label: "내 비밀번호" },
          { id: "c2", label: "학급 시간표" },
        ],
        needsItem: "cards",
      },
    ]);
    expect(c.stages).toEqual([
      { id: "st_items", title: "물건 모으기" },
      { id: "st_locks", title: "자물쇠 열기" },
      { id: "st_sort", title: "카드 나누기" },
    ]);
    expect(c.finale.steps[0].options).toEqual([
      { id: "o1", label: "먼저 허락을 받아요", desc: "사진 속 친구에게 물어봐요" },
      { id: "o2", label: "몰래 올려요" },
    ]);
    expect(Object.keys(c.finale.steps[0]).sort()).toEqual(["id", "options", "prompt"]);
    expect([c.introLines, c.escapeLines]).toEqual([["intro1"], ["bye1"]]);
    // the projection is a copy: changing it cannot reach the server's room data
    (c.locks[1] as Extract<PublicLock, { kind: "letters" }>).wheels[0][0] = "X";
    expect(def.locks[1].kind === "letters" && def.locks[1].wheels[0][0]).toBe("가");
    // type level: no public lock shape can carry an answer
    expectTypeOf<Extract<PublicLock, { answer: unknown }>>().toEqualTypeOf<never>();
  });
});

describe("secretStrings", () => {
  it("lists answers, split and UV texts, hints, explanations and the summary — not public copy", () => {
    const withSplit: RoomDef = {
      ...def,
      objects: [
        ...def.objects,
        {
          id: "dA",
          label: "왼쪽 서랍",
          kind: "inspect",
          inspect: { title: "왼쪽 서랍", body: "반쪽 쪽지가 있어요." },
          split: { group: "A", text: "반쪽 단서: 첫 숫자는 하나", lockedText: "{owner}님만 볼 수 있어요" },
        },
      ],
    };
    const secrets = secretStrings(withSplit);
    expect(secrets).toEqual(
      expect.arrayContaining([
        "123", // digits answer
        "나라", // letters answer, joined
        "반쪽 단서: 첫 숫자는 하나",
        "숨은 글씨: 첫 바퀴는 둘째 글자, 둘째 바퀴도 둘째 글자",
        ...def.stages.flatMap((st) => st.hints),
        "몰래 올리면 친구의 사생활을 지킬 수 없어요.",
        "내 정보는 내가 지켜요.",
        "개인정보는 스스로 지켜야 한다.",
        "친구 정보도 소중히 다뤄요.",
        "올리기 전에 먼저 물어봐요.",
        "오늘 무엇을 지켰나요?",
        "오늘 우리는 무엇을 지켰을까?",
      ]),
    );
    expect(secrets).toHaveLength(new Set(secrets).size);
    // public or template text is not a secret: the source line, the locked-half template, labels, wheel letters
    for (const pub of [def.summary.source, "{owner}님만 볼 수 있어요", "마지막 문", "나", "라"]) expect(secrets).not.toContain(pub);
  });
});

describe("bundleNeedles", () => {
  it("bundleNeedles match a minified literal and its \\u-escaped form", () => {
    const needles = bundleNeedles(def);
    for (const n of needles) expect(n.flags, String(n)).not.toMatch(/[gy]/); // test() stays stateless

    const hintText = def.stages[1].hints[2];
    const literal = `var e={hints:["${hintText}","x"]};`;
    expect(hit(needles, literal)).not.toEqual([]);
    expect(hit(needles, asciiEscaped(literal))).not.toEqual([]);
    expect(hit(needles, asciiEscaped(literal, false))).not.toEqual([]);
    for (const sec of ["몰래 올리면 친구의 사생활을 지킬 수 없어요.", "오늘 우리는 무엇을 지켰을까?"]) {
      expect(hit(needles, `t="${sec}"`), sec).not.toEqual([]);
      expect(hit(needles, asciiEscaped(`t="${sec}"`)), sec).not.toEqual([]);
    }

    // digits answer: as a quoted literal only (a bare 123 in code is not the answer)
    for (const q of [`answer:"123"`, `answer:'123'`, "answer:`123`"]) expect(hit(needles, q), q).not.toEqual([]);
    for (const clean of ["n=123;", `y="1234"`, `z="0123"`]) expect(hit(needles, clean), clean).toEqual([]);

    // letters answer: the array literal and the joined word, plain or escaped
    for (const q of [`answer:["나","라"]`, `answer:['나', '라']`, `answer:["\\uB098","\\uB77C"]`, `w="나라"`, `w="\\ub098\\ub77c"`])
      expect(hit(needles, q), q).not.toEqual([]);
  });

  it("no public string is a needle (E9): public labels like 마지막 문 never trip the bundle check", () => {
    const needles = bundleNeedles(def);
    expect(needles.length).toBeGreaterThan(10);
    for (const level of ["easy", "hard"] as const) {
      const content = publicContent(def, level);
      for (const p of leaves(content)) {
        for (const form of [p, JSON.stringify(p), asciiEscaped(JSON.stringify(p))]) expect(hit(needles, form), form).toEqual([]);
      }
      const json = JSON.stringify(content);
      expect(hit(needles, json)).toEqual([]);
      expect(hit(needles, asciiEscaped(json))).toEqual([]);
    }

    // a secret that is also public text is dropped (it is in the client anyway); short or
    // non-Korean secrets never become bare needles (they would match ordinary code)
    const overlap: RoomDef = {
      ...def,
      summary: { ...def.summary, question: "마지막 문" },
      objects: def.objects.map((o) => (o.id === "poster" ? { ...o, inspect: { ...o.inspect, reveal: { item: "ab", text: "47" } } } : o)),
    };
    expect(secretStrings(overlap)).toEqual(expect.arrayContaining(["마지막 문", "47"]));
    const n2 = bundleNeedles(overlap);
    for (const form of ["마지막 문", `"마지막 문"`, asciiEscaped(`"마지막 문"`), `x="47"`, "47"]) expect(hit(n2, form), form).toEqual([]);
    expect(hit(n2, `answer:"123"`)).not.toEqual([]); // the other secrets are still caught
    expect(hit(n2, `"${resolveText(def.summary.lines[1], "easy")}"`)).not.toEqual([]);
  });
});
