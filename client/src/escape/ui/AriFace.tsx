import { useId } from "react";
import "../escape.css";

export type AriExpression = "glitch" | "smile" | "think" | "wake";

/**
 * Ari, the counselling room's AI (AI 학교 탈출, Task 17): an ORIGINAL round screen face with an
 * antenna, drawn as inline SVG so it needs no image file and scales to any size. The expression
 * is drawn from the shapes below and animated in escape.css (a jittering glitch, a blinking
 * antenna, thinking dots, a waking-up blink); `prefers-reduced-motion` stills it.
 *
 *  - glitch: a broken, flickering face (the story starts with Ari out of order)
 *  - smile:  eyes closed in a smile, an open grin
 *  - think:  eyes looking up and aside, a small wavy mouth, thinking dots
 *  - wake:   eyes opening wide, a small round "oh" of a mouth, a sparkle
 */
export function AriFace({ expression, size = 72 }: { expression: AriExpression; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const shell = `ari-shell-${uid}`;
  const screen = `ari-screen-${uid}`;
  return (
    <svg
      className={`cv-ari cv-ari-${expression}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="아리"
    >
      <defs>
        <linearGradient id={shell} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#4B4FD8" />
        </linearGradient>
        <linearGradient id={screen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFDF8" />
          <stop offset="1" stopColor="#EDE7FF" />
        </linearGradient>
      </defs>

      {/* antenna */}
      <g className="cv-ari-antenna">
        <line x1="50" y1="19" x2="50" y2="8" stroke="#4B4FD8" strokeWidth="4" strokeLinecap="round" />
        <circle className="cv-ari-bulb" cx="50" cy="7" r="5.5" fill="#FFC857" stroke="#4B4FD8" strokeWidth="2.5" />
      </g>

      {/* head: a rounded body and the screen inside it */}
      <rect x="9" y="19" width="82" height="74" rx="30" fill={`url(#${shell})`} />
      <rect x="9" y="19" width="82" height="74" rx="30" fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="2" />
      <rect x="17" y="27" width="66" height="58" rx="24" fill={`url(#${screen})`} />
      {/* ear bolts */}
      <circle cx="9" cy="56" r="5" fill="#4B4FD8" />
      <circle cx="91" cy="56" r="5" fill="#4B4FD8" />

      <g className="cv-ari-face" fill="none" stroke="#2A2766" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        {expression === "smile" && (
          <>
            <path d="M31 51 Q37 43 43 51" />
            <path d="M57 51 Q63 43 69 51" />
            <path d="M38 63 Q50 77 62 63 Z" fill="#2A2766" />
            <circle cx="28" cy="62" r="4.5" fill="#FF9DB5" stroke="none" opacity="0.7" />
            <circle cx="72" cy="62" r="4.5" fill="#FF9DB5" stroke="none" opacity="0.7" />
          </>
        )}
        {expression === "think" && (
          <>
            <circle cx="38" cy="48" r="5" fill="#2A2766" stroke="none" />
            <circle cx="64" cy="48" r="5" fill="#2A2766" stroke="none" />
            <circle cx="40" cy="46" r="1.8" fill="#FFFFFF" stroke="none" />
            <circle cx="66" cy="46" r="1.8" fill="#FFFFFF" stroke="none" />
            <path d="M30 38 Q38 33 45 37" strokeWidth="3.5" />
            <path d="M55 36 Q63 31 71 36" strokeWidth="3.5" />
            <path d="M40 67 Q45 63 50 67 T60 67" />
            <g className="cv-ari-dots" fill="#8B5CF6" stroke="none">
              <circle cx="78" cy="30" r="2.6" />
              <circle cx="85" cy="23" r="3.4" />
              <circle cx="93" cy="14" r="4.4" />
            </g>
          </>
        )}
        {expression === "glitch" && (
          <>
            <g className="cv-ari-split">
              <path d="M30 43 L44 57 M44 43 L30 57" stroke="#E14B6B" />
              <path d="M57 45 H71" stroke="#2A2766" />
              <path d="M57 53 H67" stroke="#2A2766" />
            </g>
            <path d="M33 70 L40 63 L47 71 L54 62 L61 70 L67 64" strokeWidth="4" />
            <path className="cv-ari-scan" d="M19 36 H81" stroke="#4B4FD8" strokeOpacity="0.35" strokeWidth="3" />
            <path className="cv-ari-scan cv-ari-scan-2" d="M19 74 H81" stroke="#E14B6B" strokeOpacity="0.3" strokeWidth="3" />
          </>
        )}
        {expression === "wake" && (
          <>
            <g className="cv-ari-eyes">
              <circle cx="38" cy="50" r="8" fill="#FFFFFF" />
              <circle cx="62" cy="50" r="8" fill="#FFFFFF" />
              <circle cx="38" cy="51" r="4.2" fill="#2A2766" stroke="none" />
              <circle cx="62" cy="51" r="4.2" fill="#2A2766" stroke="none" />
              <circle cx="39.6" cy="49" r="1.5" fill="#FFFFFF" stroke="none" />
              <circle cx="63.6" cy="49" r="1.5" fill="#FFFFFF" stroke="none" />
            </g>
            <ellipse cx="50" cy="70" rx="5.5" ry="6.5" fill="#2A2766" stroke="none" />
            <path className="cv-ari-sparkle" d="M82 28 L84 33 L89 35 L84 37 L82 42 L80 37 L75 35 L80 33 Z" fill="#FFC857" stroke="none" />
          </>
        )}
      </g>
    </svg>
  );
}
