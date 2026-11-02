import { useCallback, useEffect, useRef, useState } from "react";
import { EscapeMsg } from "@caysonverse/shared/escape/messages";
import { sendEscape } from "../../net/connection";
import { settleOverrides } from "./lockInput";

/** A change waits this long for the server to echo it before the screen goes back to what the server says. */
const OVERRIDE_TTL_MS = 1200;
/** Wheel changes go out at most this often (the server takes 10 actions a second), the latest one always last. */
const SEND_GAP_MS = 110;

const NONE: Readonly<Record<string, string>> = Object.freeze({});

/**
 * What the player just changed, shown until the server's shared state shows the same (AI 학교 탈출, Task 19).
 * The lock plates draw the SERVER's shared input — a teammate's turn shows up here too — but a second quick
 * tap must build on the first, not on the old value still on screen, so a local change is kept per key until
 * the server echoes it (`settleOverrides`) or OVERRIDE_TTL_MS passes (the server refused it, or a teammate
 * wrote after us: the server's word wins). Nothing here says whether a value is right.
 */
export function useOverrides(server: Readonly<Record<string, string>>): {
  /** The value to draw for `key`: the pending local change, else the server's. */
  get: (key: string, fromServer: string) => string;
  set: (key: string, value: string) => void;
} {
  const [over, setOver] = useState<Readonly<Record<string, string>>>(NONE);
  const timers = useRef(new Map<string, number>());

  // The server caught up with some changes: they are not pending any more (the same object when none did).
  useEffect(() => setOver((o) => settleOverrides(o, server)), [server]);

  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const t of live.values()) window.clearTimeout(t);
      live.clear();
    };
  }, []);

  const set = useCallback((key: string, value: string) => {
    setOver((o) => ({ ...o, [key]: value }));
    const live = timers.current;
    const old = live.get(key);
    if (old !== undefined) window.clearTimeout(old);
    live.set(
      key,
      window.setTimeout(() => {
        live.delete(key);
        setOver((o) => {
          if (!(key in o)) return o;
          const next = { ...o };
          delete next[key];
          return next;
        });
      }, OVERRIDE_TTL_MS),
    );
  }, []);

  const get = useCallback((key: string, fromServer: string) => over[key] ?? fromServer, [over]);
  return { get, set };
}

/**
 * Sends a digits / letters lock's input as the player turns the wheels: the first change at once, the ones
 * that follow no faster than SEND_GAP_MS apart (a drag can turn many steps in a moment), and the last one
 * always. `flush` sends what is waiting now (before the submit, so the server judges the final input); the
 * lock closing flushes too.
 */
export function useLockInputSender(lockId: string): { send: (value: string) => void; flush: () => void } {
  const last = useRef(0);
  const timer = useRef(0);
  const waiting = useRef<string | null>(null);

  const out = useCallback(
    (value: string) => {
      last.current = performance.now();
      sendEscape(EscapeMsg.LockInput, { lockId, value });
    },
    [lockId],
  );

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    const value = waiting.current;
    waiting.current = null;
    if (value !== null) out(value);
  }, [out]);

  const send = useCallback(
    (value: string) => {
      const wait = last.current + SEND_GAP_MS - performance.now();
      if (wait <= 0 && timer.current === 0) {
        out(value);
        return;
      }
      waiting.current = value;
      if (timer.current === 0) timer.current = window.setTimeout(flush, Math.max(wait, 0));
    },
    [out, flush],
  );

  useEffect(() => flush, [flush]);
  return { send, flush };
}
