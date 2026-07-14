import { create } from "zustand";
import { MAX_CHAT_LOG } from "@caysonverse/shared/constants";

/**
 * Session-only chat log for the collapsible panel. Chat messages are DISCRETE
 * UI events (not per-frame data), so a zustand store driving React re-renders is
 * the right home for them — unlike positions, which never touch React state. The
 * log is capped at MAX_CHAT_LOG (oldest dropped) and never persisted.
 */

export interface ChatLogEntry {
  /** Stable React key. */
  id: number;
  /** `message` = a relayed chat line; `system` = a local-only notice (dimmed). */
  kind: "message" | "system";
  /** Sender nickname — present on `message` rows only. */
  name?: string;
  text: string;
}

interface ChatState {
  log: ChatLogEntry[];
  /** Append a relayed chat line `[name] text`. */
  pushMessage: (name: string, text: string) => void;
  /** Append a local-only system notice (e.g. rate-limit rejection). */
  pushSystem: (text: string) => void;
  /** Drop the whole log (room teardown). */
  clear: () => void;
}

let nextId = 0;

/** Append `entry`, keeping only the newest MAX_CHAT_LOG rows. */
function append(log: ChatLogEntry[], entry: ChatLogEntry): ChatLogEntry[] {
  const trimmed = log.length >= MAX_CHAT_LOG ? log.slice(log.length - MAX_CHAT_LOG + 1) : log.slice();
  trimmed.push(entry);
  return trimmed;
}

export const useChatStore = create<ChatState>((set) => ({
  log: [],
  pushMessage: (name, text) =>
    set((s) => ({ log: append(s.log, { id: nextId++, kind: "message", name, text }) })),
  pushSystem: (text) =>
    set((s) => ({ log: append(s.log, { id: nextId++, kind: "system", text }) })),
  clear: () => set({ log: [] }),
}));
