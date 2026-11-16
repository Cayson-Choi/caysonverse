import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { exitOverview, viewState } from "../game/viewState";
import { OV_VIS_BLEND } from "../game/viewMode";
import { useViewStore } from "../stores/viewStore";
import type { Pose, SeatState } from "../game/types";
import { MAP_PLACES } from "./villagePlaces";
import { cancelMapWalk, startMapWalk } from "./mapWalk";
import "./mapPlaces.css";

/**
 * A press on a map chip: on the pointer's release (a phone's map takes the touches for its pan and pinch, so no click may
 * follow a tap), or a click from the keyboard — never both for one press.
 */
let lastUp = 0;
function press(fn: () => void) {
  return {
    onPointerUp: (e: { stopPropagation(): void }) => {
      e.stopPropagation();
      lastUp = performance.now();
      fn();
    },
    onClick: () => {
      if (performance.now() - lastUp > 600) fn();
    },
  };
}

/**
 * The places on the top-down map (UX 2026-11-16): an icon and a name over each (추모관, 버스정류장, 카페, 케이슨 낚시터, 광장, the
 * houses "N번 집", the waterfall once it is a place). Tapping one opens a small card with "여기로 가기": the map closes and the
 * avatar walks there along the paths (mapWalk.ts). Mounted only while the map is open; drawn once the camera is up (like
 * "내 위치").
 */
export function MapPlaces({ pose, seat }: { pose: Pose; seat: SeatState }) {
  const isOv = useViewStore((s) => s.isOv);
  const [picked, setPicked] = useState<string | null>(null);
  const tags = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!isOv) setPicked(null);
  }, [isOv]);
  // a map walk ends with the scene (a reconnect, leaving the village)
  useEffect(() => () => cancelMapWalk(), []);
  const frame = useRef(0);
  useFrame(() => {
    const show = viewState.ovBlend > OV_VIS_BLEND;
    for (const t of tags.current) if (t) t.style.display = show ? "" : "none";
    // a crowded map (a phone sees the whole village from 200 m up): a name that would sit on one already drawn waits until
    // the map is zoomed in — the main places first (MAP_PLACES order), the picked one always
    if (!show || frame.current++ % 6 !== 0) return;
    const drawn: DOMRect[] = [];
    const order = tags.current.map((t, i) => ({ t, i })).sort((a, b) => Number(b.t?.classList.contains("is-picked")) - Number(a.t?.classList.contains("is-picked")) || a.i - b.i);
    const hits = (r: DOMRect) => drawn.some((d) => r.left < d.right + 4 && r.right > d.left - 4 && r.top < d.bottom + 2 && r.bottom > d.top - 2);
    for (const { t } of order) {
      const tag = t?.firstElementChild as HTMLElement | null;
      if (!t || !tag) continue;
      // the full name; where it would sit on another, the icon alone; where even that would, nothing (zoom in to see it)
      t.classList.remove("is-compact");
      let r = tag.getBoundingClientRect();
      if (hits(r) && !t.classList.contains("is-picked")) {
        t.classList.add("is-compact");
        r = tag.getBoundingClientRect();
      }
      const hit = hits(r) && !t.classList.contains("is-picked");
      t.style.visibility = hit ? "hidden" : "";
      if (!hit) drawn.push(r);
    }
  });
  if (!isOv) return null;
  return (
    <>
      {MAP_PLACES.map((m, i) => (
        <group key={m.id} position={[m.label.x, 1, m.label.z]}>
          <Html center zIndexRange={[picked === m.id ? 14 : 13, 0]} style={{ pointerEvents: "none" }}>
            <div
              ref={(el) => {
                tags.current[i] = el;
              }}
              className={"cv-map-place" + (m.id.startsWith("house_") ? " is-house" : "") + (picked === m.id ? " is-picked" : "")}
              data-map-place={m.id}
              style={{ display: "none" }}
            >
              <button
                type="button"
                className="cv-map-place-tag"
                aria-label={m.name}
                onPointerDown={(e) => e.stopPropagation()}
                {...press(() => setPicked((p) => (p === m.id ? null : m.id)))}
                aria-expanded={picked === m.id}
              >
                <span aria-hidden="true">{m.icon}</span>
                <span className="cv-map-place-name">{m.name}</span>
              </button>
              {picked === m.id && (
                <div className="cv-map-place-card" onPointerDown={(e) => e.stopPropagation()}>
                  <span className="cv-map-place-title">
                    {m.icon} {m.name}
                  </span>
                  <button
                    type="button"
                    className="cv-map-place-go"
                    data-map-go={m.id}
                    {...press(() => {
                      setPicked(null);
                      if (startMapWalk(m.id, pose, seat)) exitOverview();
                    })}
                  >
                    여기로 가기
                  </button>
                </div>
              )}
            </div>
          </Html>
        </group>
      ))}
    </>
  );
}
