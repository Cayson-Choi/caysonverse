/**
 * 입장 로딩 화면의 상태 (VillageLoader가 그린다). 입장하기를 누른 순간부터 마을이 처음 보일 때까지 세 단계를 센다:
 *
 *   마을   — village.glb를 받고(바이트), 나무·꽃을 심는다(식생 빌드 진행률). 다 심으면(vegDressing) 끝.
 *   캐릭터 — character.glb (입장 화면에서 미리 받아 두므로 보통 이미 끝나 있다).
 *   접속   — 서버 방에 들어왔다(enterVillage).
 *
 * 셋 다 끝나면 화면이 부드럽게 걷힌다. 실패(접속 오류)하면 바로 닫히고 입장 화면이 오류를 보여 준다.
 * React 밖의 작은 저장소: 로더(GLTFLoader의 진행 이벤트), 식생 빌드, 입장 흐름이 각자 알리고, 화면은 구독한다.
 * 진행률 계산(`loadPercent`)과 지금 하는 일(`loadActivity`)은 순수 함수라 테스트한다.
 */

export interface VillageLoadState {
  /** 로딩 화면이 떠 있다(걷히는 중 포함). */
  open: boolean;
  /** 셋 다 끝나 걷히는 중. */
  closing: boolean;
  joined: boolean;
  charReady: boolean;
  /** village.glb 바이트 (total 0 = 아직 모름). */
  loaded: number;
  total: number;
  /** village.glb를 다 받아 읽었다(바이트를 못 세도 참이 된다). */
  modelIn: boolean;
  /** 식생 빌드 진행률 0..1. */
  build: number;
  /** 마을이 다 차려졌다(vegDressing.dressed). */
  dressed: boolean;
  /** 열린 시각(performance.now). */
  startedAt: number;
}

const initial = (): VillageLoadState => ({
  open: false,
  closing: false,
  joined: false,
  charReady: false,
  loaded: 0,
  total: 0,
  modelIn: false,
  build: 0,
  dressed: false,
  startedAt: 0,
});

/** 각 단계의 몫(합 1). 받기가 가장 오래 걸리고, 그다음이 나무 심기. */
export const LOAD_WEIGHTS = { join: 0.08, char: 0.1, download: 0.47, build: 0.35 } as const;

const clamp01 = (v: number) => (v > 1 ? 1 : v > 0 ? v : 0);

/** 마을 파일을 받은 비율 0..1. */
export function downloadFraction(s: Pick<VillageLoadState, "loaded" | "total" | "modelIn" | "dressed">): number {
  if (s.modelIn || s.dressed) return 1;
  return s.total > 0 ? clamp01(s.loaded / s.total) * 0.98 : 0;
}

/** 전체 진행률 0..100 (정수). 다 끝나기 전에는 99를 넘지 않는다. */
export function loadPercent(s: VillageLoadState): number {
  const done = s.joined && s.charReady && s.dressed;
  if (done) return 100;
  const w = LOAD_WEIGHTS;
  const f =
    (s.joined ? w.join : 0) +
    (s.charReady ? w.char : 0) +
    w.download * downloadFraction(s) +
    w.build * (s.dressed ? 1 : clamp01(s.build));
  return Math.min(99, Math.floor(f * 100));
}

export type LoadStepId = "village" | "character" | "connect";

/** 화면에 보이는 단계 순서(마을 → 캐릭터 → 접속)와 각 단계가 끝났는지. */
export function loadSteps(s: VillageLoadState): Array<{ id: LoadStepId; label: string; done: boolean }> {
  return [
    { id: "village", label: "마을", done: s.dressed },
    { id: "character", label: "캐릭터", done: s.charReady },
    { id: "connect", label: "접속", done: s.joined },
  ];
}

const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);

/** 지금 하는 일 한 줄. */
export function loadActivity(s: VillageLoadState): string {
  if (!s.joined) return "마을에 접속하고 있어요…";
  if (downloadFraction(s) < 1) return s.total > 0 ? `마을 풍경을 받고 있어요… ${mb(s.loaded)} / ${mb(s.total)} MB` : "마을 풍경을 받고 있어요…";
  if (!s.charReady) return "캐릭터를 데려오고 있어요…";
  if (!s.dressed) return "나무와 꽃을 심고 있어요…";
  return "거의 다 왔어요!";
}

/** 지금 단계(가장 먼저 안 끝난 것) — data-step 용. */
export function currentStep(s: VillageLoadState): LoadStepId | "done" {
  if (!s.joined) return "connect";
  if (!s.dressed) return "village";
  if (!s.charReady) return "character";
  return "done";
}

/** 걷히는 데 걸리는 시간(ms). */
export const LOADER_FADE_MS = 500;

type Listener = () => void;

export function createVillageLoad(timers: { set(fn: () => void, ms: number): unknown; clear(h: unknown): void } = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}) {
  let state = initial();
  let fade: unknown = null;
  const listeners = new Set<Listener>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  const patch = (p: Partial<VillageLoadState>) => {
    if (!state.open) return;
    state = { ...state, ...p };
    if (!state.closing && state.joined && state.charReady && state.dressed) {
      state = { ...state, closing: true };
      fade = timers.set(() => {
        fade = null;
        state = initial();
        emit();
      }, LOADER_FADE_MS);
    }
    emit();
  };
  return {
    get: () => state,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** 입장하기를 눌렀다: 화면을 연다(이미 받은 것은 그대로 끝난 것으로). */
    begin(now: number, already: { charReady: boolean; modelIn: boolean; dressed: boolean }) {
      if (fade !== null) timers.clear(fade);
      fade = null;
      state = { ...initial(), open: true, startedAt: now, ...already };
      emit();
    },
    /** 접속 실패: 바로 닫는다. */
    fail() {
      if (fade !== null) timers.clear(fade);
      fade = null;
      state = initial();
      emit();
    },
    joined: () => patch({ joined: true }),
    charReady: () => patch({ charReady: true }),
    bytes(loaded: number, total: number) {
      if (!state.open || state.modelIn) return;
      // gzip으로 오면 받은 양이 Content-Length보다 커질 수 있다
      patch({ loaded, total: Math.max(total, loaded) });
    },
    modelIn: () => patch({ modelIn: true }),
    build(f: number) {
      if (!state.open) return;
      if (f > state.build) patch({ build: clamp01(f) });
    },
    dressed: () => patch({ dressed: true }),
  };
}

export type VillageLoad = ReturnType<typeof createVillageLoad>;

/** 앱의 하나뿐인 입장 로딩 상태. */
export const villageLoad: VillageLoad = createVillageLoad();
