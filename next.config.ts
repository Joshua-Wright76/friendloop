import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers.ts";

// A local tunnel changes hostname every time it starts, so it is configured per
// machine instead of hardcoded: ALLOWED_DEV_ORIGINS="abc-123.trycloudflare.com".
const devOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  // CSP, framing, referrer, and permissions for every route; see the module for
  // why the CSP is static rather than a per-request nonce.
  async headers() {
    return securityHeaders({ nodeEnv: process.env.NODE_ENV, vercelEnv: process.env.VERCEL_ENV });
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
