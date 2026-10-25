import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow React hydration and HMR through the temporary local tunnel.
  allowedDevOrigins: ["drawings-stopping-blvd-ran.trycloudflare.com"],
  // Preview deployments hold throwaway data — keep them out of search results.
  async headers() {
    if (process.env.VERCEL_ENV !== "preview") return [];
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
