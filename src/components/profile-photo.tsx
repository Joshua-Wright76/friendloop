"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { copy } from "@/lib/copy";
import { readUploadResponse } from "@/lib/upload-response";
import { PHOTO_ACCEPT } from "@/lib/photo-validation";
import { AVATAR_TARGET, prepareImage } from "./prepare-image";
import { Avatar } from "./avatar";

type Status = "idle" | "saving" | "saved" | "removed" | "error";

/**
 * Set or remove your own photo for one loop. `endpoint` is the route that knows
 * who you are (a reply token or a signed-in session); this only sends the file.
 */
export function ProfilePhoto({
  endpoint,
  name,
  photoUrl: initial,
  refresh = false,
}: {
  endpoint: string;
  name: string;
  photoUrl: string | null;
  /** Re-render the surrounding server data after a change (the members list shows the photo too). */
  refresh?: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const change = useRef<HTMLButtonElement>(null);
  const [photoUrl, setPhotoUrl] = useState(initial);
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
      if (done === "removed") change.current?.focus();
      setPhotoUrl(body.photoUrl ?? null);
      setStatus(done);
      if (refresh) router.refresh();
    } catch {
      setStatus("error");
      setMessage(copy.identity.profile.error);
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

  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} photoUrl={photoUrl} className="!h-14 !w-14 !text-[20px]" />
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <button
            ref={change}
            type="button"
            className="btn btn-quiet h-10 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            aria-disabled={status === "saving" ? true : undefined}
            onClick={() => {
              if (status !== "saving") input.current?.click();
            }}
          >
            {photoUrl ? copy.identity.profile.change : copy.identity.profile.add}
          </button>
          {photoUrl ? (
            <button
              type="button"
              className="btn btn-quiet h-10 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
              aria-disabled={status === "saving" ? true : undefined}
              onClick={() => {
                if (status !== "saving") void send({ method: "DELETE" }, "removed");
              }}
            >
              {copy.identity.profile.remove}
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          hidden
          accept={PHOTO_ACCEPT}
          aria-label={copy.identity.profile.inputLabel}
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <p
          aria-live="polite"
          className={`mt-1 text-[12px] leading-relaxed ${status === "error" ? "text-danger" : "text-ink-muted"}`}
        >
          {status === "saving"
            ? copy.identity.profile.saving
            : status === "saved"
              ? copy.identity.profile.saved
              : status === "removed"
                ? copy.identity.profile.removed
                : status === "error"
                  ? message
                  : copy.identity.profile.hint}
        </p>
      </div>
    </div>
  );
}
