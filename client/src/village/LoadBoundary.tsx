import { Component, type ReactNode } from "react";
import { useChatStore } from "../stores/chatStore";
import { LOAD_RETRY_LIMIT, retryDelayMs } from "./loadRetry";

/**
 * A failed model download inside the village no longer replaces the whole app with the crash screen (final review m2).
 * Around one area's model: when its read throws (a flaky phone connection dropped `village.glb` or `memorial.glb`), the
 * boundary shows `fallback` (the hall's plain room, the village's plain ground), says so once in the chat, clears the
 * failed cache entry (`onReset`) and tries again after a short wait, a few times (loadRetry.ts). The walk geometry is
 * not part of the model, so the visitor can keep walking meanwhile.
 */
interface Props {
  /** What to draw while the model is missing. */
  fallback: ReactNode;
  /** Forget the failed entry in the loaders' caches, so the next try downloads again. */
  onReset: () => void;
  /** The chat line shown once on the first failure. */
  notice: string;
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
    if (this.state.tries >= LOAD_RETRY_LIMIT) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.setState((s) => ({ failed: false, tries: s.tries + 1 }));
    }, retryDelayMs(this.state.tries));
  }

  componentWillUnmount(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
