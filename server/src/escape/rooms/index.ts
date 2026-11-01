/**
 * Every puzzle room's data by room id (AI 학교 탈출). SERVER ONLY: the rooms hold answers, hints and
 * clue originals, so the client never imports this file (Task 25's bundle check). Phase 1 has the
 * counselling room only; the other doors stay shut (PHASE1_OPEN_ROOMS).
 */

import type { RoomId } from "@caysonverse/shared/escape/constants";
import type { RoomDef } from "../types";
import { counsel } from "./counsel";

export const ROOM_DEFS: Partial<Record<RoomId, RoomDef>> = { counsel };
