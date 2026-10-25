import { describe, expect, it } from "vitest";

import { decodeTweetText, tweetTextSegments } from "./arrival-text";

describe("decodeTweetText", () => {
  it("turns X's entity escapes back into characters and leaves everything else as written", () => {
    expect(decodeTweetText("ポケカ &amp; ワンピ &lt;限定&gt; &quot;SAR&quot; it&#39;s &apos;ok&apos;"))
      .toBe("ポケカ & ワンピ <限定> \"SAR\" it's 'ok'");
    // Only the escapes X produces are decoded; the text is never parsed as markup.
    expect(decodeTweetText("<b>入荷</b> &nbsp; &#x41; &amp;amp;")).toBe("<b>入荷</b> &nbsp; &#x41; &amp;");
    expect(decodeTweetText("")).toBe("");
  });
});

describe("tweetTextSegments", () => {
  it("splits out each t.co short link and keeps the text around it in order", () => {
    expect(tweetTextSegments("詳細 https://t.co/AbC123 と https://t.co/xyz9\n#ポケカ")).toEqual([
      { kind: "text", value: "詳細 " },
      { kind: "link", value: "https://t.co/AbC123" },
      { kind: "text", value: " と " },
      { kind: "link", value: "https://t.co/xyz9" },
      { kind: "text", value: "\n#ポケカ" },
    ]);
    expect(tweetTextSegments("https://t.co/only")).toEqual([{ kind: "link", value: "https://t.co/only" }]);
  });

  it("links nothing else", () => {
    const text = "see https://example.com/t.co/x and http://t.co/plain and t.co/bare";
    expect(tweetTextSegments(text)).toEqual([{ kind: "text", value: text }]);
    expect(tweetTextSegments("")).toEqual([]);
  });
});
