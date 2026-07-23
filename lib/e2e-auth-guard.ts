import { createHash, timingSafeEqual } from "node:crypto";

const MIN_SECRET_BYTES = 32;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);

interface E2EAuthGuardInput {
  enabled?: string;
  nodeEnvironment?: string;
  configuredSecret?: string;
  presentedSecret?: string | null;
  supabaseUrl?: string;
}

function isLiteralLoopbackSupabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function allowLocalE2EAuth(input: E2EAuthGuardInput): boolean {
  if (
    input.enabled !== "1" ||
    input.nodeEnvironment === "production" ||
    !input.configuredSecret ||
    Buffer.byteLength(input.configuredSecret, "utf8") < MIN_SECRET_BYTES ||
    !input.presentedSecret ||
    !isLiteralLoopbackSupabaseUrl(input.supabaseUrl)
  ) {
    return false;
  }
  return timingSafeEqual(
    digest(input.configuredSecret),
    digest(input.presentedSecret),
  );
}
