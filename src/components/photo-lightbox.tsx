"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { copy, text } from "@/lib/copy";

export type LightboxPhoto = {
  url: string;
  /** Who took or sent it: the alt text and the credit line. */
  author: string;
  caption?: string | null;
  body?: string | null;
  /** The question or section it belongs to, shown after the author. */
  context?: string | null;
};

/**
 * A Vercel Blob URL downloads (instead of opening) when asked with `?download=1`;
 * the browser ignores the `download` attribute on another origin. A same-origin
 * upload (local development) honours the attribute as it is.
 */
export function downloadHref(url: string): string {
  try {
    const parsed = new URL(url, "http://local.invalid");
    if (!/\.blob\.vercel-storage\.com$/i.test(parsed.hostname)) return url;
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

function downloadName(photo: LightboxPhoto, position: number): string {
  const extension = photo.url.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] ?? "jpg";
  const who = photo.author.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "photo";
  return `friendloop-${who}-${position}.${extension}`;
}

/** Open state for one set of photos, plus the element to hand focus back to on close. */
export function useLightbox() {
  const opener = useRef<HTMLElement | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const open = (at: number, trigger: HTMLElement) => {
    opener.current = trigger;
    setIndex(at);
  };
  return { index, setIndex, open, opener };
}

/**
 * The full-size viewer: a native modal `<dialog>`, which brings the focus trap,
 * Escape and an inert page for free. Arrow keys and visible previous/next
 * buttons move between photos, and every photo can be downloaded.
 */
export function PhotoLightbox({
  photos,
  state,
  extra,
}: {
  photos: LightboxPhoto[];
  state: ReturnType<typeof useLightbox>;
  /** Anything else to offer beside the download, e.g. a link to where the photo was posted. */
  extra?: (photo: LightboxPhoto, index: number) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { index: current, setIndex, opener } = state;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (current !== null && !element.open) element.showModal();
  }, [current]);

  const photo = current === null ? null : (photos[current] ?? null);
  const close = () => dialog.current?.close();
  const step = (by: number) =>
    setIndex((index) => (index === null ? index : Math.min(Math.max(index + by, 0), photos.length - 1)));

  return (
    <dialog
      ref={dialog}
      className="album-viewer"
      aria-label={copy.album.viewer.label}
      onClose={() => {
        setIndex(null);
        opener.current?.focus();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") step(1);
        if (event.key === "ArrowLeft") step(-1);
      }}
    >
      {photo ? (
        <div className="album-viewer-body">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 text-[13px] font-bold text-ink-soft numeric" aria-live="polite">
              {text(copy.album.viewer.position, { current: (current ?? 0) + 1, total: photos.length })}
            </p>
            <button type="button" className="btn btn-quiet" onClick={close}>{copy.album.viewer.close}</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- Uploaded photos live on local URLs in development and Blob in production. */}
          <img src={photo.url} alt={text(copy.album.photoAlt, { author: photo.author })} className="album-viewer-photo" />
          <div className="min-w-0">
            {photo.caption ? <p className="m-0 text-[16px] font-bold leading-snug text-ink">{photo.caption}</p> : null}
            {photo.body ? <p className="m-0 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{photo.body}</p> : null}
            <p className="m-0 mt-1 text-[13px] text-ink-muted">
              {photo.context ? `${photo.author} · ${photo.context}` : photo.author}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button type="button" className="btn btn-quiet" disabled={(current ?? 0) === 0} onClick={() => step(-1)}>
                ← <span className="sr-only">{copy.album.viewer.previous}</span>
              </button>
              <button type="button" className="btn btn-quiet" disabled={(current ?? 0) >= photos.length - 1} onClick={() => step(1)}>
                <span className="sr-only">{copy.album.viewer.next}</span> →
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {extra ? extra(photo, current ?? 0) : null}
              <a
                href={downloadHref(photo.url)}
                download={downloadName(photo, (current ?? 0) + 1)}
                className="btn btn-quiet"
              >
                {copy.album.viewer.download}
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
