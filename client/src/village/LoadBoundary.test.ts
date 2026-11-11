import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoadBoundary } from "./LoadBoundary";
import { LOAD_RETRY_LIMIT, retryDelayMs } from "./loadRetry";

/**
 * LoadBoundary's retry through React's lifecycle, driven by hand in the order React calls it (no DOM here): a failed
 * read, then the Suspense above hiding and showing the tree again (React 18 unmounts and remounts the class component),
 * which used to drop the pending retry for good (bus review: a failed `village_bus.glb` was never fetched again).
 */

type State = { failed: boolean; tries: number };

function boundary() {
  const onReset = vi.fn();
  const b = new LoadBoundary({ fallback: "fallback", onReset, notice: "다시 불러올게요", children: "children" });
  // React's updater is not attached: apply setState in place.
  b.setState = ((u: Partial<State> | ((s: State) => Partial<State>)) => {
    b.state = { ...b.state, ...(typeof u === "function" ? u(b.state) : u) };
  }) as typeof b.setState;
  const fail = () => {
    b.state = { ...b.state, ...LoadBoundary.getDerivedStateFromError() };
    b.componentDidCatch();
  };
  return { b, onReset, fail };
}

describe("LoadBoundary retry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tries again after the wait, with the cache entry cleared", () => {
    const { b, onReset, fail } = boundary();
    b.componentDidMount();
    fail();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(b.render()).toBe("fallback");
    vi.advanceTimersByTime(retryDelayMs(0));
    expect(b.state).toEqual({ failed: false, tries: 1 });
    expect(b.render()).toBe("children");
  });

  it("keeps the retry when a Suspense above hides and shows the tree (unmount, then mount again)", () => {
    const { b, fail } = boundary();
    b.componentDidMount();
    fail();
    vi.advanceTimersByTime(300);
    b.componentWillUnmount(); // the village's Suspense hides its revealed tree
    b.componentDidMount(); // ... and shows it again
    vi.advanceTimersByTime(retryDelayMs(0));
    expect(b.state).toEqual({ failed: false, tries: 1 });
  });

  it("stops for good when it is really unmounted", () => {
    const { b, fail } = boundary();
    b.componentDidMount();
    fail();
    b.componentWillUnmount();
    vi.advanceTimersByTime(retryDelayMs(LOAD_RETRY_LIMIT) * 2);
    expect(b.state).toEqual({ failed: true, tries: 0 });
  });

  it("a remount of a boundary that has not failed arms nothing", () => {
    const { b } = boundary();
    b.componentDidMount();
    b.componentWillUnmount();
    b.componentDidMount();
    vi.advanceTimersByTime(retryDelayMs(LOAD_RETRY_LIMIT) * 2);
    expect(b.state).toEqual({ failed: false, tries: 0 });
  });

  it("gives up after the retry limit, remounts included", () => {
    const { b, onReset, fail } = boundary();
    b.componentDidMount();
    for (let k = 0; k < LOAD_RETRY_LIMIT; k++) {
      fail();
      vi.advanceTimersByTime(retryDelayMs(k));
    }
    fail();
    b.componentWillUnmount();
    b.componentDidMount();
    vi.advanceTimersByTime(retryDelayMs(LOAD_RETRY_LIMIT) * 2);
    expect(b.state).toEqual({ failed: true, tries: LOAD_RETRY_LIMIT });
    expect(onReset).toHaveBeenCalledTimes(LOAD_RETRY_LIMIT + 1);
  });
});
