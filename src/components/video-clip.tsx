"use client";

import { useState } from "react";
import { formatAudioDuration } from "@/lib/audio-validation";

/**
 * A video clip on stationery. The browser's own player does the work (full
 * screen, picture in picture, the lock screen); until it is played, the still
 * stands in and nothing of the clip downloads. Its length sits on the still, so
 * a reader knows what they are starting.
 */
export function VideoClip({
  src,
  posterUrl,
  durationMs,
  label,
  className = "",
}: {
  src: string;
  posterUrl: string | null;
  durationMs?: number | null;
  /** What this clip is: spoken by screen readers, and a title on the element. */
  label: string;
  className?: string;
}) {
  const [started, setStarted] = useState(false);
  return (
    <div className={`video-clip ${className}`} data-started={started ? "" : undefined}>
      <video
        src={src}
        poster={posterUrl ?? undefined}
        controls
        playsInline
        preload="none"
        aria-label={label}
        title={label}
        onPlay={() => setStarted(true)}
      />
      {durationMs ? (
        <span className="video-clip__length numeric" aria-hidden="true">
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5"><path d="M3 1.8v8.4L10 6z" fill="currentColor" /></svg>
          {formatAudioDuration(durationMs)}
        </span>
      ) : null}
    </div>
  );
}
