import type { Migration } from "./index";

/**
 * 003 — bank C (2026-11-17, owner: "기억의 자리 … 없애고 그냥 일반 칸으로 바꾸는게 좋겠어"): the north wall's middle, where the arched
 * niche stood, is 6 columns x 8 rows of ordinary cubbies between banks A and B. Their stable ids `M1-C-r<row>-c<col>` are seeded
 * here (the boot-time seedSlots would add them too; this keeps the slot table's history explicit). No existing id changes.
 */
export const m003: Migration = {
  version: 3,
  name: "bank_c_slots",
  up(db) {
    const ins = db.prepare("INSERT OR IGNORE INTO slot (id, hall, bank, row, col, sample) VALUES (?, 'M1', 'C', ?, ?, 0)");
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 6; col += 1) ins.run(`M1-C-r${row}-c${String(col).padStart(2, "0")}`, row, col);
    }
  },
};
