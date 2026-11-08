"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The album cover, or the provider's mark when there is none or it fails to load (a dead CDN link, a blocked host). */
export function MusicArt({ src, fallback }: { src: string | null; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  // An image can fail before the page is interactive, when onError isn't listening yet.
  useEffect(() => {
    const element = image.current;
    if (element && element.complete && element.naturalWidth === 0) setFailed(true);
  }, []);
  if (!src || failed) {
    return <span aria-hidden="true" className="music-card-art music-card-art-empty">{fallback}</span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} src={src} alt="" className="music-card-art" onError={() => setFailed(true)} />;
}
