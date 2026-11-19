import type { ReactNode } from "react";
import type { GuideIconId } from "./guideTopics";

/**
 * The guide pages' small line icons (24 x 24, round 1.8 px strokes in currentColor, a few soft fills): drawn here, no image
 * files, no emoji, so they take the dialog's colours and stay crisp at any size.
 */
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const F = { fill: "currentColor", stroke: "none" } as const;
const SOFT = { fill: "currentColor", fillOpacity: 0.18, stroke: "none" } as const;

const ICONS: Record<GuideIconId, ReactNode> = {
  hello: (
    <g {...S}>
      <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 6.5-6 6.5-2.6 0-4.2-1.3-5.6-3.6L4 14.4a1.4 1.4 0 0 1 2.3-1.6L8 15" />
      <path d="M19 3.5l1.5-1M20 7h1.8" />
    </g>
  ),
  walk: (
    <g {...S}>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="M10 21l2.2-6 2.8 2.5V21M12.2 15l.8-5.5-3 1.5-1.5 3M13 9.5l2.2 2.5 3 .5" />
    </g>
  ),
  tap: (
    <g {...S}>
      <path d="M10 13V5.5a1.5 1.5 0 0 1 3 0V12l4.2.9a2 2 0 0 1 1.6 2.3l-.8 4.3a2 2 0 0 1-2 1.5h-4.4a2 2 0 0 1-1.6-.8L6.6 16.5a1.4 1.4 0 0 1 2-2L10 16" />
      <path d="M6.5 6.5a5 5 0 0 1 10 0" opacity="0.55" />
    </g>
  ),
  map: (
    <g {...S}>
      <path d="M3 6.5l5.5-2.5 7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20z" />
      <path d="M8.5 4v13.5M15.5 6.5V20" />
      <path d="M3 6.5l5.5-2.5 7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20z" {...SOFT} />
    </g>
  ),
  door: (
    <g {...S}>
      <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h8A1.5 1.5 0 0 1 16 4.5V21M3 21h16" />
      <path d="M5 21V4.5A1.5 1.5 0 0 1 6.5 3h8A1.5 1.5 0 0 1 16 4.5V21z" {...SOFT} />
      <circle cx="13" cy="12.5" r="0.9" {...F} />
      <path d="M19 9l2 2-2 2" />
    </g>
  ),
  chat: (
    <g {...S}>
      <path d="M4 5.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
      <path d="M7.5 10h9M7.5 13h6" />
    </g>
  ),
  compass: (
    <g {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" {...SOFT} />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </g>
  ),
  fountain: (
    <g {...S}>
      <path d="M3 17h18M5 17c0 2 3 3.5 7 3.5s7-1.5 7-3.5" />
      <path d="M12 17V9M12 9c-1.5-3-4-3.5-6-2.5M12 9c1.5-3 4-3.5 6-2.5M12 9V4" />
      <path d="M6 10.5v1.5M18 10.5v1.5" />
    </g>
  ),
  candle: (
    <g {...S}>
      <path d="M12 3c1.6 1.8 2.2 3 2.2 4a2.2 2.2 0 0 1-4.4 0c0-1 .6-2.2 2.2-4z" {...F} />
      <rect x="9" y="10.5" width="6" height="10" rx="1" />
      <rect x="9" y="10.5" width="6" height="10" rx="1" {...SOFT} />
      <path d="M6 20.5h12" />
    </g>
  ),
  building: (
    <g {...S}>
      <path d="M4 20.5V10l8-5.5 8 5.5v10.5M2.5 20.5h19" />
      <path d="M4 20.5V10l8-5.5 8 5.5v10.5z" {...SOFT} />
      <path d="M10 20.5v-5h4v5M8 11h.01M16 11h.01" />
    </g>
  ),
  house: (
    <g {...S}>
      <path d="M3.5 11L12 4l8.5 7M6 9.5v11h12v-11" />
      <path d="M6 9.5v11h12v-11L12 4.6z" {...SOFT} />
      <path d="M10 20.5v-5.5h4v5.5" />
    </g>
  ),
  bus: (
    <g {...S}>
      <rect x="4" y="3.5" width="16" height="14" rx="2.5" />
      <rect x="4" y="3.5" width="16" height="14" rx="2.5" {...SOFT} />
      <path d="M4 10.5h16M7.5 17.5v2.5M16.5 17.5v2.5" />
      <circle cx="8" cy="14" r="1" {...F} />
      <circle cx="16" cy="14" r="1" {...F} />
    </g>
  ),
  lake: (
    <g {...S}>
      <path d="M3 14c2 0 2-1.5 4.5-1.5S9.5 14 12 14s2-1.5 4.5-1.5S18.5 14 21 14M3 18.5c2 0 2-1.5 4.5-1.5S9.5 18.5 12 18.5s2-1.5 4.5-1.5 2 1.5 4.5 1.5" />
      <path d="M8 9.5c1.5-2 4.5-2 6 0-1.5 2-4.5 2-6 0zM14 9.5l2.2-1.6v3.2z" />
    </g>
  ),
  gate: (
    <g {...S}>
      <path d="M4 21V9.5a8 8 0 0 1 16 0V21" />
      <path d="M8 21v-9.5a4 4 0 0 1 8 0V21M2.5 21h19" />
      <path d="M12 3v-1M7 4.5l-.6-.8M17 4.5l.6-.8" />
    </g>
  ),
  search: (
    <g {...S}>
      <circle cx="10.5" cy="10.5" r="6" />
      <circle cx="10.5" cy="10.5" r="6" {...SOFT} />
      <path d="M15 15l5.5 5.5" />
    </g>
  ),
  updown: (
    <g {...S}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M5 9h14M5 15h14" />
      <path d="M5 9h14v6H5z" {...SOFT} />
      <path d="M12 5l-1.5 1.5M12 5l1.5 1.5M12 19l-1.5-1.5M12 19l1.5-1.5" />
    </g>
  ),
  heart: (
    <g {...S}>
      <path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.4 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
      <path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.4 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" {...SOFT} />
    </g>
  ),
  quiet: (
    <g {...S}>
      <path d="M5 10h3l4.5-4v12L8 14H5z" />
      <path d="M5 10h3l4.5-4v12L8 14H5z" {...SOFT} />
      <path d="M16 9.5l4 5M20 9.5l-4 5" />
    </g>
  ),
  keypad: (
    <g {...S}>
      <rect x="5.5" y="2.5" width="13" height="19" rx="2" />
      <rect x="5.5" y="2.5" width="13" height="19" rx="2" {...SOFT} />
      {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={9 + c * 3} cy={7 + r * 3.5} r="0.95" {...F} />))}
      <path d="M10 18.5h4" />
    </g>
  ),
  stairs: (
    <g {...S}>
      <path d="M3 20.5h4.5V16H12v-4.5h4.5V7H21" />
      <path d="M3 20.5h4.5V16H12v-4.5h4.5V7H21v13.5z" {...SOFT} />
    </g>
  ),
  sofa: (
    <g {...S}>
      <path d="M5.5 11V8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3" />
      <path d="M3 13a2 2 0 0 1 4 0v1.5h10V13a2 2 0 0 1 4 0v4.5H3z" />
      <path d="M3 13a2 2 0 0 1 4 0v1.5h10V13a2 2 0 0 1 4 0v4.5H3z" {...SOFT} />
      <path d="M5 17.5V20M19 17.5V20" />
    </g>
  ),
  wheel: (
    <g {...S}>
      <circle cx="12" cy="10" r="7" />
      <path d="M12 3v14M5 10h14M7 5l10 10M17 5L7 15" opacity="0.6" />
      <circle cx="12" cy="10" r="1.3" {...F} />
      <path d="M8.5 21l3.5-11 3.5 11M6.5 21h11" />
    </g>
  ),
  ride: (
    <g {...S}>
      <path d="M2.5 17c3-9 6-11 8.5-11s3.5 4 5.5 4 3-2 5-4" />
      <rect x="9" y="13" width="7" height="4" rx="1.2" />
      <rect x="9" y="13" width="7" height="4" rx="1.2" {...SOFT} />
      <circle cx="10.5" cy="19" r="1" {...F} />
      <circle cx="14.5" cy="19" r="1" {...F} />
    </g>
  ),
  clock: (
    <g {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="8.5" {...SOFT} />
      <path d="M12 7v5l3.5 2" />
    </g>
  ),
  look: (
    <g {...S}>
      <path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" />
      <path d="M18 3v4h-4M6 21v-4h4" />
      <circle cx="12" cy="12" r="2" {...F} />
    </g>
  ),
  exit: (
    <g {...S}>
      <path d="M13 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H13" />
      <path d="M10 12h10M16.5 8.5L20 12l-3.5 3.5" />
    </g>
  ),
  rod: (
    <g {...S}>
      <path d="M4 20L18 4" />
      <path d="M18 4c1.5 4 1.5 8 0 11.5" opacity="0.7" />
      <path d="M18 15.5v2.5a1.5 1.5 0 0 1-3 0" />
      <circle cx="6.5" cy="17.5" r="1.6" />
    </g>
  ),
  chair: (
    <g {...S}>
      <path d="M7 3.5v10M7 13.5h10V20M7 13.5V20M7 8h9" />
      <path d="M3 21c2 0 2-1 4.5-1s2.5 1 4.5 1 2.5-1 4.5-1 2.5 1 4.5 1" opacity="0.6" />
    </g>
  ),
  float: (
    <g {...S}>
      <path d="M12 2.5v4" />
      <path d="M12 6.5c1.8 0 2.5 2 2.5 4s-1 3.5-2.5 3.5-2.5-1.5-2.5-3.5.7-4 2.5-4z" />
      <path d="M9.6 10h4.8" />
      <path d="M12 6.5c1.8 0 2.5 2 2.5 4H9.5c0-2 .7-4 2.5-4z" {...F} />
      <path d="M3 17c2 0 2-1.5 4.5-1.5S9.5 17 12 17s2-1.5 4.5-1.5S18.5 17 21 17" />
    </g>
  ),
  fight: (
    <g {...S}>
      <path d="M12 3v7M9 6l3-3 3 3" />
      <path d="M12 21v-7M9 18l3 3 3-3" opacity="0.6" />
      <circle cx="12" cy="12" r="2" {...F} />
    </g>
  ),
  book: (
    <g {...S}>
      <path d="M12 6.5C10 5 7 4.5 3.5 5v13.5C7 18 10 18.5 12 20c2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z" />
      <path d="M12 6.5C10 5 7 4.5 3.5 5v13.5C7 18 10 18.5 12 20z" {...SOFT} />
      <path d="M12 6.5V20" />
    </g>
  ),
  star: (
    <g {...S}>
      <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6L3.4 9.3l6-.7z" />
      <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6L3.4 9.3l6-.7z" {...SOFT} />
    </g>
  ),
  moon: (
    <g {...S}>
      <path d="M15.5 3.5A8.5 8.5 0 1 0 20.5 15 7 7 0 0 1 15.5 3.5z" />
      <path d="M15.5 3.5A8.5 8.5 0 1 0 20.5 15 7 7 0 0 1 15.5 3.5z" {...SOFT} />
      <path d="M19 5.5v2M18 6.5h2" />
    </g>
  ),
  aim: (
    <g {...S}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" />
      <path d="M12 9.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" {...F} />
    </g>
  ),
  zoom: (
    <g {...S}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3L20.5 20.5M8 10.5h5M10.5 8v5" />
    </g>
  ),
  keyboard: (
    <g {...S}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <rect x="2.5" y="6" width="19" height="12" rx="2" {...SOFT} />
      <path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.2h.01M18 12.2h.01M8 14.8h8" strokeWidth="2.2" />
      <path d="M10.5 12.2h3" strokeWidth="2.2" />
    </g>
  ),
  mouse: (
    <g {...S}>
      <rect x="6.5" y="3" width="11" height="18" rx="5.5" />
      <path d="M12 3v6.5M6.5 9.5h11" />
      <path d="M12 3a5.5 5.5 0 0 1 5.5 5.5v1H12z" {...SOFT} />
    </g>
  ),
  stick: (
    <g {...S}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="8.5" {...SOFT} />
      <circle cx="14.5" cy="9.5" r="3.2" {...F} />
      <path d="M12 4.5l-1 1M12 4.5l1 1M4.5 12l1-1M4.5 12l1 1" opacity="0.6" />
    </g>
  ),
  eye: (
    <g {...S}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" {...SOFT} />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  hand: (
    <g {...S}>
      <path d="M9 13V6a1.5 1.5 0 0 1 3 0v5.5M12 11V4.5a1.5 1.5 0 0 1 3 0v7M15 11.5V7a1.5 1.5 0 0 1 3 0v7c0 4-2.5 6.5-6 6.5-2.6 0-4.2-1.3-5.6-3.6L5 14.5a1.4 1.4 0 0 1 2.3-1.6L9 15" />
      <path d="M3 5h3M3 5l1.2-1.2M3 5l1.2 1.2" opacity="0.6" />
    </g>
  ),
  menu: (
    <g {...S}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </g>
  ),
  seat: (
    <g {...S}>
      <path d="M7 4v8.5a2 2 0 0 0 2 2h7.5" />
      <path d="M9 14.5h8l1.5 5.5" />
      <path d="M7 4h2.5v8H7z" {...SOFT} />
      <path d="M9 20h6" />
    </g>
  ),
};

/** One guide icon, decorative (the words beside it say it all). */
export function GuideIcon({ id, size = 24 }: { id: GuideIconId; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {ICONS[id]}
    </svg>
  );
}
