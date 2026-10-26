"use client";

/* eslint-disable @next/next/no-img-element -- The exporter needs the original, embeddable image URLs. */

import { useRef, useState } from "react";
import { copy, text } from "@/lib/copy";
import { postcardFilename, postcardPicks, type IssueTheme } from "@/lib/issue-experience";
import type { IssueMood, IssuePick } from "@/lib/issue-view";
import type { IssuePhoto } from "./photo-wall";

export function PostcardDownload({
  groupName,
  roundNumber,
  theme,
  moods,
  picks,
  photos,
}: {
  groupName: string;
  roundNumber: number;
  theme: IssueTheme;
  moods: IssueMood[];
  picks: IssuePick[];
  photos: IssuePhoto[];
}) {
  const source = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const curated = postcardPicks(picks);
  const collage = photos.slice(0, 6);
  const pack = copy.themes.packs.find((option) => option.value === theme);

  async function download() {
    if (pending) return;
    setPending(true);
    setShowSource(true);
    setMessage("");
    setFailed(false);

    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const node = source.current;
      if (!node) throw new Error("postcard-source");
      const images = Array.from(node.querySelectorAll("img"));
      await Promise.all(images.map(async (image) => {
        if (!image.complete) {
          await new Promise<void>((resolve, reject) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => reject(new Error("image-load")), { once: true });
          });
        }
        await image.decode();
      }));

      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: getComputedStyle(node).backgroundColor,
      });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = postcardFilename(groupName, roundNumber);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setMessage(copy.issue.postcardReady);
    } catch {
      setFailed(true);
      setMessage(copy.issue.postcardError);
    } finally {
      setPending(false);
      setShowSource(false);
    }
  }

  return (
    <div className="postcard-download">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-quiet" onClick={() => void download()} disabled={pending}>
          {pending ? copy.issue.downloadingPostcard : copy.issue.downloadPostcard}
        </button>
        <p
          role={failed ? "alert" : "status"}
          aria-live={failed ? "assertive" : "polite"}
          className={`text-[13px] ${failed ? "text-danger" : "text-ink-muted"}`}
        >
          {message}
        </p>
      </div>

      {showSource ? <div className="postcard-source" aria-hidden="true">
        <article ref={source} className="postcard" data-theme-pack={theme}>
          <header className="postcard-header">
            <span className="postcard-mark">{pack?.emoji ?? copy.common.cherry}</span>
            <p className="postcard-brand">{copy.common.brand}</p>
            <h2>{groupName}</h2>
            <p className="postcard-round">{text(copy.issue.round, { number: roundNumber })}</p>
          </header>

          <section className="postcard-section">
            <h3>{copy.issue.postcardMood}</h3>
            {moods.length > 0 ? (
              <ul className="postcard-moods">
                {moods.map((mood) => <li key={mood.id}>{mood.emoji}<span>{mood.author}</span></li>)}
              </ul>
            ) : <p className="postcard-empty">{copy.issue.postcardEmptyMood}</p>}
          </section>

          <section className="postcard-section">
            <h3>{copy.issue.postcardPicks}</h3>
            {curated.length > 0 ? (
              <div className="postcard-picks">
                {curated.map((pick) => (
                  <blockquote key={pick.replyId}>
                    <p>{pick.body || pick.question}</p>
                    <footer>
                      <strong>{pick.author}</strong>
                      <span>{pick.editorPick ? copy.issue.editorPick : copy.issue.mostLoved}</span>
                    </footer>
                  </blockquote>
                ))}
              </div>
            ) : <p className="postcard-empty">{copy.issue.postcardEmptyPicks}</p>}
          </section>

          <section className="postcard-section">
            <h3>{copy.issue.postcardPhotos}</h3>
            {collage.length > 0 ? (
              <ul className={`postcard-collage postcard-collage-${collage.length}`}>
                {collage.map((photo) => (
                  <li key={photo.replyId}>
                    <img src={photo.url} alt="" crossOrigin="anonymous" />
                    <span>{photo.author}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="postcard-empty">{copy.issue.postcardEmptyPhotos}</p>}
          </section>
        </article>
      </div> : null}
    </div>
  );
}
