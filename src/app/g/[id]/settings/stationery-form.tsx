"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SaveChip, type SaveState } from "@/components/save-chip";
import { LoopBanner } from "@/components/loop-theme";
import { PaperFields, type StationeryLooks } from "@/components/paper-fields";
import { draftOf, type MarksDraft } from "@/components/mark-pickers";
import type { LoopMarks } from "@/lib/looks";
import { copy } from "@/lib/copy";
import { readUploadResponse } from "@/lib/upload-response";
import { PHOTO_ACCEPT } from "@/lib/photo-validation";
import { BANNER_TARGET, prepareImage } from "@/components/prepare-image";
import { DEFAULT_BACKGROUND, DEFAULT_PAPER_PACK, DEFAULT_TAPE_PACK } from "@/lib/stationery";
import { DEFAULT_MASCOT } from "@/lib/stickers";
import { DEFAULT_PRESET, normalizeHex } from "@/lib/theme";
import { saveStationery, stationeryAction } from "./actions";

type Props = {
  groupId: string;
  loopName: string;
  preset: string | null;
  accent: string | null;
  background: string | null;
  paperPack: string | null;
  tapePack: string | null;
  mascot: string | null;
  headerImageUrl: string | null;
  marks: LoopMarks;
};

type Choice = StationeryLooks & MarksDraft & { preset: string; accent: string };

const CHOICE_KEYS = ["preset", "accent", "background", "paperPack", "tapePack", "mascot", "motto", "signOff", "sealStyle", "sealColor", "divider", "celebration"] as const;
const sameChoice = (a: Choice, b: Choice) => CHOICE_KEYS.every((key) => a[key] === b[key]);

export function StationeryForm({ groupId, loopName, preset: savedPreset, accent: savedAccent, background, paperPack, tapePack, mascot, headerImageUrl, marks: savedMarks }: Props) {
  const initial: Choice = {
    ...draftOf(savedMarks),
    preset: savedPreset ?? DEFAULT_PRESET,
    accent: normalizeHex(savedAccent ?? "") ?? "",
    background: background ?? DEFAULT_BACKGROUND,
    paperPack: paperPack ?? DEFAULT_PAPER_PACK,
    tapePack: tapePack ?? DEFAULT_TAPE_PACK,
    mascot: mascot ?? DEFAULT_MASCOT,
  };
  const [preset, setPreset] = useState(initial.preset);
  const [accent, setAccent] = useState(savedAccent ?? "");
  const [looks, setLooks] = useState<StationeryLooks>({
    background: initial.background,
    paperPack: initial.paperPack,
    tapePack: initial.tapePack,
    mascot: initial.mascot,
  });
  const [marks, setMarks] = useState<MarksDraft>(() => draftOf(savedMarks));
  const [status, setStatus] = useState<SaveState>("idle");
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
    const timer = setTimeout(() => setStatus("idle"), 2500);
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
          result = await saveStationery(groupId, sent);
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
        setLooks(confirmed.current);
        setMarks(confirmed.current);
        setStatus("error");
      } finally {
        saving.current = false;
      }
    });
  }

  function commit(change: Partial<Choice>) {
    const next = { ...latest.current, ...change };
    if (sameChoice(next, latest.current)) return;
    latest.current = next;
    flush();
  }

  function retry() {
    const wanted = failed.current;
    if (!wanted) return;
    setPreset(wanted.preset);
    setAccent(wanted.accent);
    setLooks(wanted);
    setMarks(wanted);
    latest.current = wanted;
    flush();
  }

  return (
    <>
    <section className="card mt-4 p-5" aria-labelledby="stationery-title">
      <h2 id="stationery-title" className="text-ink">{copy.stationery.title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.stationery.intro}</p>

      <form
        action={stationeryAction}
        className="stationery-fields mt-3"
        onSubmit={(event) => {
          // Enter in the color field. Without script the form still posts on its own.
          event.preventDefault();
          if (accent.trim() === "" || hex) commit({ accent: hex ?? "" });
        }}
      >
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="accent" value={hex ?? ""} />

        <PaperFields
          status={(
            // Beside the preview, never over the options, so the tile just chosen stays in view.
            <SaveChip
              state={status}
              idle={copy.stationery.savesLine}
              idleShort={copy.stationery.savesLineShort}
              saving={copy.stationery.statusSaving}
              saved={copy.stationery.statusSaved}
              adjusted={copy.stationery.statusAdjusted}
              error={copy.stationery.statusError}
              retryLabel={copy.stationery.statusRetry}
              onRetry={retry}
            />
          )}
          preset={preset}
          onPreset={(next) => { setPreset(next); commit({ preset: next }); }}
          accent={accent}
          onAccent={(next) => { setAccent(next); if (next === "") commit({ accent: "" }); }}
          onAccentCommit={(value) => {
            const parsed = normalizeHex(value);
            if (value.trim() === "" || parsed) commit({ accent: parsed ?? "" });
          }}
          looks={looks}
          onLooks={(change) => {
            setLooks((current) => ({ ...current, ...change }));
            commit(change);
          }}
          loopName={loopName}
          marks={marks}
          onMarks={(change, typing) => {
            setMarks((current) => ({ ...current, ...change }));
            if (!typing) commit(change);
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
      if (done === "removed") input.current?.focus();
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
        <label className="file-pick btn btn-quiet h-11 min-h-11 text-[14px]" aria-disabled={status === "saving" ? true : undefined}>
          {url ? copy.stationery.headerReplace : copy.stationery.headerUpload}
          <input
            ref={input}
            type="file"
            className="sr-only"
            accept={PHOTO_ACCEPT}
            aria-label={copy.stationery.headerInput}
            onClick={(event) => {
              if (status === "saving") event.preventDefault();
            }}
            onChange={(event) => void choose(event.target.files?.[0])}
          />
        </label>
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
      <p aria-live="polite" className={`mt-1.5 text-[13px] ${status === "error" ? "text-danger" : "text-ink-muted"}`}>
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
