import { useEffect, useRef, useState } from "react";
import { quantizeDpad, DPAD_SECTOR_INTENTS } from "../game/dpad";
import type { DpadSector } from "../game/dpad";
import type { Intent } from "../game/input";
import "./dpad.css";

interface TouchDpadProps {
  /**
   * Shared movement intent — the SAME object TouchJoystick writes and LocalPlayer
   * adds to the keyboard intent. Written on every quantized sector change; zeroed
   * on release AND on unmount (a FP→TP mount switch must never strand movement).
   */
  moveInput: Intent;
}

/**
 * First-person D-pad (touch devices, design 21). LOOKS like four ▲▼◀▶ buttons but
 * ACTS as one sliding touch zone: the finger can press-and-slide without lifting,
 * and each pointer sample is snapped by the pure `quantizeDpad` (8×45° sectors,
 * ±10° boundary hysteresis, radial dead zone) into the keyboard's {-1,0,1}
 * intent — so the proven desktop FP behaviour (▲ = zero-rotation forward, ◀ =
 * curved turn) is reused verbatim. The zone owns its pointers (touch-action:none,
 * child buttons pointer-events:none), so a pad touch never reaches the canvas as
 * a camera drag — same isolation contract as TouchJoystick. Move/up listeners sit
 * on window (the nipplejs pattern): a touch that slides past the pad rim keeps
 * steering, and its release is never missed.
 */
export function TouchDpad({ moveInput }: TouchDpadProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  // Highlight state — changes only on DISCRETE sector transitions (a few per
  // second at most, and React bails out on same-value sets), so state is safe
  // here; the per-sample tracking stays in the effect's locals.
  const [sector, setSector] = useState<DpadSector | null>(null);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;

    // The one active pad pointer (single-touch pad: extra fingers are ignored)
    // and the held sector the hysteresis is sticky against.
    let activeId: number | null = null;
    let held: DpadSector | null = null;

    const apply = (next: DpadSector | null, intent: Intent) => {
      held = next;
      setSector(next);
      moveInput.forward = intent.forward;
      moveInput.right = intent.right;
    };

    const sample = (e: PointerEvent) => {
      const rect = zone.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) / 2;
      // Normalize the offset to the pad radius. DOM clientY grows DOWN while the
      // quantizer's y is UP-positive (the nipplejs convention) — flip it here.
      const x = (e.clientX - (rect.left + rect.width / 2)) / radius;
      const y = (rect.top + rect.height / 2 - e.clientY) / radius;
      const { sector: next, intent } = quantizeDpad(x, y, held);
      apply(next, intent);
    };

    const onDown = (e: PointerEvent) => {
      if (activeId !== null) return;
      activeId = e.pointerId;
      sample(e);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === activeId) sample(e);
    };
    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      apply(null, { forward: 0, right: 0 });
    };

    zone.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);

    return () => {
      zone.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      // Never strand a stale intent after unmount (FP→TP switch mid-hold) — the
      // avatar would keep walking. Mirrors TouchJoystick's cleanup contract.
      moveInput.forward = 0;
      moveInput.right = 0;
    };
  }, [moveInput]);

  // Diagonal sectors light BOTH adjacent buttons — derived from the intent signs.
  const active = sector === null ? { forward: 0, right: 0 } : DPAD_SECTOR_INTENTS[sector];
  const cls = (name: string, on: boolean) => `cv-dpad-btn ${name}${on ? " is-active" : ""}`;

  return (
    <div ref={zoneRef} className="cv-dpad-zone" role="group" aria-label="이동 패드">
      <span className={cls("cv-dpad-up", active.forward > 0)} aria-hidden="true">
        ▲
      </span>
      <span className={cls("cv-dpad-left", active.right < 0)} aria-hidden="true">
        ◀
      </span>
      <span className={cls("cv-dpad-right", active.right > 0)} aria-hidden="true">
        ▶
      </span>
      <span className={cls("cv-dpad-down", active.forward < 0)} aria-hidden="true">
        ▼
      </span>
    </div>
  );
}
