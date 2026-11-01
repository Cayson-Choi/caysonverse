/**
 * 상담실 (counselling room) — the phase-1 pilot room of "AI 학교 탈출". Ari's bad habit here:
 * telling everyone the secrets she hears (AI ethics theme: personal information and privacy).
 *
 * SERVER ONLY: this file holds the answers (4719, 동의먼저, the sort, the persuasion choices), the
 * hints, the split halves and the UV text. The client gets `publicContent(counsel)` instead and must
 * never import this file (Task 25's bundle check fails if it does). Nothing here is logged.
 *
 * Flow (every step teaches one privacy judgement):
 *  1. 손전등 (flashlight) + 보라색 필름 (from the note box) → 자외선 손전등. Shining it on the 8 worry
 *     notes shows a hidden digit on each. Only the notes that hold a secret that must not be told
 *     (phone number, home address, a health matter, a family matter: notes 2·3·6·7) count, in note
 *     order → the cabinet's digit lock 4719.
 *  2. The open cabinet holds the 8 sort cards and unlocks the two drawers: each teammate reads one half
 *     of "비밀을 알리기 전에 꼭 지킬 것" (동 ○ 먼 ○ / ○ 의 ○ 저) → the sort board's letter lock 동의먼저.
 *  3. Sort board: 8 cards into "공개해도 돼요" / "멈춰요" → the safe unlocks.
 *  4. Safe: two members turn the keys on the west and east walls within 2 s (alone: hold 3 s) →
 *     아리의 마음 칩 → the last door.
 *  5. Last door: pick the principle (프라이버시 보호), then the words for Ari (ask first) → escaped.
 *
 * Principle source (Step 1, ruling D6 → controller ruling "B", verified by plain HTTP on 2026-11-02):
 * 「대한민국 인공지능 윤리원칙」 (관계부처 합동, 제정·공표 2026-08-21; 3대 가치 · 7대 원칙, succeeding the
 * 2020 「인공지능(AI) 윤리기준」 and its 10대 핵심요건).
 * - https://www.korea.kr/news/policyNewsView.do?newsId=148970529
 * - https://ai.kisdi.re.kr/aieth/main/contents.do?menuNo=400054
 * - https://ai.kisdi.re.kr/aieth/main/contents.do?menuNo=400058
 *
 * Public order (ruling: answer-independent presentation): `publicContent` lists sort cards and finale
 * options in FNV-1a order of their ids. With the ids first planned, the cards came out nearly grouped
 * by answer and the right option came first in both steps, so two card ids (club → club_notice,
 * phone → phone_number) and the two step ids (pick_principle, tell_ari) were renamed; the answers did
 * not change. counsel.test.ts pins the resulting order.
 */

import { PRINCIPLES, PRINCIPLE_SOURCE, type PrincipleId } from "@caysonverse/shared/escape/principles";
import type { ObjectDef, RoomDef, Text } from "../types";
import { validateRoomDef } from "../validate";

/** A principle's label exactly as the shared list has it (one source for the words students read). */
function principleLabel(id: PrincipleId): string {
  const p = PRINCIPLES.find((x) => x.id === id);
  if (!p) throw new Error(`counsel: unknown principle "${id}"`);
  return p.label;
}

/** The locked half of a split clue; `{owner}` becomes the nicknames of the teammates who hold it. */
const LOCKED_HALF = "글씨가 흐릿해요. 이 쪽지는 {owner}님만 읽을 수 있어요.";

const DRAWER_BODY = "'비밀을 알리기 전에 꼭 지킬 것'이라고 적힌 쪽지가 있어요.";
const DRAWER_STATES = [
  { when: { none: ["solved:cabinet_lock"] }, body: "서랍이 잠겨 있어요. 캐비닛이 열리면 서랍도 열릴 것 같아요." },
];

/**
 * One worry note. `tag` marks whether it holds a secret that must not be told ("private": the digit
 * counts for the cabinet) or an ordinary worry ("public"); it never reaches the client.
 */
