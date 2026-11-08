"use client";

import Link from "next/link";
import { Avatar, NameCharm } from "@/components/avatar";
import { PhotoLightbox, useLightbox } from "@/components/photo-lightbox";
import { VoiceNote } from "@/components/voice-note";
import { formatAudioDuration } from "@/lib/audio-validation";
import { copy, text } from "@/lib/copy";
import type { AlbumItem } from "@/lib/album";

/** Notes the trip, so the issue can offer the way back to this album. The issue's address stays the same. */
function rememberAlbum() {
  try {
    sessionStorage.setItem("fl-from-album", JSON.stringify({ href: window.location.pathname + window.location.search, at: Date.now() }));
  } catch {
    // Storage can be off; the issue then simply has no way back.
  }
}

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
          <div className="album-round-head">
            <h2 id={`album-round-${group.issueId}`} className="text-ink">{group.title}</h2>
            <p className="m-0 text-[13px] text-ink-soft">{group.dateLabel}</p>
          </div>
          <ul className="album-grid mt-3">
            {group.items.map((item) => (
              <li key={item.key} className={item.kind === "voice" ? "album-voice" : undefined}>
                {item.kind === "photo" ? (
                  <figure className="card m-0 p-3">
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
                    <VoiceNote
                      src={item.url}
                      durationMs={item.durationMs}
                      label={text(copy.album.voiceFrom, {
                        author: item.author,
                        duration: formatAudioDuration(item.durationMs ?? 0),
                      })}
                      playLabel={text(copy.voiceNote.play, { author: item.author })}
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
          <Link href={photos[index].issueHref} onClick={rememberAlbum} className="inline-flex min-h-11 items-center text-[14px] font-bold text-ink underline underline-offset-4">
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
        <Avatar name={item.author} photoUrl={item.authorPhotoUrl} frame={item.authorFrame} className="album-avatar" />
        {item.author}
        <NameCharm charm={item.authorCharm} />
      </span>
      {item.caption || item.body ? (
        <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-ink">{item.caption || item.body}</span>
      ) : null}
      <span className="line-clamp-1 block text-[13px] leading-snug text-ink-muted">{item.context}</span>
      <Link href={item.issueHref} onClick={rememberAlbum} className="link link--quiet text-[13px]!" aria-label={text(copy.album.viewInIssueNamed, { what: [item.author, item.caption || item.body || item.context].filter(Boolean).join(", ") })}>
        {copy.album.viewInIssue}
      </Link>
    </figcaption>
  );
}
