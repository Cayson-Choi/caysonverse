import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { exitOverview, viewState } from "../game/viewState";
import { OV_VIS_BLEND } from "../game/viewMode";
import { useViewStore } from "../stores/viewStore";
import type { Pose, SeatState } from "../game/types";
import { MAP_PLACES } from "./villagePlaces";
import { cancelMapWalk, startMapWalk } from "./mapWalk";
import { mapPlaceKey, mapPlaceZRange } from "./mapPlaceStack";
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
const overlaps = (r: DOMRect, d: DOMRect) => r.left < d.right + 4 && r.right > d.left - 4 && r.top < d.bottom + 2 && r.bottom > d.top - 2;

/** Where "내 위치" (its resting rect `base`) may move so it touches none of `drawn`: the nearest of a few steps up and aside, inside the screen. */
export function meSpot(base: DOMRect, drawn: readonly DOMRect[], vw: number, vh: number): { dx: number; dy: number } | null {
  if (!drawn.some((d) => overlaps(base, d))) return { dx: 0, dy: 0 };
  const steps: ReadonlyArray<readonly [number, number]> = [[0, -34], [0, -68], [-84, 0], [84, 0], [-84, -34], [84, -34], [0, -102], [0, 40], [-84, -68], [84, -68], [0, -136]];
  for (const [dx, dy] of steps) {
    const r = { left: base.left + dx, right: base.right + dx, top: base.top + dy, bottom: base.bottom + dy } as DOMRect;
    if (r.left < 4 || r.right > vw - 4 || r.top < 4 || r.bottom > vh - 4) continue;
    if (!drawn.some((d) => overlaps(r, d))) return { dx, dy };
  }
  return null;
}

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
    // the guide's "지도에서 보기" (viewState.showOnMap): its place's card opens with the map
    if (viewState.ovPick && viewState.mode === "ov") {
      const pick = viewState.ovPick;
      viewState.ovPick = null;
      setPicked(pick);
    }
    const show = viewState.ovBlend > OV_VIS_BLEND;
    for (const t of tags.current) if (t) t.style.display = show ? "" : "none";
    // a crowded map (a phone sees the whole village from 200 m up): a name that would sit on one already drawn waits until
    // the map is zoomed in — the main places first (MAP_PLACES order), the picked one always
    if (!show || frame.current++ % 6 !== 0) return;
    const drawn: DOMRect[] = [];
    // "내 위치" (QA 2026-11-20: place chips sat over it on a phone) is placed AFTER the chips, so every place keeps its chip: it
    // steps up / aside to the first spot clear of them (meSpot), and only where there is none does a chip give way to it
    const me = document.querySelector<HTMLElement>(".cv-map-me:not(.cv-lake-map-label)");
    const meOn = !!me && me.style.display !== "none";
    if (me) {
      me.style.setProperty("--cv-me-dx", "0px");
      me.style.setProperty("--cv-me-dy", "0px");
    }
    const meBase = meOn ? me!.getBoundingClientRect() : null;
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
      // the picked place keeps its card's room too (the card stays readable over the chips around it)
      if (!hit) drawn.push(t.classList.contains("is-picked") ? t.getBoundingClientRect() : r);
    }
    if (me && meBase) {
      const spot = meSpot(meBase, drawn, window.innerWidth, window.innerHeight);
      if (spot) {
        me.style.setProperty("--cv-me-dx", spot.dx + "px");
        me.style.setProperty("--cv-me-dy", spot.dy + "px");
      } else {
        // no clear spot (a crowded map): "내 위치" stays on its marker and is the one on top; the chips it would cover give way
        for (const { t } of order) {
          const tag = t?.firstElementChild as HTMLElement | null;
          if (t && tag && t.style.visibility !== "hidden" && !t.classList.contains("is-picked") && overlaps(tag.getBoundingClientRect(), meBase)) t.style.visibility = "hidden";
        }
      }
    }
  });
  if (!isOv) return null;
  return (
    <>
      {MAP_PLACES.map((m, i) => (
        <group key={m.id} position={[m.label.x, 1, m.label.z]}>
          <Html key={mapPlaceKey(picked === m.id)} center zIndexRange={mapPlaceZRange(picked === m.id)} style={{ pointerEvents: "none" }}>
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
