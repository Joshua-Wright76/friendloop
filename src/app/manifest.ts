import type { MetadataRoute } from "next";
import { copy } from "@/lib/copy";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: copy.common.metadataTitle,
    short_name: copy.common.brand,
    description: copy.common.metadataDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#fff3f5",
    theme_color: "#fff3f5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
