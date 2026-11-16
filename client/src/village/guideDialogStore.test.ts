import { describe, expect, it } from "vitest";
import { closeGuideDialog, guideDialogOpen, openGuideDialog, subscribeGuideDialog } from "./guideDialogStore";

describe("guideDialogStore (Task 9A)", () => {
  it("opens on a guide id or its target id, ignores unknown ids, closes, and notifies once per change", () => {
    let n = 0;
    const off = subscribeGuideDialog(() => n++);
    openGuideDialog("guide:plaza_guide");
    expect(guideDialogOpen()).toBe("plaza_guide");
    openGuideDialog("plaza_guide"); // same: no change
    expect(n).toBe(1);
    openGuideDialog("guide:nobody");
    expect(guideDialogOpen()).toBe("plaza_guide");
    openGuideDialog("hall_desk"); // the hall's desk guide is gone (2026-11-17): an unknown id
    expect(guideDialogOpen()).toBe("plaza_guide");
    closeGuideDialog();
    expect(guideDialogOpen()).toBeNull();
    expect(n).toBe(2);
    off();
  });
});
