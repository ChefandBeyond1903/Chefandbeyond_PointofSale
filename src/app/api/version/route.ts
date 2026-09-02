import { NextResponse } from "next/server";

// The current deployment's identity, so the client can tell when a newer build
// is live and reload itself. Never cached.
export function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_BUILD_ID ||
    "dev";
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
