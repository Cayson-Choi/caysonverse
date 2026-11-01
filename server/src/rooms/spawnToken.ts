/**
 * The spawn token: a secret made fresh on every boot that only server code knows.
 *
 * Class rooms and escape rooms are created by the SERVER (`matchMaker.createRoom` from the
 * teacher HTTP route or from a ClassRoom). A client must never create one through
 * matchmaking (`create` / `joinOrCreate`), so each of those rooms calls `assertSpawnToken`
 * on its create options in `onCreate`; a client cannot supply the token because it never
 * leaves this process (not in a response, not in room metadata, not in a log).
 */

import { randomBytes, timingSafeEqual } from "node:crypto";

/** 24 random bytes as base64url (32 symbols). New on every server start. */
export const SPAWN_TOKEN: string = randomBytes(24).toString("base64url");

const SPAWN_TOKEN_BYTES = Buffer.from(SPAWN_TOKEN, "utf8");

/** Fixed message: never echoes the options or the token. */
const SPAWN_REFUSED = "잘못된 접근이에요";

/**
 * Throws unless `options.spawnToken` is exactly SPAWN_TOKEN. Constant-time comparison
 * (the lengths are compared first, which reveals nothing: the token length is public).
 */
export function assertSpawnToken(options: unknown): void {
  const token =
    typeof options === "object" && options !== null
      ? (options as { spawnToken?: unknown }).spawnToken
      : undefined;
  if (typeof token !== "string") throw new Error(SPAWN_REFUSED);
  const given = Buffer.from(token, "utf8");
  if (given.length !== SPAWN_TOKEN_BYTES.length || !timingSafeEqual(given, SPAWN_TOKEN_BYTES)) {
    throw new Error(SPAWN_REFUSED);
  }
}
