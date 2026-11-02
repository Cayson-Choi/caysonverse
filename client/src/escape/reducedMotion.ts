/**
 * Whether the player asked their system for less motion (AI 학교 탈출, Task 20). The escape show then skips
 * its sparkles, flash and slow door: the classroom jumps to the end of the timeline (door open, lights
 * full) and goes on with Ari's words.
 */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
