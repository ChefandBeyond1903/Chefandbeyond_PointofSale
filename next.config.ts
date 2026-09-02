import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the client-side route cache short so a change shows up on the next
  // navigation, not minutes later. (dynamic: 0 is already the default.)
  experimental: {
    staleTimes: { dynamic: 0, static: 30 },
  },
  // API responses are user- and time-specific; don't let any layer cache them.
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
