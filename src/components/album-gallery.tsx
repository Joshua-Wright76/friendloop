"use client";

import Link from "next/link";
import { Avatar, NameCharm } from "@/components/avatar";
import { PhotoLightbox, useLightbox } from "@/components/photo-lightbox";
import { VoiceNote } from "@/components/voice-note";
import { VideoClip } from "@/components/video-clip";
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
                  // The whole card is the button: photo, who and caption. The question and the way back to the round are in the viewer.
                  <button
                    type="button"
                    className="album-card card"
                    aria-label={text(copy.album.openPhoto, { author: item.author, about: aboutOf(item) })}
                    onClick={(event) => open(item.key, event.currentTarget)}
                  >
                    <span className="album-tile">
                      {/* eslint-disable-next-line @next/next/no-img-element -- Uploaded photos live on local URLs in development and Blob in production. */}
                      <img src={item.url} alt="" loading="lazy" />
                    </span>
                    <span className="album-card__who">
                      <Avatar name={item.author} photoUrl={item.authorPhotoUrl} frame={item.authorFrame} className="album-avatar" />
                      <span className="min-w-0 wrap-any">{item.author}</span>
                      <NameCharm charm={item.authorCharm} />
                    </span>
                    {item.caption || item.body ? (
                      <span className="album-card__caption">{item.caption || item.body}</span>
                    ) : null}
                  </button>
                ) : item.kind === "video" ? (
                  <figure className="card m-0 p-3">
                    <VideoClip
                      className="album-video"
                      src={item.url}
                      posterUrl={item.posterUrl ?? null}
                      durationMs={item.durationMs}
                      label={text(copy.album.videoFrom, {
                        author: item.author,
                        duration: formatAudioDuration(item.durationMs ?? 0),
                      })}
                    />
                    <Credit item={item} link />
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
                    <Credit item={item} link />
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

/** Who, and the caption if there is one; videos and voice notes cannot open the viewer, so the way back to the round sits here, small. */
function Credit({ item, link = false }: { item: AlbumItem; link?: boolean }) {
  return (
    <figcaption className="mt-2 flex flex-col gap-0.5">
      <span className="album-card__who">
        <Avatar name={item.author} photoUrl={item.authorPhotoUrl} frame={item.authorFrame} className="album-avatar" />
        <span className="min-w-0 wrap-any">{item.author}</span>
        <NameCharm charm={item.authorCharm} />
      </span>
      {item.caption || item.body ? <span className="album-card__caption">{item.caption || item.body}</span> : null}
      {link ? (
        <Link href={item.issueHref} onClick={rememberAlbum} className="link link--quiet text-[13px]! font-semibold!" aria-label={text(copy.album.viewInIssueNamed, { what: [item.author, item.caption || item.body || item.context].filter(Boolean).join(", ") })}>
          {copy.album.viewInIssue}
        </Link>
      ) : null}
    </figcaption>
  );
}
