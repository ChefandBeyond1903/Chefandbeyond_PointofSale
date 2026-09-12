// Shared free-text search helpers. Used by the product/inventory API routes
// (to build a Prisma filter) and by client-side list filtering, so every
// search box behaves the same.
//
// Matching is order-independent: a query is split into terms and every term
// must appear somewhere in the searched text, in any order. Terms are also
// split on digit/letter boundaries so "40lbs" matches text written "40 lbs".
// Comparison then ignores spaces/punctuation ("chefbase" matches "Chef Base")
// and falls back to a simple singular form for a plural term ("lbs" matches
// "lb").

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

/** Lowercased with everything but letters/digits stripped, so "Chef Base"
 *  and a typed "chefbase" compare equal, punctuation and all. */
function collapse(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when every term in `q` is a substring of at least one of `fields` —
 *  ignoring spaces/punctuation on both sides (a typed "chefbase" matches
 *  "Chef Base"), and falling back to a simple singular form for a plural
 *  term ("lbs." matches "lb", "40 lbs" matches "40 lb"). */
export function matchesSearch(
  q: string,
  fields: Array<string | null | undefined>,
): boolean {
  const hay = fields.map((f) => collapse(f ?? ""));
  return searchTerms(q).every((raw) => {
    const term = collapse(raw);
    if (!term) return true;
    if (hay.some((h) => h.includes(term))) return true;
    // "lbs" -> "lb", "doors" -> "door" — only for a plausible plural, not
    // every short word ending in s.
    if (term.length >= 3 && term.endsWith("s")) {
      const singular = term.slice(0, -1);
      if (hay.some((h) => h.includes(singular))) return true;
    }
    return false;
  });
}
