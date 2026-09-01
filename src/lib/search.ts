// Shared free-text search helpers. Used by the product/inventory API routes
// (to build a Prisma filter) and by client-side list filtering, so every
// search box behaves the same.
//
// Matching is order-independent: a query is split into terms and every term
// must appear somewhere in the searched text, in any order. Terms are also
// split on digit/letter boundaries so "40lbs" matches text written "40 lbs".

/** Lowercased, de-duplicated search terms for a raw query string. */
export function searchTerms(q: string): string[] {
  return [
    ...new Set(
      q
        .toLowerCase()
        .replace(/(\d)([a-z])/g, "$1 $2")
        .replace(/([a-z])(\d)/g, "$1 $2")
        .split(/\s+/)
        .filter(Boolean),
    ),
  ];
}

/** True when every term in `q` is a substring of at least one of `fields`. */
export function matchesSearch(
  q: string,
  fields: Array<string | null | undefined>,
): boolean {
  const hay = fields.map((f) => (f ?? "").toLowerCase());
  return searchTerms(q).every((term) => hay.some((h) => h.includes(term)));
}
