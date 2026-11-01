/**
 * The class's results as CSV (AI 학교 탈출, Task 11) — what the teacher downloads. Pure.
 *
 * Binding format: UTF-8 with a BOM (so a spreadsheet reads the Korean right), CRLF after every line.
 * Header `팀,팀원,교실,결과,걸린 시간(초),남은 시간(초),힌트,틀린 시도,별`, then one `<원칙 이름> 첫 시도`
 * column for each principle that appears in some row's `firstTry`, in PRINCIPLES order. Members are
 * joined with `·`; 결과 is 탈출 / 미탈출; a first try is 정답 / 오답, or `-` when the team never got
 * to that principle. Personal data: nicknames only (no team or session ids).
 *
 * Cells: a text cell (team name, nicknames, room) starting with `=`, `+`, `-`, `@`, a tab or a CR
 * gets a leading `'` — a spreadsheet would run it as a formula, and nicknames are typed by children.
 * The other cells are the server's own values (numbers, 탈출/미탈출, 정답/오답 and the lone `-` marker,
 * which no spreadsheet reads as a formula) and are written as they are. Then any cell holding a comma,
 * a quote, a CR or an LF is wrapped in quotes with its quotes doubled.
 */

import { ROOM_LABELS, type RoomId } from "@caysonverse/shared/escape/constants";
import { PRINCIPLES } from "@caysonverse/shared/escape/principles";
import type { EscapeResult } from "../escape/EscapeRoom";

const BOM = "\uFEFF";
const CRLF = "\r\n";
const HEADER = ["팀", "팀원", "교실", "결과", "걸린 시간(초)", "남은 시간(초)", "힌트", "틀린 시도", "별"] as const;
const MEMBER_JOIN = "·";

/** Characters a spreadsheet treats as the start of a formula (plus tab and CR). */
const FORMULA_LEAD = /^[=+\-@\t\r]/;
/** Characters that force a cell into quotes. */
const NEEDS_QUOTES = /[",\r\n]/;

/** A cell for the CSV grammar: quoted (inner quotes doubled) when it holds a comma, quote, CR or LF. */
function cell(value: string | number): string {
  const s = String(value);
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A cell of typed text: a formula lead gets a `'` first, so a spreadsheet shows it as text. */
function textCell(value: string): string {
  return cell(FORMULA_LEAD.test(value) ? `'${value}` : value);
}

function roomLabel(roomId: string): string {
  return Object.hasOwn(ROOM_LABELS, roomId) ? ROOM_LABELS[roomId as RoomId] : roomId;
}

function firstTryCell(firstTry: Readonly<Record<string, boolean>>, principleId: string): string {
  if (!Object.hasOwn(firstTry, principleId)) return "-";
  return firstTry[principleId] === true ? "정답" : "오답";
}

/** The results (one row each, in the given order) as the CSV text the teacher downloads. */
export function buildResultsCsv(rows: readonly EscapeResult[]): string {
  const principles = PRINCIPLES.filter((p) => rows.some((r) => Object.hasOwn(r.firstTry, p.id)));
  const lines: string[] = [[...HEADER, ...principles.map((p) => `${p.label} 첫 시도`)].map(cell).join(",")];
  for (const r of rows) {
    const cells: string[] = [
      textCell(r.teamName),
      textCell(r.members.join(MEMBER_JOIN)),
      textCell(roomLabel(r.roomId)),
      cell(r.escaped ? "탈출" : "미탈출"),
      cell(r.elapsedS),
      cell(r.remainingS),
      cell(r.hintsUsed),
      cell(r.wrongAttempts),
      cell(r.stars),
      ...principles.map((p) => cell(firstTryCell(r.firstTry, p.id))),
    ];
    lines.push(cells.join(","));
  }
  return BOM + lines.map((l) => l + CRLF).join("");
}
