#!/usr/bin/env bash
# Push the CB-POS Supabase credentials from ~/.secrets/cbpos.env into the
# linked Vercel project (production). Safe to re-run: removes existing values first.
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.secrets/cbpos.env

add() {
  local name="$1" value="$2"
  vercel env rm "$name" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | vercel env add "$name" production
}

add DATABASE_URL "$CBPOS_DATABASE_URL"
add DIRECT_URL "$CBPOS_DIRECT_URL"
add NEXT_PUBLIC_SUPABASE_URL "$CBPOS_SUPABASE_URL"
add NEXT_PUBLIC_SUPABASE_ANON_KEY "$CBPOS_SUPABASE_PUBLISHABLE_KEY"
add SUPABASE_SERVICE_ROLE_KEY "$CBPOS_SUPABASE_SECRET_KEY"

echo "All 5 env vars set on project cb-pos (production)."
