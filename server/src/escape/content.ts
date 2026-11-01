/**
 * Room data → what the client may see, and the list of secrets (AI 학교 탈출, Task 7). Pure.
 *
 * - `publicContent` copies the public fields one by one (never by spreading), so a secret field
 *   added to the room data later cannot slip into the projection by accident. Sort cards and
 *   finale options are put in a fixed hash order, so the data order (often grouped by answer,
 *   right option first) cannot give the answer away.
 * - `secretStrings` is what must never reach the client bundle, the public content or an AI
 *   rephrasing (Task 12).
 * - `bundleNeedles` turns the secrets into patterns for the client-bundle check (Task 25),
 *   minus anything that is public anyway (ruling E9: a public label such as "마지막 문" is also
 *   client UI copy and must not trip the check).
 */

import type { TextLevel } from "@caysonverse/shared/escape/constants";
import type { PublicLock, RoomContent } from "@caysonverse/shared/escape/messages";
import type { LockDef, RoomDef, Text } from "./types";

export type { PublicItem, PublicLock, RoomContent } from "@caysonverse/shared/escape/messages";

const LEVELS: readonly TextLevel[] = ["easy", "hard"];

export function resolveText(t: Text, level: TextLevel): string {
  return typeof t === "string" ? t : t[level];
}

function bothLevels(t: Text): string[] {
  return typeof t === "string" ? [t] : [t.easy, t.hard];
}

/** FNV-1a (32-bit) over the UTF-16 code units of `s`. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * `xs` in a fixed order that depends only on each entry's key (FNV-1a hash, ties broken by id):
 * never on the data order or the answer, and the same at both text levels, so every teammate and
 * every reconnect sees one board.
 */
function hashOrder<T extends { id: string }>(xs: readonly T[], key: (x: T) => string): T[] {
  return xs
    .map((x) => ({ x, h: fnv1a(key(x)) }))
    .sort((a, b) => a.h - b.h || (a.x.id < b.x.id ? -1 : a.x.id > b.x.id ? 1 : 0))
    .map((e) => e.x);
}

function publicLock(roomId: string, l: LockDef, level: TextLevel): PublicLock {
  const base = { id: l.id, objectId: l.objectId, plate: resolveText(l.plate, level) };
  switch (l.kind) {
    case "digits":
      return { ...base, kind: "digits", length: l.length };
    case "letters": // wheel order stays: lock input stores wheel indexes
      return { ...base, kind: "letters", wheels: l.wheels.map((w) => [...w]) };
    case "sort": {
      const lock: PublicLock = {
        ...base,
        kind: "sort",
        bins: l.bins.map((b) => ({ id: b.id, label: b.label })),
        cards: hashOrder(l.cards, (c) => `${roomId}/${l.id}/${c.id}`).map((c) => ({ id: c.id, label: c.label })),
      };
      if (l.needsItem !== undefined) lock.needsItem = l.needsItem;
      return lock;
    }
  }
}

/**
 * The room as the client sees it, every Text resolved for `level`. Leaves out answers, lock
 * logic, hints, inspect text, split halves, UV text, persuasion explanations, the summary and the
 * escape lines (they may retell the answer; they come with the `escaped` event).
 */
export function publicContent(def: RoomDef, level: TextLevel): RoomContent {
  const escapeIds = new Set(def.escapeLines);
  const lines: RoomContent["lines"] = Object.fromEntries(
    Object.entries(def.lines)
      .filter(([id]) => !escapeIds.has(id))
      .map(([id, line]) => [id, { speaker: line.speaker, text: resolveText(line.text, level) }]),
  );
  return {
    roomId: def.id,
    title: def.title,
    objects: def.objects.map((o) => ({ id: o.id, label: o.label, kind: o.kind })),
    items: def.items.map((i) => ({ id: i.id, label: i.label, icon: i.icon })),
    locks: def.locks.map((l) => publicLock(def.id, l, level)),
    stages: def.stages.map((st) => ({ id: st.id, title: st.title })),
    lines,
    introLines: [...def.introLines],
    finale: {
      claim: resolveText(def.finale.claim, level),
      steps: def.finale.steps.map((st) => ({
        id: st.id,
        prompt: resolveText(st.prompt, level),
        options: hashOrder(st.options, (o) => `${def.id}/finale/${st.id}/${o.id}`).map((o) =>
          o.desc === undefined ? { id: o.id, label: o.label } : { id: o.id, label: o.label, desc: o.desc },
        ),
      })),
    },
  };
}

/**
 * Strings that must stay on the server: lock answers (digits as written, letters joined), split
 * halves, UV-revealed text, every hint, the persuasion explanations and the summary sentences
 * (both levels). Not the summary source, the locked-half template or anything public.
 */
