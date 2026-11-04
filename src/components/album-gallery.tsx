"use client";

import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { PhotoLightbox, useLightbox } from "@/components/photo-lightbox";
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

/** The album itself. The grid is plain links and buttons; photos open in the shared lightbox. */
export function AlbumGallery({ groups }: { groups: GalleryGroup[] }) {
  const photos = groups.flatMap((group) => group.items.filter((item) => item.kind === "photo"));
  const lightbox = useLightbox();
  const open = (key: string, trigger: HTMLElement) =>
    lightbox.open(photos.findIndex((photo) => photo.key === key), trigger);

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
                      preload="metadata"
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

      <PhotoLightbox
        photos={photos}
        state={lightbox}
        extra={(_photo, index) => (
          <Link href={photos[index].issueHref} className="text-[14px] font-bold text-ink underline underline-offset-4">
            {copy.album.viewInIssue}
          </Link>
        )}
      />
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
