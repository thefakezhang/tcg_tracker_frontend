type ErrorRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readable(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

// Supabase can reject with a PostgREST object rather than an Error instance.
// String(object) renders "[object Object]", which hid the candidate and SQL
// detail from image-curation batch failures. Keep this formatter shared by
// every mutation path so structured errors always remain actionable.
export function formatMutationError(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  const scalar = readable(value);
  if (!isRecord(value)) return scalar ?? "Something went wrong.";

  if (value.error != null && value.error !== value) {
    return formatMutationError(value.error);
  }

  const message = readable(value.message) ?? readable(value.error_description);
  const code = readable(value.code);
  const details = readable(value.details);
  const hint = readable(value.hint);
  const head = message ?? details ?? readable(value) ?? "Something went wrong.";
  const suffix = [details && details !== head ? details : null, hint].filter(Boolean).join(" - ");
  return `${code ? `[${code}] ` : ""}${head}${suffix ? ` - ${suffix}` : ""}`;
}
