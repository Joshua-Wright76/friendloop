"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoopBanner } from "@/components/loop-theme";
import { PaperFields } from "@/components/paper-fields";
import { copy } from "@/lib/copy";
import { readUploadResponse } from "@/lib/upload-response";
import { PHOTO_ACCEPT } from "@/lib/photo-validation";
import { BANNER_TARGET, prepareImage } from "@/components/prepare-image";
import { DEFAULT_PRESET, normalizeHex } from "@/lib/theme";
import { stationeryAction } from "./actions";
import { SubmitButton } from "@/components/submit-button";

type Props = {
  groupId: string;
  preset: string | null;
  accent: string | null;
  headerImageUrl: string | null;
};

export function StationeryForm({ groupId, preset: savedPreset, accent: savedAccent, headerImageUrl }: Props) {
  const [preset, setPreset] = useState(savedPreset ?? DEFAULT_PRESET);
  const [accent, setAccent] = useState(savedAccent ?? "");
  const hex = normalizeHex(accent);
  const accentInvalid = accent.trim() !== "" && !hex;

  return (
    <section className="card mt-3 p-5" aria-labelledby="stationery-title">
      <h2 id="stationery-title" className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.stationery.title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.stationery.intro}</p>

      <form action={stationeryAction} className="mt-4">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="accent" value={hex ?? ""} />

        <PaperFields preset={preset} onPreset={setPreset} accent={accent} onAccent={setAccent} />

        <SubmitButton className="btn btn-primary mt-5" disabled={accentInvalid}>
          {copy.stationery.save}
        </SubmitButton>
      </form>

      <HeaderPicture groupId={groupId} initial={headerImageUrl} />
    </section>
  );
}

type PictureStatus = "idle" | "saving" | "saved" | "removed" | "error";

function HeaderPicture({ groupId, initial }: { groupId: string; initial: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const change = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState(initial);
  const [status, setStatus] = useState<PictureStatus>("idle");
  const [message, setMessage] = useState("");
  const endpoint = `/api/loop/${groupId}/header-image`;

  async function send(init: RequestInit, done: PictureStatus) {
    setStatus("saving");
    try {
      const response = await fetch(endpoint, init);
      const body = await readUploadResponse<{ url?: string | null; error?: string }>(response, copy.identity.errors.bannerTooLarge).catch(
        () => ({}) as { url?: string | null; error?: string },
      );
      if (!response.ok) {
        setStatus("error");
        setMessage(body.error ?? copy.stationery.headerError);
        return;
      }
      // Remove leaves with the picture; Replace/Upload is the control that stays.
      if (done === "removed") change.current?.focus();
      setUrl(body.url ?? null);
      setStatus(done);
      router.refresh();
    } catch {
      setStatus("error");
      setMessage(copy.stationery.headerError);
    }
  }

  async function choose(picked: File | undefined) {
    if (input.current) input.current.value = "";
    if (!picked) return;
    setStatus("saving");
    const prepared = await prepareImage(picked, BANNER_TARGET);
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
    <div className="mt-6 border-t border-dashed border-line pt-4">
      <p className="text-[13px] font-medium text-ink-soft">{copy.stationery.headerLegend}</p>
      <p className="mt-1 text-[13px] leading-snug text-ink-muted">{copy.stationery.headerHint}</p>
      <LoopBanner url={url} className="mt-3" />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          ref={change}
          type="button"
          className="btn btn-quiet h-11 min-h-11 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          aria-disabled={status === "saving" ? true : undefined}
          onClick={() => {
            if (status !== "saving") input.current?.click();
          }}
        >
          {url ? copy.stationery.headerReplace : copy.stationery.headerUpload}
        </button>
        {url ? (
          <button
            type="button"
            className="btn btn-quiet h-11 min-h-11 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            aria-disabled={status === "saving" ? true : undefined}
            onClick={() => {
              if (status !== "saving") void send({ method: "DELETE" }, "removed");
            }}
          >
            {copy.stationery.headerRemove}
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept={PHOTO_ACCEPT}
        aria-label={copy.stationery.headerInput}
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      <p aria-live="polite" className={`mt-1.5 text-[12px] ${status === "error" ? "text-danger" : "text-ink-muted"}`}>
        {status === "saving"
          ? copy.stationery.headerSaving
          : status === "saved"
            ? copy.stationery.headerSaved
            : status === "removed"
              ? copy.stationery.headerRemoved
              : status === "error"
                ? message
                : ""}
      </p>
    </div>
  );
}
