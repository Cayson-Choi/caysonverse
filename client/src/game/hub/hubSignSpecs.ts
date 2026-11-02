import { HUB_DOORS } from "@caysonverse/shared/school/hubMap";
import { ROOM_IDS, ROOM_LABELS, type RoomId } from "@caysonverse/shared/escape/constants";

/**
 * The hall's text plates (AI 학교 탈출, Task 23). hub.glb ships the plates BLANK (the model never holds text, so a
 * wording or language change never needs Blender); the scene hangs a transparent label in front of each.
 *
 * Where each plate is comes from the art scripts' layout (art/school/tools/props_b.py and build_kit.py), in game
 * coordinates (x east, y up, z south; the glTF exporter maps Blender (x, y, z) to game (x, z, -y)):
 *  - the progress board's title pill: 3.6 x 0.44 m, centre height 3.58, its front face 0.42 m inside the north wall
 *    (z = -11.58), looking south (+z, into the hall);
 *  - a door sign plate (kit_wall_door_2m): 1.3 x 0.4 m, centre height 3.5, standing 0.075 m out of the corridor wall
 *    on the room side, over each of the four doors;
 *  - the team sign (props_b.team_sign): a round double-sided sign at (-4.35, 5.0), centre height 2.15, its white
 *    inner disc 0.8 m across and 0.075 m to each side of the centre plane;
 *  - the west seal's plate (props_b.west_seal): 2.0 x 0.5 m at height 3.0, 0.24 m out of the sealed doorway
 *    (x = -13.76), looking east;
 *  - a small name plate under each of the progress board's seven windows (Task 24; the model has no slot for text, and
 *    the windows are 0.6 m apart, so without it a room was told apart by colour and place only): the window frames
 *    (props_b.progress_board) are 0.62 m wide, centred at height 1.55 and end at 1.18; below them the school building's front
 *    face (z = -11.38) runs down to the hedge strip (top at 0.95), which leaves a 0.18 m band for the name.
 * A label hangs `LABEL_GAP` in front of its plate's face (polygon offset does the rest).
 */

/** How far in front of the plate's face a label hangs (m). */
export const LABEL_GAP = 0.004;

export interface SignSpec {
  /** Stable key. */
  id: string;
  /** The words, one string per line (Korean, drawn at runtime). */
  lines: readonly string[];
  /** Label centre (m). */
  x: number;
  y: number;
  z: number;
  /** Yaw: 0 faces +z (south), π faces -z, π/2 faces +x (east). */
  rotY: number;
  /** Label size (m): the plate's face. */
  w: number;
  h: number;
  /** Text colour (the plates are violet and white; the label is just the words). */
  color: string;
  /** A soft dark edge round the letters (white words on a violet plate), or none. */
  outline: string | null;
}

/** Text on the violet plates (title, doors, seal). */
const ON_VIOLET = { color: "#FFFFFF", outline: "rgba(52, 24, 128, 0.7)" } as const;
/** Text on the team sign's white disc. */
const ON_WHITE = { color: "#4B4FD8", outline: null } as const;

const TITLE_Z = -11.58;
const DOOR_PLATE_OUT = 0.075;
const DOOR_WALL_Z = 3;
const TEAM_SIGN = { x: -4.35, z: 5.0 } as const;
const TEAM_DISC_HALF_DEPTH = 0.075;
const SEAL_FACE_X = -13.76;
/** x of each room's window on the progress board (props_b.ROOM_WINDOWS: west rooms on the left wing, east rooms on the right). */
export const BOARD_WINDOW_X: Readonly<Record<RoomId, number>> = {
  media: -2.85,
  science: -2.2,
  art: -1.55,
  counsel: 1.15,
  library: 1.75,
  broadcast: 2.35,
  career: 2.95,
};
/**
 * The name plates under the windows: on the building's front face, a hair narrower than the 0.6 m between windows, just above
 * the hedge strip (its top is 0.95 m and it stands 0.13 m in front of the face, so from the default camera it hides the
 * face's bottom few centimetres) and clear of the window frame (which ends at 1.18).
 */
