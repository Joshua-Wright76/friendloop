import type { NextConfig } from "next";

// A local tunnel changes hostname every time it starts, so it is configured per
// machine instead of hardcoded: ALLOWED_DEV_ORIGINS="abc-123.trycloudflare.com".
const devOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  // Preview deployments hold throwaway data — keep them out of search results.
  async headers() {
    if (process.env.VERCEL_ENV !== "preview") return [];
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
  /* config options here */
  // The create-a-loop wizard sends the header picture (up to 4 MB) with the form.
  // Vercel caps a request at 4.5 MB, so there is no point allowing more.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
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
