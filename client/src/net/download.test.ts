import { describe, it, expect, afterEach, vi } from "vitest";
import { downloadCsv, resultsFilename } from "./download";

describe("resultsFilename", () => {
  it("resultsFilename", () => expect(resultsFilename("AB2CDE", new Date(2026, 9, 31, 14, 5))).toBe("AI학교탈출_AB2CDE_20261031-1405.csv"));

  it("pads every part to two digits and uses local time", () => {
    expect(resultsFilename("K7Q2XM", new Date(2027, 0, 2, 3, 4))).toBe("AI학교탈출_K7Q2XM_20270102-0304.csv");
  });

  it("keeps only class-code symbols in the name (no path or odd characters)", () => {
    expect(resultsFilename("../a b", new Date(2026, 9, 31, 14, 5))).toBe("AI학교탈출_AB_20261031-1405.csv");
  });
});

describe("downloadCsv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves the CSV text as a Blob through a temporary a[download] link", () => {
    const anchor = { href: "", download: "", style: {} as Record<string, string>, click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn((tag: string) => {
        expect(tag).toBe("a");
        return anchor;
      }),
      body: { appendChild: append },
    });
    const created: Blob[] = [];
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((b: Blob) => {
        created.push(b);
        return "blob:results";
      }),
      revokeObjectURL: revoke,
    });
    vi.useFakeTimers();
    try {
      const csv = "\uFEFF팀,교실\n햇살(파랑),상담실\n";
      downloadCsv("AI학교탈출_AB2CDE_20261031-1405.csv", csv);

      expect(anchor.download).toBe("AI학교탈출_AB2CDE_20261031-1405.csv");
      expect(anchor.href).toBe("blob:results");
      expect(append).toHaveBeenCalledWith(anchor);
      expect(anchor.click).toHaveBeenCalledTimes(1);
      expect(anchor.remove).toHaveBeenCalledTimes(1);
      expect(created).toHaveLength(1);
      expect(created[0].type).toBe("text/csv;charset=utf-8");
      // The object URL is released afterwards (not before the browser started the save).
      expect(revoke).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revoke).toHaveBeenCalledWith("blob:results");
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts the BOM back when the transport dropped it (the browser's decoder strips a leading U+FEFF)", async () => {
    let saved: Blob | null = null;
    vi.stubGlobal("document", {
      createElement: () => ({ href: "", download: "", style: {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    });
    vi.stubGlobal("URL", {
      createObjectURL: (b: Blob) => {
        saved = b;
        return "blob:x";
      },
      revokeObjectURL() {},
    });
    downloadCsv("a.csv", "팀,교실" + String.fromCharCode(13, 10));
    const bytes = new Uint8Array(await saved!.arrayBuffer());
    // EF BB BF, then "팀" (ED 8C 80).
    expect([...bytes.slice(0, 6)]).toEqual([0xef, 0xbb, 0xbf, 0xed, 0x8c, 0x80]);
  });

  it("does not add a second BOM: a CSV that still starts with one is saved as is", async () => {
    let saved: Blob | null = null;
    vi.stubGlobal("document", {
      createElement: () => ({ href: "", download: "", style: {}, click() {}, remove() {} }),
      body: { appendChild() {} },
    });
    vi.stubGlobal("URL", {
      createObjectURL: (b: Blob) => {
        saved = b;
        return "blob:x";
      },
      revokeObjectURL() {},
    });
    downloadCsv("a.csv", "\uFEFFa,b\n");
    const bytes = new Uint8Array(await saved!.arrayBuffer());
    // EF BB BF exactly once, then "a".
    expect([...bytes.slice(0, 4)]).toEqual([0xef, 0xbb, 0xbf, 0x61]);
  });
});
