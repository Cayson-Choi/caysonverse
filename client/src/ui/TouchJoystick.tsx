import { useEffect, useRef } from "react";
import nipplejs from "nipplejs";
import { joystickIntent } from "../game/joystick";
import type { Intent } from "../game/input";
import "./touch.css";

interface TouchJoystickProps {
  /**
   * Shared movement intent (the SAME object LocalPlayer reads and the keyboard's
   * intent is added to). Written on every joystick move; recentred on release.
   */
  moveInput: Intent;
}

/**
 * Bottom-left virtual joystick (touch devices only). nipplejs is integrated
 * DIRECTLY — created in a useEffect and destroyed on unmount, no React wrapper —
 * in STATIC mode anchored to the centre of a fixed, safe-area-aware zone. Each
 * `move` maps the stick's direction vector + force to the movement intent via the
 * pure `joystickIntent` (camera-relative, 0.15 dead-zone, direction only); `end`
 * recentres it. The zone element swallows its own pointers, so dragging the stick
 * never reaches the canvas and never rotates the camera.
 */
export function TouchJoystick({ moveInput }: TouchJoystickProps) {
  const zoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;

    const write = (intent: Intent) => {
      moveInput.forward = intent.forward;
      moveInput.right = intent.right;
    };

    const manager = nipplejs.create({
      zone,
      mode: "static",
      position: { left: "50%", top: "50%" },
      size: 108,
      color: "rgba(180, 162, 255, 0.55)",
      restOpacity: 0.55,
    });

    manager.on("move", (evt) => {
      const data = evt.data;
      write(joystickIntent(data.vector, data.force));
    });
    manager.on("end", () => write({ forward: 0, right: 0 }));

    return () => {
      manager.destroy();
      // Never strand a stale intent after unmount — the avatar would keep walking.
      write({ forward: 0, right: 0 });
    };
  }, [moveInput]);

  return <div ref={zoneRef} className="cv-joystick-zone" aria-hidden="true" />;
}
