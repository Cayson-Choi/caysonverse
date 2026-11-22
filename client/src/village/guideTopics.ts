/**
 * The plaza guide's help pages (마을 안내원, owner-approved design 2026-11-20 "이대로 만들어"): the dialog opens on topic cards, and
 * each card opens a page with a one-line summary, numbered steps (each with a small icon), a short Q&A list, and at the bottom
 * "지도에서 보기" (the map, framed on the topic's place) and "같이 가요" (the avatar walks there, mapWalk.ts) where the topic has
 * a place.
 *
 * Every line here comes from the code or from the guide's earlier Q&As (shared/src/village/guides.ts history): the house code and
 * its 8-person limit (HOUSE_POLICY, villageKeypad.ts), the five rides and their seats (shared/src/land/*, CoasterHud.tsx), the
 * fishing words (lakeHudModel.ts, fishing.ts), the hall's cubby card (cubbyCard.ts, memorialSheets.ts), the star finder
 * (finderRules.ts, StarFinder.tsx), the bus (transit.ts), the keys (hotkeys.ts, coach.ts, MenuPanel.tsx). Nothing is invented: no
 * prices, no features that are not shipped (the hall's flowers, guestbook and ceremony are not in the client yet, so they are not
 * here). When the code changes, change the words here too.
 *
 * Pure data and a few pure helpers (no React, no three.js): GuideDialog.tsx draws it, guideTopics.test.ts checks it.
 */
import type { Point2 } from "@caysonverse/shared/village/villageLayout";
import { MAP_PLACES, mapPlace, type MapPlace } from "./villagePlaces";

export type GuideIconId =
  | "hello"
  | "walk"
  | "tap"
  | "map"
  | "door"
  | "chat"
  | "compass"
  | "fountain"
  | "candle"
  | "building"
  | "house"
  | "bus"
  | "lake"
  | "gate"
  | "search"
  | "updown"
  | "heart"
  | "quiet"
  | "keypad"
  | "stairs"
  | "sofa"
  | "wheel"
  | "ride"
  | "clock"
  | "look"
  | "exit"
  | "rod"
  | "chair"
  | "float"
  | "fight"
  | "book"
  | "star"
  | "moon"
  | "aim"
  | "zoom"
  | "keyboard"
  | "mouse"
  | "stick"
  | "eye"
  | "hand"
  | "menu"
  | "seat";

export interface GuideStep {
  icon: GuideIconId;
  text: string;
}

export interface GuideTopicQA {
  /** Unique across the topics (the e2e and the dialog key on it). */
  id: string;
  question: string;
  /** 1-3 short "~요" sentences. */
  answer: string;
}

/**
 * Where a topic's place is: a map place (villagePlaces.ts MAP_PLACES id), or the nearest house to the player, or a spot of its
 * own (the fountain: the plaza's map place is the hub where newcomers stand, so "같이 가요" walks to the fountain's rim instead).
 */
export type GuidePlaceRef =
  | { kind: "place"; id: string }
  | { kind: "nearestHouse" }
  | { kind: "spot"; id: string; name: string; label: Point2; route: readonly Point2[] };

export interface GuideTopic {
  id: string;
  icon: GuideIconId;
  title: string;
  summary: string;
  steps: readonly GuideStep[];
  qas: readonly GuideTopicQA[];
  /** "지도에서 보기": the map framed on this place (its label picked). Absent: no map button. */
  map?: GuidePlaceRef;
  /** "같이 가요": walk there. Absent: nowhere to go (the star finder, the controls). */
  go?: GuidePlaceRef;
}

const p = (x: number, z: number): Point2 => ({ x, z });

/** The fountain's rim, south side, between the basin (16 m across) and its south bench (11 m out): where "같이 가요" stops. */
export const FOUNTAIN_SPOT = p(0, 9.2);
const FOUNTAIN: GuidePlaceRef = { kind: "spot", id: "fountain", name: "분수", label: p(0, 0), route: [FOUNTAIN_SPOT] };