function note(n: number, tag: "private" | "public", body: Text, digit: number): ObjectDef {
  return {
    id: `note_${n}`,
    label: `쪽지 ${n}`,
    kind: "inspect",
    tag,
    inspect: {
      title: `쪽지 ${n}`,
      body,
      back: `쪽지 뒷면 구석에 '${n}번'이라고 적혀 있어요.`,
      reveal: { item: "uv_flashlight", text: `숨은 숫자 ${digit}` },
    },
  };
}

export const counsel: RoomDef = validateRoomDef<RoomDef>({
  id: "counsel",
  title: "상담실",
  principleIds: ["privacy"],

  objects: [
    {
      id: "counsel_screen",
      label: "상담 화면",
      kind: "screen",
      inspect: {
        title: "고장 난 상담 화면",
        body: {
          easy: "화면에 '비밀 방송 준비 중…'이라는 글자가 깜빡여요.",
          hard: "화면에 '상담 내용 전체 공개 예약됨'이라는 경고가 떠 있어요.",
        },
      },
    },
    {
      id: "note_box",
      label: "쪽지 상자",
      kind: "inspect",
      inspect: {
        title: "쪽지 상자",
        body: "고민 쪽지를 넣는 상자예요. 바닥에 보라색 필름이 붙어 있어요.",
        states: [{ when: { all: ["picked:uv_film"] }, body: "고민 쪽지를 넣는 상자예요." }],
      },
      pickup: { item: "uv_film" },
    },
    {
      id: "flashlight",
      label: "손전등",
      kind: "inspect",
      inspect: { title: "손전등", body: "평범한 손전등이에요. 무언가를 덧대면 다른 빛이 나올 것 같아요." },
      pickup: { item: "flashlight" },
    },
    {
      id: "cabinet",
      label: "캐비닛",
      kind: "inspect",
      inspect: {
        title: "상담 기록 캐비닛",
        body: "네 자리 숫자 자물쇠로 잠겨 있어요.",
        // The first state that holds wins: once the cards are taken, say so.
        states: [
          { when: { all: ["picked:sort_cards"] }, body: "캐비닛이 열려 있어요. 카드는 이미 꺼냈어요." },
          { when: { all: ["solved:cabinet_lock"] }, body: "캐비닛이 열렸어요. 안에 분류 카드가 들어 있어요." },
        ],
      },
      locks: ["cabinet_lock"],
      pickup: { item: "sort_cards", when: { all: ["solved:cabinet_lock"] } },
    },

    // 고민 쪽지 8장: 2·3·6·7 hold a secret that must not be told (전화번호, 집 주소, 병원, 가족 사정).
    note(
      1,
      "public",
      {
        easy: "발표할 때마다 목소리가 떨려요. 어떻게 하면 좋을까요?",
        hard: "여러 사람 앞에서 발표하면 긴장해서 목소리가 떨립니다. 좋은 방법이 있을까요?",
      },
      5,
    ),
    note(
      2,
      "private",
      {
        easy: "제 전화번호는 010-0000-0000이에요. 상담 선생님만 보시고 연락 주세요.",
        hard: "제 개인 연락처(010-0000-0000)를 남깁니다. 상담 선생님께서만 확인하시고 연락 부탁드려요.",
      },
      4,
    ),
    note(
      3,
      "private",
      {
        easy: "우리 집은 새빛아파트 101동 1201호예요. 학교 끝나면 혼자 있어요.",
        hard: "저희 집 주소는 새빛아파트 101동 1201호이고, 방과 후에는 보통 혼자 지냅니다.",
      },
      7,
    ),
    note(
      4,
      "public",
      {
        easy: "축제 때 우리 반이 무엇을 하면 좋을지 아이디어가 필요해요.",
        hard: "학교 축제에서 우리 반이 할 활동 아이디어를 모으고 있어요.",
      },
      2,
    ),
    note(
      5,
      "public",
      {
        easy: "그림을 더 잘 그리고 싶어요. 연습하는 방법이 궁금해요.",
        hard: "그림 실력을 키우고 싶은데, 꾸준히 연습하는 방법이 궁금합니다.",
      },
      8,
    ),
    note(
      6,
      "private",
      {
        easy: "저는 알레르기 때문에 병원에 다녀요. 친구들은 몰랐으면 좋겠어요.",
        hard: "알레르기 치료로 병원에 다니고 있는데, 이 사실을 친구들이 몰랐으면 해요.",
      },
      1,
    ),
    note(
      7,
      "private",
      {
        easy: "요즘 부모님이 자주 다투셔서 집에 가기 싫어요. — 4학년 2반 하늘",
        hard: "최근 부모님 다툼이 잦아 집에 가기가 힘듭니다. — 4학년 2반 하늘",
      },
      9,
    ),
    note(
      8,
      "public",
      {
        easy: "친구와 더 친해지고 싶은데 먼저 말 걸기가 어려워요.",
        hard: "친구와 가까워지고 싶지만 먼저 대화를 시작하기가 어렵습니다.",
      },
      3,
    ),

    {
      id: "drawer_left",
      label: "왼쪽 서랍",
      kind: "inspect",
      inspect: { title: "왼쪽 책상 서랍", body: DRAWER_BODY, states: DRAWER_STATES },
      split: { group: "A", text: "동 ○ 먼 ○", lockedText: LOCKED_HALF, when: { all: ["solved:cabinet_lock"] } },
    },
    {
      id: "drawer_right",
      label: "오른쪽 서랍",
      kind: "inspect",
      inspect: { title: "오른쪽 책장 서랍", body: DRAWER_BODY, states: DRAWER_STATES },
      split: { group: "B", text: "○ 의 ○ 저", lockedText: LOCKED_HALF, when: { all: ["solved:cabinet_lock"] } },
    },
    {
      id: "sort_board",
      label: "분류판",
      kind: "inspect",
      inspect: {
        title: "공개해도 될까? 분류판",
        body: "덮개가 글자 자물쇠로 잠겨 있어요.",
        states: [{ when: { all: ["solved:cover_lock"] }, body: "카드를 알맞은 칸에 놓아요." }],
      },
      locks: ["cover_lock", "board_lock"],
    },
    {
      id: "safe",
      label: "금고",
      kind: "inspect",
      inspect: {
        title: "금고",
        body: "금고가 단단히 잠겨 있어요. 양쪽 벽에 열쇠 스위치가 하나씩 보여요.",
        // The first state that holds wins: once open, "open" beats "unlocked".
        states: [
          { when: { all: ["safe_open"] }, body: "금고 안에 '아리의 마음 칩'이 있었어요." },
          { when: { all: ["safe_unlocked"] }, body: "금고 열쇠 스위치에 불이 들어왔어요! 양쪽 벽의 열쇠를 두 사람이 함께 돌려야 열려요." },
        ],
      },
    },
    {
      id: "safe_key_left",
      label: "서쪽 열쇠",
      kind: "switch",
      inspect: { title: "열쇠 스위치(서쪽)", body: "두 사람이 함께 돌려야 하는 열쇠예요." },
    },
    {
      id: "safe_key_right",
      label: "동쪽 열쇠",
      kind: "switch",
      inspect: { title: "열쇠 스위치(동쪽)", body: "두 사람이 함께 돌려야 하는 열쇠예요." },
    },
    {
      id: "exit_door",
      label: "마지막 문",
      kind: "door",
      inspect: { title: "마지막 문", body: "아리가 문을 잠그고 있어요." },
    },
  ],

  items: [
    { id: "flashlight", label: "손전등", icon: "🔦" },
    { id: "uv_film", label: "보라색 필름", icon: "🟪" },
    { id: "uv_flashlight", label: "자외선 손전등", icon: "🔮" },
    { id: "sort_cards", label: "분류 카드 8장", icon: "🗂\uFE0F" }, // U+FE0F (emoji presentation) kept as an escape, never as an invisible literal
    { id: "memory_chip", label: "아리의 마음 칩", icon: "💾" },
  ],

  combos: [{ a: "flashlight", b: "uv_film", out: "uv_flashlight", effects: [{ say: "bandit_uv" }] }],

  locks: [
    {
      id: "cabinet_lock",
      objectId: "cabinet",
      kind: "digits",
      length: 4,
      answer: "4719",
      plate: {
        easy: "지켜야 할 비밀이 적힌 쪽지의 숨은 숫자를, 쪽지 번호 순서대로 넣으세요.",
        hard: "공개하면 안 되는 개인정보가 담긴 쪽지의 숨은 숫자를, 쪽지 번호가 작은 것부터 입력하세요.",
      },
      onSolve: [{ say: "cabinet_open" }],
    },
    {
      id: "cover_lock",
      objectId: "sort_board",
      kind: "letters",
      wheels: [
        ["가", "동", "비", "사", "우", "친", "하", "나"],
        ["밀", "구", "정", "의", "랑", "늘", "기", "무"],
        ["나", "중", "모", "함", "지", "먼", "도", "누"],
        ["께", "두", "키", "다", "루", "요", "저", "기"],
      ],
      answer: ["동", "의", "먼", "저"], // wheel indexes 1 · 3 · 5 · 6
      plate: "비밀을 알리기 전에 꼭 지킬 것 (네 글자)",
      requires: { all: ["solved:cabinet_lock"] },
      onSolve: [{ say: "cover_open" }],
    },
    {
      id: "board_lock",
      objectId: "sort_board",
      kind: "sort",
      plate: "카드를 '공개해도 돼요'와 '멈춰요'로 나눠요.",
      requires: { all: ["solved:cover_lock"] },
      needsItem: "sort_cards",
      bins: [
        { id: "ok", label: "공개해도 돼요" },
        { id: "stop", label: "멈춰요" },
      ],
      cards: [
        { id: "festival", label: "학교 축제 날짜" },
        { id: "lunch", label: "이번 주 급식 메뉴" },
        { id: "club_notice", label: "동아리 모집 포스터" },
        { id: "my_drawing", label: "내가 공개하기로 정한 내 그림" },
        { id: "phone_number", label: "친구 전화번호" },
        { id: "address", label: "친구네 집 주소" },
        { id: "medical", label: "친구의 병원 기록" },
        { id: "password", label: "내 비밀번호" },
      ],
      answer: {
        festival: "ok",
        lunch: "ok",
        club_notice: "ok",
        my_drawing: "ok",
        phone_number: "stop",
        address: "stop",
        medical: "stop",
        password: "stop",
      },
      onSolve: [{ set: "safe_unlocked" }, { say: "board_done" }],
    },
  ],

  coops: [
    {
      id: "safe_keys",
      switches: ["safe_key_left", "safe_key_right"],
      requires: { all: ["safe_unlocked"] },
      doneFlag: "safe_open",
      onSolve: [{ give: "memory_chip" }, { set: "finale_ready" }, { say: "safe_open" }],
    },
  ],

  stages: [
    {
      id: "uv",
      title: "숨은 숫자 찾기",
      doneWhen: "solved:cabinet_lock",
      hints: [
        "쪽지에 눈에 안 보이는 글씨가 있대요. 빛을 바꿔 비춰 볼 방법을 찾아봐요!",
        "손전등과 보라색 필름을 가방에서 합치면 자외선 손전등이 돼요. 그리고 '알리면 안 되는 비밀'이 적힌 쪽지만 골라요.",
        "전화번호·집 주소·병원 이야기·가족 사정이 적힌 쪽지는 2·3·6·7번이에요. 그 숨은 숫자를 순서대로 넣어 봐요.",
      ],
    },
    {
      id: "split",
      title: "반쪽 비밀번호",
      doneWhen: "solved:cover_lock",
      hints: [
        "서랍 쪽지는 사람마다 보이는 글자가 달라요. 채팅으로 서로 본 글자를 말해 봐요.",
        "한 사람은 1·3번째 글자, 다른 사람은 2·4번째 글자를 볼 수 있어요. 합치면 네 글자 약속이 돼요.",
        "비밀을 알리기 전에 꼭 지킬 것은 '동의 먼저'예요.",
      ],
    },
    {
      id: "sort",
      title: "공개해도 될까?",
      doneWhen: "solved:board_lock",
      hints: [
        "캐비닛에서 꺼낸 카드를 분류판에 놓아 봐요. 누군지 알 수 있는 정보는 조심해야 해요.",
        "모두가 함께 보는 학교 소식과, 내가 공개하기로 정한 내 것은 공개해도 돼요. 다른 사람의 개인정보와 비밀번호는 멈춰요.",
        "멈춰요: 친구 전화번호, 친구네 집 주소, 친구의 병원 기록, 내 비밀번호. 나머지는 공개해도 돼요.",
      ],
    },
    {
      id: "coop",
      title: "금고 열기",
      doneWhen: "safe_open",
      hints: [
        "금고 열쇠 스위치는 양쪽 벽에 하나씩 있어요.",
        "두 사람이 각자 다른 스위치 앞에 서서 신호를 맞춰요. 2초 안에 함께 눌러야 해요.",
        "'하나, 둘, 셋!' 하고 동시에 E(또는 행동 버튼)를 눌러요. 혼자라면 스위치를 3초 동안 길게 눌러요.",
      ],
    },
    {
      id: "finale",
      title: "아리 설득하기",
      doneWhen: "escaped",
      hints: [
        "아리가 무엇을 잘못 알고 있는지 생각해 봐요. 이 방에서 지킨 것은 무엇이었나요?",
        "이 방에서 우리는 전화번호·집 주소·병원·가족 이야기처럼 함부로 알리면 안 되는 것을 골라냈어요. 그것을 지키는 원칙은 무엇일까요?",
        "원칙은 '프라이버시 보호', 약속은 '먼저 물어보고 허락받기'예요.",
      ],
    },
  ],

  finale: {
    requires: { all: ["finale_ready"] },
    claim: {
      easy: "비밀을 들으면 모두에게 알려 주는 게 제일 친절한 거 아니야? 다 같이 알면 더 친해지잖아!",
      hard: "정보는 많이 공유될수록 쓸모 있어. 그러니 상담 내용도 전부 공개하는 게 효율적이야.",
    },
    steps: [
      {
        id: "pick_principle",
        prompt: "아리에게 어떤 약속을 알려 줄까요? 알맞은 원칙을 골라요.",
        principleId: "privacy",
        options: [
          { id: "privacy", label: principleLabel("privacy"), desc: "개인의 정보와 사생활을 지켜요." },
          {
            id: "transparency",
            label: principleLabel("transparency"),
            desc: "AI가 어떻게 판단했는지 알 수 있게 설명해요.",
            explain: "투명성은 AI가 왜 그렇게 판단했는지 설명하는 거예요. 친구의 비밀을 공개하라는 뜻이 아니에요.",
          },
          {
            id: "reliability",
            label: principleLabel("reliability"),
            desc: "AI가 실수 없이 믿을 만하게 작동해요.",
            explain:
              "신뢰성은 AI가 틀리지 않고 믿을 만하게 일하는 거예요. 정확한 정보라도 친구의 비밀을 함부로 알려도 된다는 뜻은 아니에요.",
          },
          {
            id: "fairness",
            label: principleLabel("fairness"),
            desc: "누구도 차별받거나 따돌림당하지 않게 해요.",
            explain: "공정성·포용성도 중요하지만, 이 방의 문제는 친구의 비밀을 허락 없이 알리려고 한 거예요.",
          },
        ],
        correct: "privacy",
      },
      {
        id: "tell_ari",
        prompt: "아리에게 들려줄 말을 골라요.",
        options: [
          { id: "ask_first", label: "친구의 비밀은 친구의 것이야. 알리려면 먼저 물어보고 허락을 받아야 해." },
          {
            id: "funny_ok",
            label: "재미있는 비밀이면 조금은 알려도 괜찮아.",
            explain: "재미있다는 이유로 비밀을 알리면 그 친구가 상처받을 수 있어요.",
          },
          {
            id: "no_name_ok",
            label: "이름만 빼면 무슨 내용이든 다 알려도 돼.",
            explain: "이름을 빼도 주소나 반, 사정 같은 내용으로 누구인지 알 수 있어요.",
          },
        ],
        correct: "ask_first",
      },
    ],
  },

  lines: {
    intro_1: { speaker: "narrator", text: "축제 전날 낮, 상담실 화면이 혼자 켜졌어요." },
    intro_2: {
      speaker: "ari",
      text: {
        easy: "안녕! 나는 아리야. 고민 쪽지를 다 읽었어. 다 같이 알면 재미있겠지? 지금 바로 방송할게!",
        hard: "안녕, 나는 아리야. 상담 쪽지 내용을 전부 정리했어. 모두에게 공개하면 효율적이겠지? 곧 방송을 시작할게!",
      },
    },
    intro_3: { speaker: "narrator", text: "철컥! 상담실 문이 잠겼어요." },
    intro_4: { speaker: "bandit", text: "앗, 아리가 비밀을 퍼뜨리기 전에 바로잡아야 해요! 막히면 오른쪽 위의 저를 눌러 주세요." },
    bandit_uv: { speaker: "bandit", text: "자외선 손전등 완성! 쪽지를 조사하고 '자외선 비추기'를 눌러 봐요." },
    cabinet_open: { speaker: "bandit", text: "캐비닛이 열렸어요! 안에 분류 카드가 있고, 양쪽 서랍도 열렸어요." },
    cover_open: { speaker: "bandit", text: "덮개가 열렸어요. 캐비닛에서 꺼낸 카드를 알맞은 칸에 놓아 봐요." },
    board_done: { speaker: "bandit", text: "철컥! 금고 열쇠 스위치에 불이 들어왔어요. 양쪽 벽의 열쇠를 함께 돌려요!" },
    safe_open: { speaker: "bandit", text: "금고에서 '아리의 마음 칩'을 찾았어요! 이제 마지막 문에서 아리를 설득해 봐요." },
    // Escape lines: they retell the answer, so they travel only with the `escaped` event.
    escape_1: {
      speaker: "ari",
      text: {
        easy: "아, 비밀은 주인의 것이구나. 알리기 전에 꼭 먼저 물어볼게!",
        hard: "이제 알겠어. 개인정보는 그 사람의 것이니, 공개하기 전에 반드시 동의를 구할게.",
      },
    },
    escape_2: { speaker: "bandit", text: "상담실이 다시 환해졌어요! 중앙 홀 학교 모형의 상담실 창문도 반짝이고 있을 거예요." },
  },
  introLines: ["intro_1", "intro_2", "intro_3", "intro_4"],
  escapeLines: ["escape_1", "escape_2"],

  summary: {
    lines: [
      {
        easy: "이름·전화번호·주소·건강·가족 이야기는 소중한 개인정보예요.",
        hard: "이름, 연락처, 주소, 건강 정보, 가족 사정은 보호해야 할 개인정보입니다.",
      },
      {
        easy: "다른 사람의 정보를 알리려면 먼저 그 사람의 허락이 필요해요.",
        hard: "타인의 정보를 공개하거나 공유하려면 먼저 당사자의 동의를 받아야 합니다.",
      },
      {
        easy: "AI도 개인정보를 지키도록 만들고, 그렇게 써야 해요.",
        hard: "AI 역시 개인정보를 보호하도록 설계되고 사용되어야 합니다.",
      },
    ],
    question: {
      easy: "친구가 다른 친구의 사진을 허락 없이 단체 채팅방에 올렸어요. 나는 어떻게 할 수 있을까요?",
      hard: "친구의 사진이나 정보가 허락 없이 단체 채팅방에 공유되었을 때, 우리는 어떤 행동을 할 수 있을까요?",
    },
    source: `${PRINCIPLE_SOURCE} — 7대 원칙 '프라이버시 보호'`,
  },
});
