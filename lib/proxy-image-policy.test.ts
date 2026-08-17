import { describe, expect, it } from "vitest";
import { decideProxyUrl } from "./proxy-image-policy";

describe("proxy-image URL policy", () => {
  it("allows ordinary public http(s) image hosts", () => {
    for (const u of [
      "https://pub-edb881114340454d8aae56176adec4f2.r2.dev/pokemon/617520.jpg",
      "https://tcgplayer-cdn.tcgplayer.com/product/517824_200w.jpg",
      "http://example.com/a.png",
    ]) expect(decideProxyUrl(u).ok).toBe(true);
  });
  it("rejects missing, malformed and non-http schemes", () => {
    expect(decideProxyUrl(null)).toEqual({ ok: false, reason: "Missing url" });
    expect(decideProxyUrl("not a url").ok).toBe(false);
    expect(decideProxyUrl("file:///etc/passwd").ok).toBe(false);
    expect(decideProxyUrl("ftp://example.com/x").ok).toBe(false);
    expect(decideProxyUrl("data:image/png;base64,AAAA").ok).toBe(false);
  });
  it("rejects loopback, private, link-local and metadata hosts (SSRF)", () => {
    for (const u of [
      "http://localhost/x", "http://127.0.0.1/x", "http://[::1]/x", "http://0.0.0.0/x",
      "http://169.254.169.254/latest/meta-data/", "http://10.1.2.3/x", "http://192.168.0.1/x",
      "http://172.16.5.5/x", "http://100.64.0.1/x", "http://foo.internal/x", "http://[fd00::1]/x",
      "http://[::ffff:127.0.0.1]/x",
    ]) expect(decideProxyUrl(u).ok, u).toBe(false);
  });
  it("rejects credentials embedded in the URL", () => {
    expect(decideProxyUrl("https://user:pw@example.com/a.png").ok).toBe(false);
  });
});