export function secretStrings(def: RoomDef): string[] {
  const out = new Set<string>();
  for (const l of def.locks) {
    if (l.kind === "digits") out.add(l.answer);
    else if (l.kind === "letters") out.add(l.answer.join(""));
    // A sort answer is a mapping between public card and bin ids: no string to list.
  }
  for (const o of def.objects) {
    if (o.split) out.add(o.split.text);
    if (o.inspect.reveal) out.add(o.inspect.reveal.text);
  }
  for (const st of def.stages) for (const h of st.hints) out.add(h);
  for (const step of def.finale.steps) for (const o of step.options) if (o.explain !== undefined) out.add(o.explain);
  for (const t of def.summary.lines) for (const s of bothLevels(t)) out.add(s);
  for (const s of bothLevels(def.summary.question)) out.add(s);
  for (const id of def.escapeLines) {
    const line = def.lines[id];
    if (line) for (const s of bothLevels(line.text)) out.add(s);
  }
  out.delete("");
  return [...out];
}

// ─────────────────────────────── Bundle needles (Task 25) ───────────────────────────────

/** Every string (keys and values) of a JSON-like value. */
function collectStrings(x: unknown, out: Set<string>): void {
  if (typeof x === "string") out.add(x);
  else if (Array.isArray(x)) for (const v of x) collectStrings(v, out);
  else if (x !== null && typeof x === "object")
    for (const [k, v] of Object.entries(x)) {
      out.add(k);
      collectStrings(v, out);
    }
}

/** Every string of the public content at both text levels. */
export function publicStrings(def: RoomDef): string[] {
  const out = new Set<string>();
  for (const level of LEVELS) collectStrings(publicContent(def, level), out);
  return [...out];
}

const HANGUL = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/;
/** A secret becomes a bare text needle only from this many characters on (shorter ones match ordinary text). */
const MIN_NEEDLE_CHARS = 4;
/** Regex source for one literal backslash. */
const BS = "\\\\";
const QUOTE = "[\"'`]";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `digits` hex digits, each letter matching either case (esbuild prints \uB098, others \ub098). */
function hex(code: number, digits: number): string {
  return code
    .toString(16)
    .padStart(digits, "0")
    .replace(/[a-f]/g, (h) => `[${h}${h.toUpperCase()}]`);
}

/**
 * One UTF-16 unit as a JS escape: \uXXXX, and for U+0000..U+00FF also \xXX (esbuild with
 * charset=ascii prints U+0080..U+00FF, such as ·, as \xB7).
 */
function unitEscape(code: number): string {
  return code <= 0xff ? `${BS}(?:u00${hex(code, 2)}|x${hex(code, 2)})` : `${BS}u${hex(code, 4)}`;
}

/**
 * Regex source matching `s` as it sits inside a JS string literal in built code: quotes may be
 * backslash-escaped, control characters are escaped, and with `escaped` every non-ASCII UTF-16
 * unit is an escape (\uXXXX, or \xXX up to U+00FF: a minifier printing ASCII only).
 */
function literalSource(s: string, escaped: boolean): string {
  let src = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (code > 0x7e) src += escaped ? unitEscape(code) : escapeRegExp(ch);
    else if (ch === "\n") src += `${BS}n`;
    else if (ch === "\r") src += `${BS}r`;
    else if (ch === "\t") src += `${BS}t`;
    else if (code < 0x20) src += unitEscape(code);
    else if (ch === "\\") src += `${BS}${BS}`;
    else if (ch === '"' || ch === "'" || ch === "`") src += `(?:${BS})?${ch}`;
    else src += escapeRegExp(ch);
  }
  return src;
}

/**
 * Patterns that find this room's secrets in a built client bundle (Task 25 scans
 * client/dist with them). No flags, so `test()` is stateless.
 *
 * (a) every secret with Hangul and ≥ 4 characters, as written and \u-escaped;
 * (b) a digits answer as a quoted literal ("4719", '4719', `4719`);
 * (c) a letters answer joined (both forms; quoted when shorter than 4 letters, so 나라 does not
 *     match 우리나라) and as an array literal (["동","의",…], escaped or not).
 * A secret that also appears in the public content (either level) is dropped (ruling E9): it is
 * in the client anyway, so finding it proves nothing.
 */
export function bundleNeedles(def: RoomDef): RegExp[] {
  const pub = publicStrings(def);
  const isPublic = (s: string) => pub.some((p) => p.includes(s));
  const sources = new Set<string>();
  const addText = (s: string, quoted = false) => {
    if (isPublic(s)) return;
    const q = quoted ? QUOTE : "";
    sources.add(q + literalSource(s, false) + q).add(q + literalSource(s, true) + q);
  };

  for (const s of secretStrings(def)) if (HANGUL.test(s) && [...s].length >= MIN_NEEDLE_CHARS) addText(s);
  for (const l of def.locks) {
    if (l.kind === "digits") sources.add(`${QUOTE}${escapeRegExp(l.answer)}${QUOTE}`);
    else if (l.kind === "letters") {
      const word = l.answer.join("");
      addText(word, [...word].length < MIN_NEEDLE_CHARS);
      const element = (letter: string) => `${QUOTE}(?:${literalSource(letter, false)}|${literalSource(letter, true)})${QUOTE}`;
      sources.add(l.answer.map(element).join(",\\s*"));
    }
  }
  return [...sources].map((src) => new RegExp(src));
}