export const GUIDE_TOPICS: readonly GuideTopic[] = Object.freeze([
  {
    id: "first",
    icon: "hello",
    title: "처음 왔어요",
    summary: "케이슨 마을에 오신 걸 환영해요. 처음엔 이것만 알면 돼요.",
    steps: [
      { icon: "walk", text: "PC는 W A S D(또는 방향키)로, 폰은 화면 왼쪽 아래를 누른 채 밀어서 걸어요." },
      { icon: "tap", text: "가고 싶은 땅을 누르면 그곳까지 걸어가요." },
      { icon: "map", text: "오른쪽 위 지도 버튼(PC는 M 키)을 누르면 마을이 한눈에 보여요. 장소 이름을 누르고 '여기로 가기'를 고르면 데려다줘요." },
      { icon: "door", text: "건물 문 앞에 서면 버튼이 떠요. PC는 E 키, 폰은 그 버튼을 눌러 들어가요." },
      { icon: "chat", text: "PC는 Enter, 폰은 화면 아래 말풍선 버튼을 누르면 이웃과 이야기할 수 있어요." },
    ],
    qas: [
      { id: "plaza_guide_1", question: "여기는 어떤 곳이에요?", answer: "여기는 케이슨 마을이에요. 건물이 하나씩 천천히 늘어나는 조용한 시골 마을이에요." },
      { id: "first_lost", question: "길을 잃었어요.", answer: "지도를 열고 가고 싶은 곳의 이름을 누른 뒤 '여기로 가기'를 눌러요. 그곳까지 길을 따라 걸어가요." },
      { id: "first_coach", question: "조작 안내를 다시 보고 싶어요.", answer: "오른쪽 위 메뉴를 열고 '조작 안내 다시 보기'를 누르면 처음 안내가 다시 나와요." },
    ],
    map: { kind: "place", id: "plaza" },
  },
  {
    id: "tour",
    icon: "compass",
    title: "마을 둘러보기",
    summary: "분수 광장을 가운데 두고 둘레에 여러 곳이 모여 있어요.",
    steps: [
      { icon: "fountain", text: "마을 한가운데에 분수 광장이 있어요. 분수 둘레의 벤치에 앉아 쉴 수 있어요." },
      { icon: "candle", text: "광장 북쪽 길 끝에 추모관이 있어요." },
      { icon: "building", text: "학교는 동쪽, 성당은 북동쪽, 도서관은 서쪽, 절은 북서쪽, 교회는 남쪽에 있어요. 문 앞에서 들어가 둘러볼 수 있어요." },
      { icon: "house", text: "둘레 길가에 1번부터 10번까지 집이 있어요." },
      { icon: "bus", text: "광장 동쪽에 버스정류장과 카페가 있고, 그 길을 따라가면 케이슨 낚시터가 나와요." },
      { icon: "gate", text: "남쪽 다리를 건너면 케이슨랜드 정문이 있어요." },
    ],
    qas: [
      {
        id: "plaza_guide_lots",
        question: "새로 생긴 건물들은 뭐예요?",
        answer: "학교, 도서관, 성당, 교회, 절이 새로 생겼어요. 문 앞에 가면 안으로 들어가 둘러보고 의자나 방석에 앉아 볼 수 있어요.",
      },
      { id: "tour_map", question: "어디가 어딘지 한눈에 보고 싶어요.", answer: "오른쪽 위 지도 버튼(PC는 M 키)을 눌러요. 장소마다 이름이 붙어 있어요." },
    ],
    map: { kind: "place", id: "plaza" },
    go: FOUNTAIN,
  },
  {
    id: "memorial",
    icon: "candle",
    title: "추모관",
    summary: "먼저 떠난 반려동물을 기억하고 촛불을 밝히는 조용한 곳이에요.",
    steps: [
      { icon: "door", text: "광장 북쪽 길을 따라가면 추모관 문이 나와요. 문 앞에서 '추모관 들어가기'를 눌러요." },
      { icon: "search", text: "칸 앞에 서서 '가까이 보기'(PC는 E 키)를 누르거나, 칸을 바로 눌러요." },
      { icon: "updown", text: "'위 칸', '아래 칸'으로 옆 칸을 보고, + / − 로 더 가까이 볼 수 있어요." },
      { icon: "candle", text: "'촛불 켜기'를 누르면 한 시간 동안 촛불이 켜지고, 추모관에 있는 모두가 함께 봐요." },
      { icon: "heart", text: "빈 칸에서 '우리 아이 모시기'를 누르면 이름과 사진을 넣어 우리 아이를 모실 수 있어요." },
      { icon: "quiet", text: "추모관 안에서는 점프와 감정 표현을 쓰지 않아요. 조용히 머물러 주세요." },
    ],
    qas: [
      { id: "plaza_guide_2", question: "추모관은 어디에 있어요?", answer: "추모관은 광장 북쪽에 있어요. 분수를 지나 쭉 걸어가시면 추모관 문이 보여요." },
      { id: "memorial_free", question: "모시는 데 돈이 드나요?", answer: "지금은 무료로, 한 가족에 한 칸까지 모실 수 있어요." },
      { id: "memorial_photo", question: "올린 사진은 바로 보여요?", answer: "사진은 확인한 뒤에 다른 분들께 보여요. 보통 하루 안에 끝나요." },
      {
        id: "memorial_devices",
        question: "다른 기기에서도 우리 아이 칸을 볼 수 있어요?",
        answer: "우리 가족 칸의 '가족 기기'에서 가족 링크를 만들 수 있어요. 모실 때 받은 복구 코드로도 연결할 수 있어요.",
      },
    ],
    map: { kind: "place", id: "memorial" },
    go: { kind: "place", id: "memorial" },
  },
  {
    id: "house",
    icon: "house",
    title: "집",
    summary: "마을 길가의 집 열 채에 번호키로 들어가 쉴 수 있어요.",
    steps: [
      { icon: "keypad", text: "집 문 앞에서 '번호키 입력'을 눌러요." },
      { icon: "door", text: "1004를 누르고 '확인'을 누르면 문이 열려요. 들어갈 때마다 입력해요." },
      { icon: "stairs", text: "집은 2층이에요. 계단 앞에서 '2층으로 올라가기', '1층으로 내려가기'를 눌러요." },
      { icon: "sofa", text: "소파와 의자에 앉을 수 있고, 침대는 가장자리에 걸터앉아요." },
      { icon: "exit", text: "1층 현관에서 '밖으로 나가기'를 누르면 마을로 나가요." },
    ],
    qas: [
      { id: "plaza_guide_6", question: "집에는 어떻게 들어가요?", answer: "집 문 옆 번호키에 1004를 누르면 들어갈 수 있어요. 한 집에 여덟 분까지 함께 계실 수 있어요." },
      { id: "house_full", question: "집이 가득 찼대요.", answer: "한 집에는 여덟 분까지 계실 수 있어요. 다른 집에 가 보세요." },
      { id: "house_lock", question: "번호를 여러 번 틀렸어요.", answer: "30초 안에 다섯 번 틀리면 30초 동안 잠겨요. 잠시 뒤 다시 눌러 주세요." },
      { id: "house_floors", question: "다른 층에 있는 사람 말도 들려요?", answer: "네, 집 안의 이야기는 1층과 2층에 모두 들려요. 모습은 같은 층에 있는 분만 보여요." },
    ],
    map: { kind: "nearestHouse" },
    go: { kind: "nearestHouse" },
  },
  {
    id: "park",
    icon: "wheel",
    title: "케이슨랜드 놀이기구",
    summary: "남쪽 다리 건너 정문으로 들어가면 놀이기구 다섯 가지를 탈 수 있어요.",
    steps: [
      { icon: "gate", text: "정문 앞에서 '케이슨랜드 들어가기'를 눌러요." },
      { icon: "wheel", text: "별똥별 급행, 하늘 등불 바퀴, 달빛 회전목마, 구름 낙하탑, 달배가 있어요." },
      { icon: "ride", text: "안내판의 '타기'(PC는 E 키)를 눌러야 타요. 멀리서 누르면 탑승 위치로 걸어가서 타고, 놀이기구를 누르면 탑승 위치까지만 걸어가요." },
      { icon: "clock", text: "출발을 기다리는 중이면 '자리 맡기'를 눌러요. 탈 수 있게 되면 자동으로 타요." },
      { icon: "look", text: "타는 동안 화면을 끌면 둘러볼 수 있어요." },
      { icon: "exit", text: "'내리기'로 내려요. 나갈 때는 정문 아치 아래에서 '케이슨랜드 나가기'를 눌러요." },
    ],
    qas: [
      {
        id: "park_seats",
        question: "한 번에 몇 명 탈 수 있어요?",
        answer: "별똥별 급행은 12명, 구름 낙하탑은 16명, 달빛 회전목마는 24명, 하늘 등불 바퀴와 달배는 32명이 함께 탈 수 있어요.",
      },
      { id: "park_wheel", question: "하늘 등불 바퀴는 언제 내려요?", answer: "한 바퀴 도는 데 2분 30초 걸려요. 곤돌라가 승강장에 오면 내릴 수 있어요." },
      { id: "park_tower", question: "구름 낙하탑은 얼마나 높아요?", answer: "85m 높이까지 올라갔다가 떨어져요. 높이 떠 있을 땐 내릴 수 없어요." },
      { id: "park_busy", question: "탈 수 없다고 나와요.", answer: "앉아 있거나 버스·낚시 중에는 탈 수 없어요. 일어난 뒤 다시 눌러 주세요." },
    ],
    map: { kind: "place", id: "lot_gate" },
    go: { kind: "place", id: "lot_gate" },
  },
  {
    id: "fishing",
    icon: "rod",
    title: "낚시",
    summary: "동쪽의 케이슨 낚시터에서 낚싯대를 무료로 빌려 낚시해요.",
    steps: [
      { icon: "rod", text: "관리소 앞에서 '낚싯대 빌리기'를 눌러요. 무료예요." },
      { icon: "chair", text: "잔교나 좌대의 빈 의자에서 '앉아서 낚시'를 눌러요." },
      { icon: "float", text: "큰 버튼의 '던지기'를 누르고 찌를 지켜봐요. 찌가 쑥 잠기거나 솟으면 그때 눌러요." },
      { icon: "fight", text: "큰 물고기가 걸리면 '당기세요'일 땐 꾹 누르고, '놓아주세요'일 땐 손을 떼요." },
      { icon: "book", text: "잡은 물고기는 '도감'에 올라가요." },
      { icon: "exit", text: "다 놀았으면 일어나서 관리소 앞에서 '반납하기'를 눌러요." },
    ],
    qas: [
      { id: "plaza_guide_5", question: "낚시터는 어디에 있어요?", answer: "낚시터는 동쪽 길을 따라가면 있어요. 버스정류장을 지나 오솔길 끝에 관리소가 있어요." },
      { id: "fishing_pc", question: "PC에서는 어떻게 해요?", answer: "앉아 있을 때 E 키나 스페이스바가 큰 버튼이에요. 당길 때는 키를 누르고 있어요." },
      { id: "fishing_fish", question: "어떤 물고기가 있어요?", answer: "붕어, 잉어, 메기, 가물치 같은 물고기 열한 가지가 살아요. 장어는 밤에만 물어요." },
      { id: "fishing_release", question: "잡은 물고기는 어떻게 돼요?", answer: "대부분은 물에 놓아줘요. 배스와 블루길은 생태계 교란 생물이라 수거함에 넣어요." },
    ],
    map: { kind: "place", id: "lake" },
    go: { kind: "place", id: "lake" },
  },
  {
    id: "stars",
    icon: "star",
    title: "별 찾기",
    summary: "밤이 되면 지금 한국 하늘에 뜬 별자리를 찾아볼 수 있어요.",
    steps: [
      { icon: "moon", text: "해가 진 뒤 밖에서 화면 왼쪽의 망원경 버튼 '별자리 찾기'를 눌러요." },
      { icon: "star", text: "지금 하늘에 보이는 별자리 중 하나를 골라요." },
      { icon: "aim", text: "화살표를 따라 하늘을 둘러보고, 별자리를 가운데 동그라미에 1초 동안 맞추면 찾은 거예요." },
      { icon: "zoom", text: "+ / − 로 하늘을 당겨 볼 수 있어요." },
      { icon: "book", text: "찾은 별자리는 '별자리 도감'에 모여요." },
    ],
    qas: [
      { id: "plaza_guide_4", question: "여기도 밤이 오나요?", answer: "네, 이 마을은 한국의 실제 시간을 따라가요. 저녁이 되면 마을에도 해가 지고 밤이 찾아와요." },
      { id: "stars_day", question: "낮에 누르면 어떻게 돼요?", answer: "별은 밤에 보여요. 몇 시부터 밝은 별이 뜨는지 알려 드려요." },
      { id: "stars_planets", question: "행성도 보여요?", answer: "금성, 화성, 목성, 토성도 하늘에 떠요. 가운데에 맞추면 이름이 나와요." },
    ],
  },
  {
    id: "bus",
    icon: "bus",
    title: "버스",
    summary: "광장 동쪽 정류장에서 버스를 타고 마을을 한 바퀴 돌아요.",
    steps: [
      { icon: "bus", text: "광장 동쪽의 버스정류장으로 가요." },
      { icon: "clock", text: "버스는 10분마다 출발하고, 출발 3분 전부터 탈 수 있어요." },
      { icon: "door", text: "버스 앞에서 '버스 타기'(PC는 E 키)를 눌러요." },
      { icon: "seat", text: "버스 안에서 걸어 다니거나 빈자리에 앉을 수 있어요. 창문 쪽으로 보기도 골라 봐요." },
      { icon: "exit", text: "정류장에 돌아오면 '하차'를 눌러 내려요." },
    ],
    qas: [
      { id: "bus_lap", question: "한 바퀴는 얼마나 걸려요?", answer: "마을 둘레 길을 한 바퀴 도는 데 50초쯤 걸리고, 건널목 신호에서는 잠시 멈춰요." },
      { id: "bus_alight", question: "중간에 내릴 수 있어요?", answer: "아니요, 정류장에 돌아오면 내릴 수 있어요." },
      { id: "bus_full", question: "버스가 가득 찼대요.", answer: "다음 버스를 기다려 주세요. 10분마다 와요." },
    ],
    map: { kind: "place", id: "busstop" },
    go: { kind: "place", id: "busstop" },
  },
  {
    id: "controls",
    icon: "keyboard",
    title: "조작법",
    summary: "PC와 폰에서 움직이고 둘러보는 방법이에요.",
    steps: [
      { icon: "keyboard", text: "PC: W A S D나 방향키로 걷고, Shift를 누르면 달려요. 스페이스바는 점프예요." },
      { icon: "mouse", text: "PC: 마우스를 끌면 둘러보고, 휠로 확대해요. Z·C 키로도 돌아볼 수 있어요." },
      { icon: "stick", text: "폰: 화면 왼쪽 아래를 누른 채 밀면 걷고, 끝까지 밀면 달려요." },
      { icon: "hand", text: "폰: 화면 오른쪽을 끌어 둘러보고, 두 손가락으로 벌리면 확대돼요." },
      { icon: "tap", text: "땅을 누르면 그곳까지 걸어가요." },
      { icon: "eye", text: "V 키나 오른쪽 위 눈 버튼으로 1인칭과 3인칭을 바꿔요." },
      { icon: "door", text: "문 열기, 앉기는 PC는 E 키, 폰은 화면에 뜨는 버튼으로 해요." },
      { icon: "menu", text: "오른쪽 위 메뉴(PC는 Esc)에서 소리, 이름표, 그래픽, 밝기를 바꿀 수 있어요." },
    ],
    qas: [
      { id: "controls_map", question: "지도는 어떻게 열어요?", answer: "오른쪽 위 지도 버튼이나 M 키를 눌러요. 건물 안에서는 지도를 볼 수 없어요." },
      { id: "controls_back", question: "카메라를 내 뒤로 돌리고 싶어요.", answer: "PC는 R 키를 눌러요. 폰은 화면 오른쪽을 두 번 톡톡 눌러요." },
      { id: "controls_buttons", question: "폰에서 버튼이 작아요.", answer: "메뉴의 '버튼 크기'에서 크게로 바꿀 수 있어요. 왼손잡이 모드도 있어요." },
    ],
  },
] satisfies GuideTopic[]);

export function guideTopic(id: string): GuideTopic | undefined {
  return GUIDE_TOPICS.find((t) => t.id === id);
}

/** The house places (1번 집 … 10번 집). */
const HOUSE_PLACES: readonly MapPlace[] = MAP_PLACES.filter((m) => m.id.startsWith("house_"));

/** The house whose door is nearest (x, z). */
export function nearestHousePlace(x: number, z: number): MapPlace {
  let best = HOUSE_PLACES[0]!;
  let bestD = Infinity;
  for (const h of HOUSE_PLACES) {
    const end = h.route[h.route.length - 1]!;
    const d = Math.hypot(end.x - x, end.z - z);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** The place a reference means, seen from where the player stands (x, z) — as a map place (the walk and the map read it). */
export function resolveGuidePlace(ref: GuidePlaceRef, x: number, z: number): MapPlace | null {
  switch (ref.kind) {
    case "place":
      return mapPlace(ref.id) ?? null;
    case "nearestHouse":
      return nearestHousePlace(x, z);
    case "spot":
      return { id: ref.id, icon: "", name: ref.name, label: ref.label, route: ref.route };
  }
}
