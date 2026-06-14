import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
    ];
  },
};

export default nextConfig;
