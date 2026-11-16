import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

/**
 * Where the memorial keeps its data, from the environment (names only in docs; values live in /etc/caysonverse.env):
 *   CV_DATA_DIR          data root, OUTSIDE the git checkout. Default /var/lib/caysonverse on Linux, ~/.caysonverse-data elsewhere.
 *   CV_DB_PATH           SQLite file. Default <data>/caysonverse.db
 *   CV_MEDIA_DIR         photo store. Default <data>/media
 *   CV_ADMIN_KEY_SHA256  hex SHA-256 of the operator's review key. Unset → the review page and API answer 404.
 *   CV_MEDIA_SECRET      HMAC secret of signed photo URLs (≥ 32 chars). Unset → a random one per boot (links last 10 min anyway).
 *   CV_MEMORIAL_OFF=1    start without persistence (the hall still works; claiming says it is unavailable).
 */
export interface MemorialConfig {
  dataDir: string;
  dbPath: string;
  mediaDir: string;
  adminKeySha256: string | null;
  mediaSecret: Buffer;
  /** Random per boot: salts IP hashes (rate limits only, never stored). */
  ipSalt: Buffer;
  off: boolean;
}

export function defaultDataDir(platform: NodeJS.Platform = process.platform): string {
  return platform === "linux" ? "/var/lib/caysonverse" : path.join(os.homedir(), ".caysonverse-data");
}

export function memorialConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MemorialConfig {
  const dataDir = env.CV_DATA_DIR?.trim() || defaultDataDir();
  const admin = env.CV_ADMIN_KEY_SHA256?.trim().toLowerCase() ?? "";
  const secret = env.CV_MEDIA_SECRET?.trim() ?? "";
  return {
    dataDir,
    dbPath: env.CV_DB_PATH?.trim() || path.join(dataDir, "caysonverse.db"),
    mediaDir: env.CV_MEDIA_DIR?.trim() || path.join(dataDir, "media"),
    adminKeySha256: /^[0-9a-f]{64}$/.test(admin) ? admin : null,
    mediaSecret: secret.length >= 32 ? Buffer.from(secret, "utf8") : crypto.randomBytes(32),
    ipSalt: crypto.randomBytes(16),
    off: env.CV_MEMORIAL_OFF === "1",
  };
}
