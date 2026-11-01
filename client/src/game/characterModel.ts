// character.glb 로딩 상태를 React 밖에서 읽고, 실패를 지우고 다시 받는다(캐릭터 3단계 최종 검토 Important 2).
//
// drei useGLTF는 R3F useLoader → suspend-react의 suspend 호출이고 React 훅을 쓰지 않는다. 그래서 React 밖에서
// 불러도 조립실·월드와 같은 캐시를 읽는다: 받았으면 값을 돌려주고, 받는 중이면 promise를 던지고, 실패했으면
// 캐시해 둔 오류를 던진다. 실패는 지우기 전까지 그대로 남으므로(다시 받지 않는다) 한 번 못 받으면 조립실 미리보기도,
// 입장 뒤 월드의 내 아바타도 같은 오류를 다시 던진다. 그래서:
// - 미리보기 경계(BuilderPreview)는 실패를 잡으면 retry()로 지우고 MODEL_RETRY_DELAYS_MS 간격으로 다시 받아 본다.
// - 입장(EntryScreen)은 실패한 줄 알면 reload()로 다시 받아 보고, 그래도 안 되면 입장하지 않는다.
// characterModel.test.ts가 실제 useGLTF로 이 규약(503 → 오류 캐시 → clear 뒤 새 요청)을 확인한다.

import { useGLTF } from "@react-three/drei";
import { CHARACTER_MODEL_URL } from "./useAvatar";

/** 받음 | 받는 중(또는 아직 시작 안 함 — 읽으면 시작된다) | 실패(지우기 전까지 그대로). */
export type ModelState = "ready" | "loading" | "failed";

/** suspend 규약의 캐시 하나(URL 하나). read는 값을 돌려주거나, 받는 중이면 promise를, 실패면 오류를 던진다. */
export interface SuspenseCache {
  read(): unknown;
  clear(): void;
  preload(): void;
}

export interface ModelGate {
  /** 지금 상태. 캐시에 없으면 받기를 시작하고 "loading"이다. */
  state(): ModelState;
  /** 받기가 끝날 때까지 기다린다: 받았으면 true, 실패했으면 false(reject하지 않는다). */
  settle(): Promise<boolean>;
  /** 실패가 캐시돼 있으면 지우고 다시 받기 시작한다. 받았거나 받는 중이면 그대로 둔다(받은 모델을 버리지 않는다). */
  retry(): void;
  /** retry() 뒤 settle(): 다시 받아 본 결과. */
  reload(): Promise<boolean>;
}

/**
 * 미리보기가 모델을 못 받았을 때 다시 받아 보는 간격(ms). 길이가 횟수다(3번). 다 실패하면 대체 문구를 둔다
 * (입장을 누르면 EntryScreen이 한 번 더 받아 본다).
 */
export const MODEL_RETRY_DELAYS_MS: readonly number[] = Object.freeze([1500, 3000, 6000]);

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

export function createModelGate(cache: SuspenseCache): ModelGate {
  function state(): ModelState {
    try {
      cache.read();
      return "ready";
    } catch (thrown) {
      return isThenable(thrown) ? "loading" : "failed";
    }
  }

  async function settle(): Promise<boolean> {
    for (;;) {
      try {
        cache.read();
        return true;
      } catch (thrown) {
        if (!isThenable(thrown)) return false;
        // suspend-react의 promise는 reject하지 않는다(오류를 캐시에 적고 끝난다). 그래도 reject하면 다시 읽어 판단한다.
        await Promise.resolve(thrown).then(
          () => undefined,
          () => undefined,
        );
      }
    }
  }

  function retry(): void {
    if (state() === "failed") cache.clear();
    cache.preload();
  }

  return {
    state,
    settle,
    retry,
    reload: () => {
      retry();
      return settle();
    },
  };
}

/** React 밖에서 부르는 useGLTF(이름만 다르다: 훅 규칙 대상이 아님을 드러낸다 — 안에 React 훅이 없다). */
const readGltf: (url: string) => unknown = useGLTF;

/** useGLTF의 캐시(URL 하나)를 suspend 규약으로 감싼다. */
export function gltfCache(url: string): SuspenseCache {
  return {
    read: () => readGltf(url),
    clear: () => useGLTF.clear(url),
    preload: () => useGLTF.preload(url),
  };
}

/** 이 오류가 url 모델을 못 받은 실패인가(R3F useLoader는 "Could not load <url>: …"로 감싼다). */
export function isModelLoadError(error: unknown, url: string): boolean {
  return String(error).includes(url);
}

/** character.glb의 로딩 상태(조립실 미리보기 경계와 입장 버튼이 쓴다). */
export const characterModel: ModelGate = createModelGate(gltfCache(CHARACTER_MODEL_URL));
