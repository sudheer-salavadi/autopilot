import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  async rewrites() {
    // In production the browser can't reach the backend directly (it's on an
    // internal Docker network with no public SSL).  All /api/* requests from
    // the browser are transparently forwarded by Next.js to the backend.
    const internalApi = process.env.INTERNAL_API_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${internalApi}/api/:path*`,
      },
      // PostHog reverse proxy — routes analytics requests through Next.js to
      // reduce interception by tracking blockers.
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
};

export default nextConfig;
