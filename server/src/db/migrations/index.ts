import type { DatabaseSync } from "node:sqlite";
import { m001 } from "./001_core";
import { m002 } from "./002_memorial2";
import { m003 } from "./003_bank_c";

/** One forward-only schema step. Applied once, in version order, inside a transaction (sqlite.ts `migrate`). */
export interface Migration {
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}

/** Every migration, oldest first. Append new ones (003_…); never edit or renumber a shipped one. */
export const MIGRATIONS: readonly Migration[] = [m001, m002, m003];
