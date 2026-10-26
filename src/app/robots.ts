import type { MetadataRoute } from "next";

/**
 * The public site is indexable. Everything that is somebody's loop, issue, reply
 * link, or account is not — and a token URL must never be crawled.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/g/", "/r/", "/s/", "/i/", "/you", "/signin/confirm", "/dev/"],
      },
    ],
  };
}
