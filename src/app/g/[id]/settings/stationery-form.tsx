"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { LoopBanner } from "@/components/loop-theme";
import { Avatar } from "@/components/avatar";
import { copy } from "@/lib/copy";
import { MAX_BANNER_BYTES, PHOTO_ACCEPT } from "@/lib/photo-validation";
import {
  DEFAULT_PRESET,
  THEME_PRESET_KEYS,
  cssVars,
  normalizeHex,
  previewTheme,
  type SchemeTokens,
} from "@/lib/theme";
import { stationeryAction } from "./actions";

type PresetKey = keyof typeof copy.stationery.presets;

type Props = {
  groupId: string;
  preset: string | null;
  accent: string | null;
  headerImageUrl: string | null;
};

/** A small round of the interface in one scheme's tokens: what the owner is choosing. */
function PreviewCard({ label, tokens }: { label: string; tokens: SchemeTokens }) {
  return (
    <div
      className="rounded-md border p-3"
      style={{ ...(cssVars(tokens) as CSSProperties), background: tokens.page, borderColor: tokens.lineStrong, color: tokens.ink }}
      data-testid={`stationery-preview-${label.toLowerCase()}`}
    >
      <p className="m-0 text-[12px] font-extrabold" style={{ color: tokens.inkMuted }}>{label}</p>
      <div className="card mt-2 p-3">
        <p className="m-0 font-display text-[22px] font-bold leading-tight" style={{ color: tokens.ink }}>
          {copy.stationery.previewHeading}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Avatar name={copy.stationery.previewAnswerName} className="!h-7 !w-7 !text-[12px]" />
          <p className="m-0 text-[13px] font-extrabold" style={{ color: tokens.inkSoft }}>{copy.stationery.previewAnswerName}</p>
        </div>
        <p className="mt-1 text-[14px] leading-snug" style={{ color: tokens.ink }}>{copy.stationery.previewAnswer}</p>
        <span className="btn btn-primary mt-3 h-9 min-h-9 text-[13px]" aria-hidden="true">{copy.stationery.previewButton}</span>
      </div>
    </div>
  );
}

export function StationeryForm({ groupId, preset: savedPreset, accent: savedAccent, headerImageUrl }: Props) {
  const [preset, setPreset] = useState(savedPreset ?? DEFAULT_PRESET);
  const [accent, setAccent] = useState(savedAccent ?? "");
  const hex = normalizeHex(accent);
  const accentInvalid = accent.trim() !== "" && !hex;
  const theme = previewTheme({ preset, accent: hex });

  return (
    <section className="card mt-3 p-5" aria-labelledby="stationery-title">
      <h2 id="stationery-title" className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.stationery.title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.stationery.intro}</p>

      <form action={stationeryAction} className="mt-4">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="accent" value={hex ?? ""} />

        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-2 text-[13px] font-medium text-ink-soft">{copy.stationery.paperLegend}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {THEME_PRESET_KEYS.map((key) => {
              const preview = previewTheme({ preset: key, accent: null }).light;
              const info = copy.stationery.presets[key as PresetKey];
              return (
                <label
                  key={key}
                  className={`swatch bg-card ${preset === key ? "!border-accent" : ""}`}
                >
                  <span className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="preset"
                      value={key}
                      checked={preset === key}
                      onChange={() => setPreset(key)}
                      className="mt-1"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-extrabold text-ink">{info.name}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{info.description}</span>
                      <span className="swatch-strip mt-2" aria-hidden="true">
                        {[preview.page, preview.card, preview.line, preview.accent, preview.ink].map((color, index) => (
                          <span key={index} style={{ background: color }} />
                        ))}
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="m-0 mt-4 min-w-0 border-0 p-0">
          <legend className="mb-1 text-[13px] font-medium text-ink-soft">{copy.stationery.accentLegend}</legend>
          <p className="mb-2 text-[13px] leading-snug text-ink-muted">{copy.stationery.accentHint}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              aria-label={copy.stationery.accentPicker}
              value={hex ?? theme.light.accent}
              onChange={(event) => setAccent(event.target.value)}
              className="h-11 w-14 cursor-pointer rounded-md border border-line-strong bg-card p-1"
            />
            <input
              aria-label={copy.stationery.accentInput}
              aria-invalid={accentInvalid}
              aria-describedby="accent-status"
              value={accent}
              onChange={(event) => setAccent(event.target.value)}
              placeholder={theme.light.accent}
              maxLength={7}
              spellCheck={false}
              autoCapitalize="none"
              className="field h-11 w-32 py-0 font-mono"
            />
            {accent !== "" ? (
              <button type="button" className="btn btn-quiet h-10 text-[14px]" onClick={() => setAccent("")}>
                {copy.stationery.accentReset}
              </button>
            ) : null}
          </div>
          <p id="accent-status" className={`mt-1.5 text-[12px] leading-relaxed ${accentInvalid ? "text-danger" : "text-ink-muted"}`} role="status">
            {accentInvalid
              ? copy.stationery.accentInvalid
              : hex && theme.adjusted
                ? copy.stationery.adjusted
                : accent === ""
                  ? copy.stationery.accentUsing
                  : ""}
          </p>
        </fieldset>

        <div className="mt-4">
          <p className="mb-2 text-[13px] font-medium text-ink-soft">{copy.stationery.previewTitle}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <PreviewCard label={copy.stationery.previewLight} tokens={theme.light} />
            <PreviewCard label={copy.stationery.previewDark} tokens={theme.dark} />
          </div>
        </div>

        <button type="submit" className="btn btn-primary mt-5" disabled={accentInvalid}>
          {copy.stationery.save}
        </button>
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
      const body = (await response.json().catch(() => ({}))) as { url?: string | null; error?: string };
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

  function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BANNER_BYTES) {
      setStatus("error");
      setMessage(copy.identity.errors.bannerTooLarge);
      return;
    }
    const form = new FormData();
    form.set("photo", file);
    void send({ method: "POST", body: form }, "saved");
    if (input.current) input.current.value = "";
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
          className="btn btn-quiet h-10 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
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
            className="btn btn-quiet h-10 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
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
        onChange={(event) => choose(event.target.files?.[0])}
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
