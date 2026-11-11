"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/lib/copy";
import { readUploadResponse } from "@/lib/upload-response";
import { PHOTO_ACCEPT } from "@/lib/photo-validation";
import { AVATAR_TARGET, prepareImage } from "./prepare-image";
import { Avatar } from "./avatar";
import { MemberLook } from "./member-look";

type Status = "idle" | "saving" | "saved" | "removed" | "error";

/**
 * Set or remove your own photo for one loop. `endpoint` is the route that knows
 * who you are (a reply token or a signed-in session); this only sends the file.
 */
export function ProfilePhoto({
  endpoint,
  name,
  photoUrl: initial,
  charm,
  frame,
  signature = null,
  refresh = false,
  compact = false,
  onFrame,
}: {
  endpoint: string;
  name: string;
  photoUrl: string | null;
  charm: string | null;
  frame: string | null;
  /** Their signature in this loop, for the pad beside the charm and frame. */
  signature?: number[][] | null;
  /** Tells the page when the frame changes, for a picture it shows elsewhere. */
  onFrame?: (frame: string | null) => void;
  /** Re-render the surrounding server data after a change (the members list shows the photo too). */
  refresh?: boolean;
  /** Just the actions, for a row that already shows the person's picture. */
  compact?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState(initial);
  const [frameNow, setFrameNow] = useState(frame);
  const [lookOpened, setLookOpened] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  // /dev/screens links straight to the sheet.
  useEffect(() => {
    if (compact && new URLSearchParams(window.location.search).get("look") === "open" && disclosure.current) {
      disclosure.current.open = true;
      disclosure.current.scrollIntoView({ block: "start" });
    }
  }, [compact]);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function send(init: RequestInit, done: Status) {
    setStatus("saving");
    try {
      const response = await fetch(endpoint, init);
      const body = await readUploadResponse<{ photoUrl?: string | null; error?: string }>(response, copy.identity.errors.avatarTooLarge).catch(
        () => ({}) as { photoUrl?: string | null; error?: string },
      );
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error ?? copy.identity.profile.error);
        return;
      }
      // Remove leaves with the photo; Change/Add is the control that stays.
      if (done === "removed") input.current?.focus();
      setPhotoUrl(body.photoUrl ?? null);
      setStatus(done);
      if (refresh) router.refresh();
    } catch {
      setStatus("error");
      setMessage(navigator.onLine === false ? copy.common.offlineUpload : copy.identity.profile.error);
    }
  }

  async function choose(picked: File | undefined) {
    if (input.current) input.current.value = "";
    if (!picked) return;
    // A profile picture is shown tiny, so any camera photo is scaled down to fit.
    setStatus("saving");
    const prepared = await prepareImage(picked, AVATAR_TARGET);
    if (!prepared.ok) {
      setStatus("error");
      setMessage(copy.identity.errors.unreadable);
      return;
    }
    const form = new FormData();
    form.set("photo", prepared.file);
    await send({ method: "POST", body: form }, "saved");
  }

  const look = (
    <MemberLook
      endpoint={endpoint}
      name={name}
      photoUrl={photoUrl}
      charm={charm}
      frame={frame}
      signature={signature}
      refresh={refresh ? () => router.refresh() : undefined}
      onFrame={(next) => {
        setFrameNow(next);
        onFrame?.(next);
      }}
    />
  );

  return (
    <>
    <div className="flex items-center gap-3">
      {compact ? null : <Avatar name={name} photoUrl={photoUrl} frame={frameNow} className="!h-14 !w-14 !text-[20px]" />}
      <div className="min-w-0">
        <div className={compact ? "flex flex-wrap gap-x-5" : "flex flex-wrap gap-2"}>
          {/* The visible label takes the focus ring when its (visually hidden) file input is focused. */}
          <label
            className={`file-pick ${compact ? "link link--quiet cursor-pointer" : "btn btn-quiet h-11 text-[14px]"}`}
            aria-disabled={status === "saving" ? true : undefined}
          >
            {photoUrl ? copy.identity.profile.change : copy.identity.profile.add}
            <input
              ref={input}
              type="file"
              className="sr-only"
              accept={PHOTO_ACCEPT}
              aria-label={copy.identity.profile.inputLabel}
              onClick={(event) => {
                if (status === "saving") event.preventDefault();
              }}
              onChange={(event) => void choose(event.target.files?.[0])}
            />
          </label>
          {photoUrl ? (
            <button
              type="button"
              className={`${compact ? "link link--quiet cursor-pointer" : "btn btn-quiet h-11 text-[14px]"} aria-disabled:cursor-not-allowed aria-disabled:opacity-45`}
              aria-disabled={status === "saving" ? true : undefined}
              onClick={() => {
                if (status !== "saving") void send({ method: "DELETE" }, "removed");
              }}
            >
              {copy.identity.profile.remove}
            </button>
          ) : null}
        </div>
        <p
          aria-live="polite"
          className={`text-[13px] leading-relaxed ${status === "error" ? "text-danger" : "text-ink-muted"} ${compact ? "empty:hidden" : "mt-1"}`}
        >
          {status === "saving"
            ? copy.identity.profile.saving
            : status === "saved"
              ? copy.identity.profile.saved
              : status === "removed"
                ? copy.identity.profile.removed
                : status === "error"
                  ? message
                  : compact ? "" : copy.identity.profile.hint}
        </p>
      </div>
    </div>
    {/* In the members list the row is already busy, so the sheet waits behind a tap. */}
    {compact ? (
      <div className="look-disclosure-wrap">
        <p className="look-disclosure__hint">{copy.identity.look.openHint}</p>
      <details ref={disclosure} id={compact ? "your-look" : undefined} className="look-disclosure" onToggle={(event) => { if (event.currentTarget.open) setLookOpened(true); }}>
        <summary className="link link--quiet cursor-pointer">{copy.identity.look.open}</summary>
        {lookOpened ? look : null}
      </details>
      </div>
    ) : look}
    </>
  );
}
