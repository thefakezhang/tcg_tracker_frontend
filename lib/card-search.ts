// Shared "smart" card-search term handling.
//
// Every curator-facing card search (the Card Index catalogs, the curation
// override picker, the match-review search dialog) accepts more than the
// name/set/number text term:
//   - a card UUID - full, or the 8-hex prefix the UI displays (uid.slice(0, 8))
//   - an exact platform external id (tcgplayer / pricecharting / snkrdunk / ...)
// so a curator can paste whatever identifier they are holding and land on the
// card. These helpers keep the semantics identical across all the surfaces.

const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UID_PREFIX = /^[0-9a-f]{8}$/;

// uidOrParts returns PostgREST or() disjuncts matching a uuid column against
// the term: the full UUID exactly, or the displayed 8-hex prefix as an
// inclusive range (uuid columns don't support ilike, but a fixed-length prefix
// is exactly a range scan). Terms that are neither return no parts.
export function uidOrParts(term: string, uidCol: string): string[] {
  const t = term.toLowerCase();
  if (FULL_UUID.test(t)) return [`${uidCol}.eq.${t}`];
  if (UID_PREFIX.test(t)) {
    return [`and(${uidCol}.gte.${t}-0000-0000-0000-000000000000,${uidCol}.lte.${t}-ffff-ffff-ffff-ffffffffffff)`];
  }
  return [];
}

// Structural shape of the one query external-id resolution needs. Typed here
// rather than imported for the same reason as lib/supabase/select-all.ts: the
// SDK builder generics would couple this helper to the SDK version. The public
// parameter is `unknown` (cast internally) because checking the SDK client's
// enormous builder generics against even this tiny structural type sends tsc
// into TS2589 "excessively deep" territory.
interface ExtIdClient {
  from(table: string): {
    select(cols: string): {
      eq(
        col: string,
        v: string,
      ): { limit(n: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> };
    };
  };
}

// externalIdMatches resolves an EXACT external_reference_id (any platform) to
// the catalog ids carrying it. Exact by design: platform ids are opaque tokens
// the curator pastes whole, and a substring match over the identifier tables
// would be a per-keystroke seq scan. One id can legitimately live on several
// cards (a tcgplayer SKU spans a printing's variants), hence the id LIST.
export async function externalIdMatches(
  supabase: unknown,
  extTable: string,
  idCol: string,
  term: string,
): Promise<number[]> {
  if (!term) return [];
  const client = supabase as ExtIdClient;
  const { data, error } = await client.from(extTable).select(idCol).eq("external_reference_id", term).limit(100);
  if (error) return [];
  const ids = new Set<number>();
  for (const r of (data ?? []) as Record<string, number>[]) ids.add(r[idCol]);
  return [...ids];
}

// searchOrFilter composes the final or() disjunct string: the caller's text
// ilike parts, the uuid parts, and - when the term matched external ids - an
// id-list gate. Callers pass the parts to .or() unchanged.
export function searchOrFilter(
  textParts: string[],
  term: string,
  uidCol: string,
  idCol: string,
  extIds: number[],
): string {
  const parts = [...textParts, ...uidOrParts(term, uidCol)];
  if (extIds.length) parts.push(`${idCol}.in.(${extIds.join(",")})`);
  return parts.join(",");
}
