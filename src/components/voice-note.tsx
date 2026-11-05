"use client";

import { useEffect, useRef, useState } from "react";
import { formatAudioDuration } from "@/lib/audio-validation";
import { copy } from "@/lib/copy";

/**
 * A voice note on stationery: one big play button, a track you can drag, and how
 * long it runs. The real <audio> stays underneath, so the browser still does the
 * decoding, the media keys and the lock-screen controls.
 */
export function VoiceNote({
  src,
  durationMs,
  label,
  playLabel = copy.voiceNote.playPlain,
  className = "",
}: {
  src: string;
  durationMs?: number | null;
  /** What this note is: spoken by screen readers, and a title on the element. */
  label: string;
  playLabel?: string;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState((durationMs ?? 0) / 1000);

  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    // Recorded webm often reports Infinity until played through, so the stored length stands in.
    const onMetadata = () => {
      if (Number.isFinite(element.duration) && element.duration > 0) setLength(element.duration);
    };
    const onTime = () => setPosition(element.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => { setPlaying(false); setPosition(0); element.currentTime = 0; };
    element.addEventListener("loadedmetadata", onMetadata);
    element.addEventListener("durationchange", onMetadata);
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("ended", onEnd);
    onMetadata();
    return () => {
      element.removeEventListener("loadedmetadata", onMetadata);
      element.removeEventListener("durationchange", onMetadata);
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("ended", onEnd);
    };
  }, []);

  const shown = Math.max(length, position);
  const percent = shown > 0 ? Math.min(100, (position / shown) * 100) : 0;

  return (
    <div className={`voice-note ${className}`.trim()} title={label}>
      <audio ref={audio} preload="metadata" src={src} aria-label={label} />
      <button
        type="button"
        className="voice-note__play"
        aria-label={playing ? copy.voiceNote.pause : playLabel}
        onClick={() => {
          const element = audio.current;
          if (!element) return;
          if (element.paused) void element.play().catch(() => {});
          else element.pause();
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5">
          {playing
            ? <path d="M6 4.5h2.6v11H6zm5.4 0H14v11h-2.6z" fill="currentColor" />
            : <path d="M6.5 3.9a.8.8 0 0 1 1.2-.7l8.4 6.1a.8.8 0 0 1 0 1.4l-8.4 6.1a.8.8 0 0 1-1.2-.7z" fill="currentColor" />}
        </svg>
      </button>
      <div className="voice-note__body">
        <span className="voice-note__title">{copy.voiceNote.title}</span>
        <input
          type="range"
          className="voice-note__track"
          min={0}
          max={shown || 1}
          step={0.1}
          value={position}
          aria-label={copy.voiceNote.seek}
          aria-valuetext={`${formatAudioDuration(position * 1000)} of ${formatAudioDuration(shown * 1000)}`}
          style={{ "--voice-fill": `${percent}%` } as React.CSSProperties}
          onChange={(event) => {
            const next = Number(event.target.value);
            setPosition(next);
            if (audio.current) audio.current.currentTime = next;
          }}
        />
      </div>
      <span className="voice-note__time numeric">
        {formatAudioDuration(position * 1000)} / {formatAudioDuration(shown * 1000)}
      </span>
    </div>
  );
}
