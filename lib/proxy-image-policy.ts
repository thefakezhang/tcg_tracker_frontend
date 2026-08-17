// URL policy for /api/proxy-image, kept pure so it can be unit-tested.
//
// The route exists so the buy-list export can rasterise card images that live
// on other origins (CORS). It must not become an open proxy: only http(s), no
// credentials in the URL, and no loopback / private / link-local hosts (which
// is what turns "fetch this image for me" into an SSRF primitive against the
// hosting platform's metadata endpoints or internal services).
export type ProxyDecision = { ok: true; url: URL } | { ok: false; reason: string };

const PRIVATE_V4 = [
  /^127\./, /^10\./, /^0\./, /^169\.254\./,
  /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("::ffff:")) {
    // IPv4-mapped IPv6. The URL parser canonicalises "::ffff:127.0.0.1" to
    // "::ffff:7f00:1", so accept both spellings and re-check as v4.
    const rest = h.slice(7);
    if (rest.includes(".")) return isPrivateHost(rest);
    const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
    if (m) {
      const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
      return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return true;
  }
  return PRIVATE_V4.some((re) => re.test(h));
}

export function decideProxyUrl(raw: string | null): ProxyDecision {
  if (!raw) return { ok: false, reason: "Missing url" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Unsupported scheme" };
  if (url.username || url.password) return { ok: false, reason: "Credentials not allowed" };
  if (!url.hostname || isPrivateHost(url.hostname)) return { ok: false, reason: "Host not allowed" };
  return { ok: true, url };
}
