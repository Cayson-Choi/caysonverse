/**
 * A tiny room for the puzzle-engine tests (Task 7; Task 8 adds a coop device, split drawers and
 * a two-step finale). Test data only: no client code imports it.
 *
 * Flow: pick up a (shelf), then b (drawer, only after a) → combine a + b → ab → digits lock lk_d
 * on the panel (needs ab in the bag, answer "123") → letters lock lk_l on the same panel (after
 * lk_d, wheels 가/나 · 다/라, answer 나라, gives the cards) → sort lock lk_s on the board (needs
 * the cards, c1 → x, c2 → y, sets "ready") → finale.
 */

import { PRINCIPLE_SOURCE } from "@caysonverse/shared/escape/principles";
import type { RoomDef } from "../types";

export const miniRoom: RoomDef = {
  id: "counsel",
  title: "작은 시험 방",
  principleIds: ["privacy"],
  objects: [
    {
      id: "shelf",
      label: "책꽂이",
      kind: "inspect",
      inspect: { title: "책꽂이", body: "책 사이에 손전등이 끼어 있어요." },
      pickup: { item: "a" },
    },
    {
      id: "drawer",
      label: "서랍",
      kind: "inspect",
      inspect: {
        title: "서랍",
        body: { easy: "서랍 안에 보라색 필름이 있어요.", hard: "서랍 속에 얇은 보라색 필름 한 장이 놓여 있다." },
        states: [{ when: { all: ["picked:b"] }, body: "서랍이 텅 비었어요." }],
      },
      pickup: { item: "b", when: { all: ["picked:a"] } },
    },
    {
      id: "panel",
      label: "번호판",
      kind: "inspect",
      inspect: {
        title: "번호판",
        body: "숫자 칸과 글자 칸이 있는 판이에요.",
        // Order matters: with both locks solved, the first state wins.
        states: [
          { when: { all: ["solved:lk_l"] }, body: "판이 모두 열렸어요." },
          { when: { all: ["solved:lk_d"] }, body: "숫자 칸이 열렸어요." },
        ],
      },
      locks: ["lk_d", "lk_l"],
    },
    {
      id: "poster",
      label: "포스터",
      kind: "inspect",
      inspect: {
        title: { easy: "벽 포스터", hard: "게시판 포스터" },
        body: "평범한 학급 안내 포스터예요.",
        back: { easy: "뒷면은 비어 있어요.", hard: "뒷면에는 아무것도 적혀 있지 않다." },
        image: "poster",
        reveal: { item: "ab", text: "숨은 글씨: 첫 바퀴는 둘째 글자, 둘째 바퀴도 둘째 글자" },
      },
    },
    {
      id: "board",
      label: "분류판",
      kind: "inspect",
      inspect: { title: "분류판", body: "카드를 두 칸에 나눠 놓는 판이에요." },
      locks: ["lk_s"],
    },
    {
      id: "exit_door",
      label: "마지막 문",
      kind: "door",
      inspect: { title: "마지막 문", body: "굳게 닫힌 문이에요." },
    },
  ],
  items: [
    { id: "a", label: "손전등", icon: "flashlight" },
    { id: "b", label: "보라 필름", icon: "film" },
    { id: "ab", label: "자외선 손전등", icon: "uv" },
    { id: "cards", label: "카드 묶음", icon: "cards" },
  ],
  combos: [{ a: "a", b: "b", out: "ab", effects: [{ say: "made_ab" }] }],
  locks: [
    {
      id: "lk_d",
      objectId: "panel",
      kind: "digits",
      length: 3,
      answer: "123",
      plate: { easy: "숫자 세 개를 맞춰요", hard: "세 자리 수를 입력하시오" },
      requires: { items: ["ab"] },
      onSolve: [{ say: "solved_d" }],
    },
    {
      id: "lk_l",
      objectId: "panel",
      kind: "letters",
      wheels: [
        ["가", "나"],
        ["다", "라"],
      ],
      answer: ["나", "라"],
      plate: "글자 두 개를 맞춰요",
      requires: { all: ["solved:lk_d"] },
      onSolve: [{ give: "cards" }],
    },
    {
      id: "lk_s",
      objectId: "board",
      kind: "sort",
      bins: [
        { id: "x", label: "나만 보기" },
        { id: "y", label: "함께 보기" },
      ],
      cards: [
        { id: "c1", label: "내 비밀번호" },
        { id: "c2", label: "학급 시간표" },
      ],
      answer: { c1: "x", c2: "y" },
      needsItem: "cards",
      plate: "카드를 알맞은 칸에 놓아요",
      onSolve: [{ set: "ready" }],
    },
  ],
  coops: [],
  stages: [
    {
      id: "st_items",
      title: "물건 모으기",
      doneWhen: "made:ab",
      hints: ["책꽂이와 서랍을 살펴봐요.", "주운 두 물건을 가방에서 합쳐 봐요.", "손전등과 보라 필름을 합치면 돼요."],
    },
    {
      id: "st_locks",
      title: "자물쇠 열기",
      doneWhen: "solved:lk_l",
      hints: ["포스터를 자외선으로 비춰 봐요.", "숫자는 작은 수부터 차례대로예요.", "숫자 일이삼, 글자는 나와 라예요."],
    },
    {
      id: "st_sort",
      title: "카드 나누기",
      doneWhen: "ready",
      hints: ["카드마다 누가 봐도 되는지 생각해 봐요.", "비밀번호는 나만 알아야 해요.", "비밀번호는 나만 보기, 시간표는 함께 보기예요."],
    },
  ],
  finale: {
    requires: { all: ["ready"] },
    claim: { easy: "친구 사진은 그냥 올려도 돼!", hard: "친구 사진은 허락 없이 올려도 괜찮다." },
    steps: [
      {
        id: "f1",
        prompt: { easy: "어떻게 말해 줄까요?", hard: "어떤 말로 설득할까?" },
        principleId: "privacy",
        options: [
          { id: "o1", label: "먼저 허락을 받아요", desc: "사진 속 친구에게 물어봐요" },
          { id: "o2", label: "몰래 올려요", explain: "몰래 올리면 친구의 사생활을 지킬 수 없어요." },
        ],
        correct: "o1",
      },
    ],
  },
  lines: {
    intro1: { speaker: "ari", text: { easy: "안녕! 문을 함께 열어 보자.", hard: "반가워. 함께 이 방을 빠져나가 보자." } },
    made_ab: { speaker: "bandit", text: "손전등이 보랏빛으로 빛나요!" },
    solved_d: { speaker: "narrator", text: "딸깍, 숫자 칸이 열렸어요." },
    bye1: { speaker: "ari", text: "잘했어! 다음 방에서 또 만나." },
  },
  introLines: ["intro1"],
  escapeLines: ["bye1"],
  summary: {
    lines: [
      { easy: "내 정보는 내가 지켜요.", hard: "개인정보는 스스로 지켜야 한다." },
      "친구 정보도 소중히 다뤄요.",
      "올리기 전에 먼저 물어봐요.",
    ],
    question: { easy: "오늘 무엇을 지켰나요?", hard: "오늘 우리는 무엇을 지켰을까?" },
    source: PRINCIPLE_SOURCE,
  },
};
