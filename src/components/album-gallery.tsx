"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/avatar";
import { formatAudioDuration } from "@/lib/audio-validation";
import { copy, text } from "@/lib/copy";
import type { AlbumItem } from "@/lib/album";

export type GalleryGroup = {
  issueId: string;
  title: string;
  dateLabel: string;
  items: AlbumItem[];
};

/** What someone would say a photo is of: the caption, else their words, else the question it answered. */
function aboutOf(item: AlbumItem): string {
  return item.caption || item.body || item.context;
}

/**
 * The album itself. The grid is plain links and buttons; the viewer is a native
 * modal `<dialog>`, which brings the focus trap, Escape and an inert page for
 * free. Arrow keys and visible previous/next buttons move between photos.
 */
export function AlbumGallery({ groups }: { groups: GalleryGroup[] }) {
  const photos = groups.flatMap((group) => group.items.filter((item) => item.kind === "photo"));
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [current, setCurrent] = useState<number | null>(null);

  const open = (key: string, trigger: HTMLElement) => {
    opener.current = trigger;
    setCurrent(photos.findIndex((photo) => photo.key === key));
  };
  const close = () => dialog.current?.close();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (current !== null && !element.open) element.showModal();
  }, [current]);

  const photo = current === null ? null : (photos[current] ?? null);

  const step = (by: number) =>
    setCurrent((index) => (index === null ? index : Math.min(Math.max(index + by, 0), photos.length - 1)));

  return (
    <>
      {groups.map((group) => (
        <section key={group.issueId} aria-labelledby={`album-round-${group.issueId}`} className="mt-8">
          <div className="stitched flex flex-wrap items-baseline justify-between gap-x-3 border-b pb-2">
            <h2 id={`album-round-${group.issueId}`} className="text-[19px] font-bold text-ink">{group.title}</h2>
            <p className="m-0 text-[12.5px] text-ink-muted">{group.dateLabel}</p>
          </div>
          <ul className="album-grid mt-3">
            {group.items.map((item) => (
              <li key={item.key} className={item.kind === "voice" ? "album-voice" : undefined}>
                {item.kind === "photo" ? (
                  <figure className="m-0">
                    <button
                      type="button"
                      className="album-tile"
                      aria-label={text(copy.album.openPhoto, { author: item.author, about: aboutOf(item) })}
                      onClick={(event) => open(item.key, event.currentTarget)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- Uploaded photos live on local URLs in development and Blob in production. */}
                      <img src={item.url} alt="" loading="lazy" />
                    </button>
                    <Credit item={item} />
                  </figure>
                ) : (
                  <figure className="card m-0 p-3">
                    <audio
                      controls
                      preload="none"
                      src={item.url}
                      aria-label={text(copy.album.voiceFrom, {
                        author: item.author,
                        duration: formatAudioDuration(item.durationMs ?? 0),
                      })}
                      className="w-full"
                    />
                    <Credit item={item} />
                  </figure>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <dialog
        ref={dialog}
        className="album-viewer"
        aria-label={copy.album.viewer.label}
        onClose={() => {
          setCurrent(null);
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
              <p className="m-0 mt-1 text-[13px] text-ink-muted">{photo.author} · {photo.context}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {/* aria-disabled, not disabled, at the ends: a focused disabled button drops focus to the page behind. */}
                <button
                  type="button"
                  className="btn btn-quiet aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                  aria-disabled={(current ?? 0) === 0 ? true : undefined}
                  onClick={() => step(-1)}
                >
                  ← <span className="sr-only">{copy.album.viewer.previous}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-quiet aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                  aria-disabled={(current ?? 0) >= photos.length - 1 ? true : undefined}
                  onClick={() => step(1)}
                >
                  <span className="sr-only">{copy.album.viewer.next}</span> →
                </button>
              </div>
              <Link href={photo.issueHref} className="text-[14px] font-bold text-ink underline underline-offset-4">
                {copy.album.viewInIssue}
              </Link>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}

function Credit({ item }: { item: AlbumItem }) {
  return (
    <figcaption className="mt-1.5">
      <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink-soft">
        <Avatar name={item.author} photoUrl={item.authorPhotoUrl} className="album-avatar" />
        {item.author}
      </span>
      {item.caption || item.body ? (
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-ink">{item.caption || item.body}</span>
      ) : null}
      <span className="line-clamp-1 block text-[12px] leading-snug text-ink-muted">{item.context}</span>
      <Link href={item.issueHref} className="inline-flex min-h-11 items-center text-[13px] font-bold text-ink-soft underline underline-offset-4">
        {copy.album.viewInIssue}
      </Link>
    </figcaption>
  );
}
