import { Component, type ReactNode } from "react";
import { useChatStore } from "../stores/chatStore";
import { LOAD_RETRY_LIMIT, retryDelayMs } from "./loadRetry";

/**
 * A failed model download inside the village no longer replaces the whole app with the crash screen (final review m2).
 * Around one area's model: when its read throws (a flaky phone connection dropped `village.glb` or `memorial.glb`), the
 * boundary shows `fallback` (the hall's plain room, the village's plain ground), says so once in the chat, clears the
 * failed cache entry (`onReset`) and tries again after a short wait, a few times (loadRetry.ts). The walk geometry is
 * not part of the model, so the visitor can keep walking meanwhile.
 *
 * A Suspense ABOVE the boundary that hides and shows its tree again (React 18 hides a revealed boundary that
 * re-suspends) unmounts and remounts this class component: `componentWillUnmount` stops a pending retry, so
 * `componentDidMount` arms it again (bus review: the village's Suspense did this 0.35 s after it first showed, and a
 * failed bus was never fetched again).
 *
 * A model the area must not wait for (the village bus) puts a Suspense of its own INSIDE the boundary: its first load
 * and every retry suspend there, never in the area's (bus review r3, M2).
 */
interface Props {
  /** What to draw while the model is missing. */
  fallback: ReactNode;
  /** Forget the failed entry in the loaders' caches, so the next try downloads again. */
  onReset: () => void;
  /** The chat line shown once on the first failure. */
  notice: string;
  /** Called on every failure (the village's cover lifts at once: the fallback and the notice must show). */
  onFail?: () => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
  tries: number;
}

export class LoadBoundary extends Component<Props, State> {
  state: State = { failed: false, tries: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(): void {
    try {
      this.props.onFail?.();
    } catch {
      // ignore
    }
    try {
      this.props.onReset();
    } catch {
      // ignore
    }
    if (this.state.tries === 0) {
      try {
        useChatStore.getState().pushSystem(this.props.notice);
      } catch {
        // ignore
      }
    }
    this.armRetry();
  }

  /** Remounted after a Suspense above hid this tree while a retry was pending (its timer was stopped): arm it again. */
  componentDidMount(): void {
    if (this.state.failed && this.timer === null) this.armRetry();
  }

  componentWillUnmount(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The next try after its wait (none past the limit). */
  private armRetry(): void {
    if (this.state.tries >= LOAD_RETRY_LIMIT) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setState((s) => ({ failed: false, tries: s.tries + 1 }));
    }, retryDelayMs(this.state.tries));
  }

  render(): ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}