export const BOARD_PLATE = { y: 1.09, z: -11.38 + LABEL_GAP, w: 0.52, h: 0.16 } as const;
/**
 * The plate's x where it is not its window's: the two outermost windows sit by the building's corner bushes (spheres standing
 * 0.2 m in front of the face at x -3.6..-3.3 and 3.35..3.65, props_b.progress_board), which would hide the rim of their word.
 */
const BOARD_PLATE_X: Partial<Record<RoomId, number>> = { media: -2.8, career: 2.88 };

export const TITLE_TEXT = "AI 학교 탈출";
export const TEAM_SIGN_LINES: readonly string[] = ["팀", "만들기"];
export const SEAL_TEXT = "다음 업데이트";

export const HUB_SIGNS: readonly SignSpec[] = [
  {
    id: "title",
    lines: [TITLE_TEXT],
    x: 0,
    y: 3.58,
    z: TITLE_Z + LABEL_GAP,
    rotY: 0,
    w: 3.6,
    h: 0.44,
    ...ON_VIOLET,
  },
  ...HUB_DOORS.map(
    (d): SignSpec => {
      const north = d.side === "n";
      return {
        id: `door-${d.room}`,
        lines: [ROOM_LABELS[d.room]],
        x: d.x,
        y: 3.5,
        // North-wall doors look south (+z), south-wall doors north (-z); the plate stands out of the wall by 7.5 cm.
        z: north ? -DOOR_WALL_Z + DOOR_PLATE_OUT + LABEL_GAP : DOOR_WALL_Z - DOOR_PLATE_OUT - LABEL_GAP,
        rotY: north ? 0 : Math.PI,
        w: 1.3,
        h: 0.4,
        ...ON_VIOLET,
      };
    },
  ),
  // The team sign reads from both sides (the rug is on its west, the hall's middle on its east and south).
  ...([1, -1] as const).map(
    (side): SignSpec => ({
      id: side === 1 ? "team-front" : "team-back",
      lines: TEAM_SIGN_LINES,
      x: TEAM_SIGN.x,
      y: 2.15,
      z: TEAM_SIGN.z + side * (TEAM_DISC_HALF_DEPTH + LABEL_GAP),
      rotY: side === 1 ? 0 : Math.PI,
      w: 0.8,
      h: 0.8,
      ...ON_WHITE,
    }),
  ),
  // The progress board's room names, one under each window.
  ...ROOM_IDS.map(
    (room): SignSpec => ({
      id: `board-${room}`,
      lines: [ROOM_LABELS[room]],
      x: BOARD_PLATE_X[room] ?? BOARD_WINDOW_X[room],
      y: BOARD_PLATE.y,
      z: BOARD_PLATE.z,
      rotY: 0,
      w: BOARD_PLATE.w,
      h: BOARD_PLATE.h,
      ...ON_WHITE,
    }),
  ),
  {
    id: "seal",
    lines: [SEAL_TEXT],
    x: SEAL_FACE_X + LABEL_GAP,
    y: 3.0,
    z: 0,
    rotY: Math.PI / 2,
    w: 2.0,
    h: 0.5,
    ...ON_VIOLET,
  },
];

/**
 * The size, in px, of a label's canvas: dense enough to stay crisp from the camera's closest approach
 * (about 300 px per metre), never above the GPU-friendly 2048.
 */
export const LABEL_PX_PER_M = 300;
export function labelCanvasSize(spec: Pick<SignSpec, "w" | "h">): { width: number; height: number } {
  const clamp = (v: number): number => Math.max(32, Math.min(2048, Math.round(v)));
  return { width: clamp(spec.w * LABEL_PX_PER_M), height: clamp(spec.h * LABEL_PX_PER_M) };
}

/**
 * The font size (px) that fits `lines` into a w x h canvas: each line at most `maxWidth`(px wide as measured) and the
 * block at most 78% of the height. `measure(text, px)` gives a line's width at a font size (the canvas does that;
 * a test passes a stub).
 */
export function fitFontPx(
  lines: readonly string[],
  width: number,
  height: number,
  measure: (text: string, px: number) => number,
): number {
  const byHeight = (height * 0.78) / (lines.length + (lines.length - 1) * 0.12);
  const reference = 100;
  let px = byHeight;
  for (const line of lines) {
    const w = measure(line, reference);
    if (w > 0) px = Math.min(px, (width * 0.88 * reference) / w);
  }
  return Math.max(8, px);
}
