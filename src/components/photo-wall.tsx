"use client";

/* eslint-disable @next/next/no-img-element -- Reply photos can be local uploads or public Blob URLs. */

import { useEffect, useRef, useState } from "react";
import { copy, text } from "@/lib/copy";

export type IssuePhoto = {
  replyId: string;
  author: string;
  question: string;
  body: string;
  url: string;
};

export function PhotoWall({ photos }: { photos: IssuePhoto[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const photo = selected === null ? null : photos[selected];

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (selected !== null && !element.open) element.showModal();
    if (selected === null && element.open) element.close();
  }, [selected]);

  function close() {
    dialog.current?.close();
    setSelected(null);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  function move(direction: number) {
    setSelected((current) => current === null
      ? null
      : (current + direction + photos.length) % photos.length);
  }

  if (photos.length === 0) return null;

  return (
    <section className="card photo-wall p-5" aria-labelledby="photo-wall-title">
      <h2 id="photo-wall-title" className="text-ink">{copy.issue.photoWall}</h2>
      <p className="mt-1 text-[13px] text-ink-soft">
        {photos.length === 1
          ? copy.issue.photoWallPhoto
          : text(copy.issue.photoWallPhotos, { count: photos.length })}
      </p>
      <ul className="photo-wall-grid mt-4" aria-label={copy.issue.photoWall}>
        {photos.map((item, index) => (
          <li key={item.replyId} className="photo-wall-item">
            <button
              type="button"
              className="photo-wall-button"
              aria-haspopup="dialog"
              aria-label={text(copy.issue.openPhoto, {
                number: index + 1,
                count: photos.length,
                author: item.author,
              })}
              onClick={(event) => {
                trigger.current = event.currentTarget;
                setSelected(index);
              }}
            >
              <img src={item.url} alt="" loading="lazy" className="photo-wall-image" />
            </button>
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        className="photo-lightbox"
        aria-modal="true"
        aria-labelledby="photo-lightbox-title"
        aria-describedby="photo-lightbox-caption"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          }
        }}
      >
        {photo ? (
          <div className="photo-lightbox-panel">
            <div className="photo-lightbox-header">
              <div>
                <h2 id="photo-lightbox-title" className="text-ink">
                  {text(copy.issue.photoDialogTitle, { author: photo.author })}
                </h2>
                <p aria-live="polite" className="mt-1 text-[13px] text-ink-soft numeric">
                  {text(copy.issue.photoPosition, { current: (selected ?? 0) + 1, total: photos.length })}
                </p>
              </div>
              <button type="button" className="btn btn-quiet min-h-11 px-4" onClick={close}>
                {copy.issue.closePhoto}
              </button>
            </div>
            <img
              key={photo.replyId}
              src={photo.url}
              alt={photo.body || text(copy.issue.photoAlt, { author: photo.author })}
              className="photo-lightbox-image"
            />
            <p id="photo-lightbox-caption" className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-soft">
              {photo.body || photo.question}
            </p>
            <div className="mt-4 flex justify-between gap-3">
              <button type="button" className="btn btn-quiet" onClick={() => move(-1)} disabled={photos.length < 2}>
                {copy.issue.previousPhoto}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => move(1)} disabled={photos.length < 2}>
                {copy.issue.nextPhoto}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
