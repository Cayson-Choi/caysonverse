// 입장 화면(캐릭터 조립실)이 배치를 잡는 화면 크기: 휴대폰 키보드가 열려도 배치가 바뀌지 않게 한다.
//
// Android WebView(카카오톡 인앱 브라우저 등)는 키보드가 열리면 레이아웃 뷰포트(innerHeight) 자체를 줄인다
// (resizes-content). 412×744가 412×404가 되면 가로 > 세로라 stageLayout이 옆 시트(side) 배치로 넘어가
// 이름판이 몇 px로 줄어들고 이름을 넣을 수 없었다. Android Chrome은 키보드가 화면만 덮고(resizes-visual)
// innerHeight가 그대로라 같은 일이 없다. 그래서 터치 기기에서 글자 입력 칸에 포커스가 있는 동안(또는 막 빠진
// 직후) 폭은 같고 높이만 줄어든 것은 키보드로 보고, 배치는 키보드가 열리기 전 높이로 유지한다(holdViewport).
// 키보드가 덮은 아래쪽은 그대로 두고(Chrome과 같다), 포커스된 칸이 덮였을 때만 입장 화면 전체를 그만큼
// 올린다(keyboardLift). UA는 보지 않는다.

import { useEffect, useState, type RefObject } from "react";
import { isTouchDevice } from "../device";

export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

/** 키보드가 닫히는 동안(입력 칸에서 포커스가 빠진 직후) 들어오는 중간 크기도 키보드로 본다(ms). */
export const KEYBOARD_SETTLE_MS = 1000;
/** 키보드 위로 올린 입력 칸 아래에 남길 틈(px). */
export const KEYBOARD_LIFT_GAP = 12;

/**
 * 배치에 쓸 화면 크기. 폭이 바뀌면(회전, 창 크기) 새 크기, 높이가 늘면 새 크기를 그대로 쓴다. 폭은 같고 높이만
 * 줄었을 때 키보드 때문으로 보이면(keyboardLikely) 앞의 크기를 유지하고, 아니면(브라우저 막대, 화면 분할) 새 크기를 쓴다.
 */
export function holdViewport(held: ViewSize, next: ViewSize, keyboardLikely: boolean): ViewSize {
  if (next.width !== held.width || next.height >= held.height) return next;
  return keyboardLikely ? held : next;
}

/**
 * 입력 칸(올리기 전 화면 좌표의 top·bottom)이 보이는 높이 visibleHeight 안에 들도록 화면을 올릴 거리(px, 0 이상).
 * 칸 아래에 gap을 남기되, 칸 위쪽이 화면 위로 나가지 않을 만큼까지만 올린다.
 */
export function keyboardLift(target: { top: number; bottom: number }, visibleHeight: number, gap = KEYBOARD_LIFT_GAP): number {
  const need = target.bottom + gap - visibleHeight;
  if (need <= 0) return 0;
  return Math.ceil(Math.max(0, Math.min(need, target.top - gap)));
}

/** 휴대폰 키보드를 띄우는 요소인가(글자 입력 칸, 여러 줄 입력, 편집 가능한 요소). */
const NON_TEXT_INPUTS = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);
export function isTextEntry(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((el.type ?? "text").toLowerCase());
  return el.isContentEditable === true;
}

function readSize(): ViewSize {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * 입장 화면이 배치를 잡을 화면 크기(holdViewport). 키보드가 화면 자체를 줄인 동안(innerHeight < 유지한 높이)
 * 포커스된 입력 칸이 rootRef 안에 있고 키보드에 덮이면, rootRef 요소에 --cv-lift(px)를 적어 그만큼 올린다(entry.css).
 */
export function useEntryViewport(rootRef: RefObject<HTMLElement | null>): ViewSize {
  const [size, setSize] = useState(readSize);

  useEffect(() => {
    let held = readSize();
    let lift = 0;
    let lastTextBlur = Number.NEGATIVE_INFINITY;
    let settleTimer = 0;

    const keyboardLikely = () =>
      isTouchDevice &&
      (isTextEntry(document.activeElement as HTMLElement | null) || performance.now() - lastTextBlur < KEYBOARD_SETTLE_MS);

    const applyLift = () => {
      const root = rootRef.current;
      if (!root) return;
      const el = document.activeElement as HTMLElement | null;
      let next = 0;
      if (window.innerHeight < held.height && el && isTextEntry(el) && root.contains(el)) {
        const r = el.getBoundingClientRect();
        next = keyboardLift({ top: r.top + lift, bottom: r.bottom + lift }, window.innerHeight);
      }
      if (next !== lift) {
        lift = next;
        root.style.setProperty("--cv-lift", `${lift}px`);
      }
    };

    const sync = () => {
      const next = holdViewport(held, readSize(), keyboardLikely());
      if (next.width !== held.width || next.height !== held.height) {
        held = next;
        setSize(next);
      }
      applyLift();
    };
    // 처음 그린 뒤 바뀐 크기가 있으면 맞춘다.
    sync();

    const onFocusIn = () => applyLift();
    const onFocusOut = (e: FocusEvent) => {
      if (!isTextEntry(e.target as HTMLElement | null)) return;
      lastTextBlur = performance.now();
      // 다른 입력 칸으로 옮겨 갔는지는 focusin 뒤에 안다.
      setTimeout(applyLift, 0);
      // 키보드가 다 닫힌 뒤 한 번 더: 그사이 놓친 크기 변화가 있으면 실제 크기로 돌아간다.
      clearTimeout(settleTimer);
      settleTimer = window.setTimeout(sync, KEYBOARD_SETTLE_MS + 50);
    };

    window.addEventListener("resize", sync);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("resize", sync);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      clearTimeout(settleTimer);
    };
  }, [rootRef]);

  return size;
}
