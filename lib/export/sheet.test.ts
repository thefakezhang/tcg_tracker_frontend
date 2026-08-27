import { describe, it, expect } from "vitest";
import { toCsv, toXlsx } from "./sheet";

async function text(b: Blob) {
  return Buffer.from(await b.arrayBuffer()).toString("utf8");
}
async function bytes(b: Blob) {
  return new Uint8Array(await b.arrayBuffer());
}

describe("toCsv", () => {
  it("writes a UTF-8 BOM so Excel does not read Japanese as Shift-JIS", async () => {
    const s = await text(toCsv([["カード名"]]));
    expect(s.charCodeAt(0)).toBe(0xfeff);
  });

  it("quotes separators, quotes and newlines", async () => {
    const s = await text(toCsv([["a,b", 'say "hi"', "two\nlines"]]));
    expect(s).toContain('"a,b"');
    expect(s).toContain('"say ""hi"""');
    expect(s).toContain('"two\nlines"');
  });

  it("renders null and undefined as empty, not the literal words", async () => {
    const s = await text(toCsv([[null, undefined, 0]]));
    expect(s.replace("\u{FEFF}", "")).toBe(",,0");
  });
});

describe("toXlsx", () => {
  it("produces a ZIP containing the five parts a reader requires", async () => {
    const b = await bytes(toXlsx([["a"]]));
    expect(b[0]).toBe(0x50); // 'P'
    expect(b[1]).toBe(0x4b); // 'K'
    const s = Buffer.from(b).toString("latin1");
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]) {
      expect(s).toContain(part);
    }
    // 5 local headers + 5 central-directory records + 1 end-of-central-directory
    expect(s.split("PK").length - 1).toBe(11);
  });

  it("escapes XML metacharacters so a card name cannot corrupt the sheet", async () => {
    const s = await text(toXlsx([['<b> & "x"']]));
    expect(s).toContain("&lt;b&gt; &amp;");
    expect(s).not.toContain("<b> &amp;");
  });

  it("writes numbers as numeric cells and strings as inline strings", async () => {
    const s = await text(toXlsx([[42, "42"]]));
    expect(s).toContain('<c r="A1"><v>42</v></c>');
    expect(s).toContain('t="inlineStr"');
  });

  it("skips empty cells instead of emitting blank inline strings", async () => {
    const s = await text(toXlsx([["a", "", null, "d"]]));
    expect(s).toContain('r="A1"');
    expect(s).toContain('r="D1"');
    expect(s).not.toContain('r="B1"');
    expect(s).not.toContain('r="C1"');
  });

  it("names columns past Z correctly", async () => {
    const wide = Array.from({ length: 28 }, (_, i) => `c${i}`);
    const s = await text(toXlsx([wide]));
    expect(s).toContain('r="Z1"');
    expect(s).toContain('r="AA1"');
    expect(s).toContain('r="AB1"');
  });

  it("sanitises a sheet name Excel would reject", async () => {
    const s = await text(toXlsx([["a"]], "a/b:c*d?e[f]g"));
    expect(s).toContain('name="abcdefg"');
  });

  it("strips control characters that XML 1.0 forbids", async () => {
    // Assert on the cell text, not the whole archive: raw ZIP CRC/size fields
    // contain arbitrary bytes and would match a naive scan.
    const s = await text(toXlsx([["a\u0007b"]]));
    const cell = /<t[^>]*>([^<]*)<\/t>/.exec(s)?.[1];
    expect(cell).toBe("ab");
  });
});
