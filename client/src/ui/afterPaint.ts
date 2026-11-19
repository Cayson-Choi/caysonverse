/**
 * Run `fn` after the browser has painted the frame that answers the current input event (INP: "paint first, then the heavy work").
 * A press handler that mounts a big panel in its own task (the menu card: ~100 ms on a 4x slower phone CPU) keeps the press itself
 * from painting; this hands the mounting to the task after that paint (rAF, then a 0 ms timeout, which runs after the frame's
 * paint). A 120 ms timer is the fallback for a hidden tab (no rAF). `fn` runs once.
 */
export function afterPaint(fn: () => void): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(run, 0));
  setTimeout(run, 120);
}
