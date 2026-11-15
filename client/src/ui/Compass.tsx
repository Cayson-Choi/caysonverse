import { useEffect, useRef, type CSSProperties } from "react";
import { CARDINALS, compassState, directionName, headingChanged, ringRotation } from "../game/compass";

/**
 * 동서남북 dial in the HUD, under the top-right buttons. The ring turns with the camera (the letter you are facing
 * stays at the top, under the pointer); the letters themselves stay upright. Small (a 64 px disc), never takes a press, and is redrawn by a frame loop writing two CSS variables — no React render
 * per frame. `style` pins it (the phone's layout puts it exactly under the top group).
 */
export function Compass({ style }: { style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let shown = Number.NaN;
    let name = "";
    const tick = () => {
      const el = ref.current;
      const h = compassState.heading;
      if (el && (Number.isNaN(shown) || headingChanged(shown, h))) {
        shown = h;
        el.style.setProperty("--cv-compass-ring", `${ringRotation(h)}deg`);
        el.style.setProperty("--cv-compass-letter", `${h}deg`);
        const n = directionName(h);
        if (n !== name) {
          name = n;
          el.setAttribute("aria-label", `나침반: ${n}쪽을 보고 있어요`);
          el.dataset.facing = n;
        }
        el.dataset.heading = String(Math.round(h));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className="cv-compass" role="img" aria-label="나침반" style={style}>
      <div className="cv-compass-ring" aria-hidden="true">
        {CARDINALS.map((c) => (
          <span key={c.key} className={"cv-compass-mark is-" + c.key.toLowerCase()}>
            <span className="cv-compass-letter">{c.label}</span>
          </span>
        ))}
      </div>
      <span className="cv-compass-pointer" aria-hidden="true" />
    </div>
  );
}
