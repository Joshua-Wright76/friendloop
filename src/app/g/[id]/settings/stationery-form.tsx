"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoopBanner } from "@/components/loop-theme";
import { PaperFields } from "@/components/paper-fields";
import { copy } from "@/lib/copy";
import { readUploadResponse } from "@/lib/upload-response";
import { PHOTO_ACCEPT } from "@/lib/photo-validation";
import { BANNER_TARGET, prepareImage } from "@/components/prepare-image";
import { DEFAULT_PRESET, normalizeHex } from "@/lib/theme";
import { saveStationery, stationeryAction } from "./actions";

type Props = {
  groupId: string;
  preset: string | null;
  accent: string | null;
  headerImageUrl: string | null;
};

type SaveStatus = "idle" | "saving" | "saved" | "adjusted" | "error";
type Choice = { preset: string; accent: string };

export function StationeryForm({ groupId, preset: savedPreset, accent: savedAccent, headerImageUrl }: Props) {
  const initial = { preset: savedPreset ?? DEFAULT_PRESET, accent: normalizeHex(savedAccent ?? "") ?? "" };
  const [preset, setPreset] = useState(initial.preset);
  const [accent, setAccent] = useState(savedAccent ?? "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [, startSaving] = useTransition();
  // What the server has, the newest choice, and whether a save is on its way.
  // A choice made during a save waits its turn and is never dropped.
  const confirmed = useRef<Choice>(initial);
  const latest = useRef<Choice>(initial);
  const failed = useRef<Choice | null>(null);
  const saving = useRef(false);
  const hex = normalizeHex(accent);

  useEffect(() => {
    if (status !== "saved" && status !== "adjusted") return;
    const timer = setTimeout(() => setStatus("idle"), 2800);
    return () => clearTimeout(timer);
  }, [status]);

  function flush() {
    if (saving.current) return;
    saving.current = true;
    setStatus("saving");
    startSaving(async () => {
      try {
        let sent: Choice;
        let result: { ok: boolean; adjusted: boolean };
        do {
          sent = latest.current;
          result = await saveStationery(groupId, sent.preset, sent.accent);
        } while (result.ok && latest.current !== sent);
        if (!result.ok) throw new Error("not saved");
        confirmed.current = sent;
        failed.current = null;
        setStatus(result.adjusted ? "adjusted" : "saved");
      } catch {
        // The tiles go back to the truth, and Try again remembers what was wanted.
        failed.current = latest.current;
        latest.current = confirmed.current;
        setPreset(confirmed.current.preset);
        setAccent(confirmed.current.accent);
        setStatus("error");
      } finally {
        saving.current = false;
      }
    });
  }

  function commit(change: Partial<Choice>) {
    const next = { ...latest.current, ...change };
    if (next.preset === latest.current.preset && next.accent === latest.current.accent) return;
    latest.current = next;
    flush();
  }

  function retry() {
    const wanted = failed.current;
    if (!wanted) return;
    setPreset(wanted.preset);
    setAccent(wanted.accent);
    latest.current = wanted;
    flush();
  }

  return (
    <>
    <section className="card mt-4 p-5" aria-labelledby="stationery-title">
      <h2 id="stationery-title" className="text-ink">{copy.stationery.title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.stationery.intro} {copy.stationery.autoSaveNote}</p>

      {/* Floats above the page, so a tile never moves under the thumb when this speaks. */}
      <p role="status" className={status === "idle" ? "sr-only" : `toast${status === "error" ? " toast--danger" : ""}`}>
        {status === "saving" ? copy.stationery.statusSaving : null}
        {status === "saved" ? copy.stationery.statusSaved : null}
        {status === "adjusted" ? copy.stationery.statusAdjusted : null}
        {status === "error" ? (
          <>
            {copy.stationery.statusError}{" "}
            <button type="button" className="underline underline-offset-4" onClick={retry}>{copy.stationery.statusRetry}</button>
          </>
        ) : null}
      </p>

      <form
        action={stationeryAction}
        className="mt-3"
        onSubmit={(event) => {
          // Enter in the color field. Without script the form still posts on its own.
          event.preventDefault();
          if (accent.trim() === "" || hex) commit({ accent: hex ?? "" });
        }}
      >
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="accent" value={hex ?? ""} />

        <PaperFields
          preset={preset}
          onPreset={(next) => { setPreset(next); commit({ preset: next }); }}
          accent={accent}
          onAccent={(next) => { setAccent(next); if (next === "") commit({ accent: "" }); }}
          onAccentCommit={(value) => {
            const parsed = normalizeHex(value);
            if (value.trim() === "" || parsed) commit({ accent: parsed ?? "" });
          }}
        />
      </form>
    </section>
    <section className="card mt-4 p-5">
      <HeaderPicture groupId={groupId} initial={headerImageUrl} />
    </section>
    </>
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
      setMessage(navigator.onLine === false ? copy.common.offlineUpload : copy.stationery.headerError);
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
    <div>
      <h2 className="text-ink">{copy.stationery.headerLegend}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.stationery.headerHint} {copy.settings.headerSavesItself}</p>
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
