"use client";

import type { CSSProperties } from "react";
import { Avatar } from "@/components/avatar";
import { copy } from "@/lib/copy";
import {
  THEME_PRESET_KEYS,
  cssVars,
  normalizeHex,
  previewTheme,
  type SchemeTokens,
} from "@/lib/theme";

type PresetKey = keyof typeof copy.stationery.presets;

type Props = {
  preset: string;
  onPreset: (preset: string) => void;
  accent: string;
  onAccent: (accent: string) => void;
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

/**
 * The paper, the accent and the live light-and-dark preview, shared by the
 * settings and the create-a-loop wizard so both offer exactly the same choices.
 * The parent owns the state and submits `preset` (the radios) and the
 * normalised accent (`normalizeHex(accent)`, as a hidden field).
 */
export function PaperFields({ preset, onPreset, accent, onAccent }: Props) {
  const hex = normalizeHex(accent);
  const accentInvalid = accent.trim() !== "" && !hex;
  const theme = previewTheme({ preset, accent: hex });

  return (
    <>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-2 text-[13px] font-medium text-ink-soft">{copy.stationery.paperLegend}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {THEME_PRESET_KEYS.map((key) => {
            const preview = previewTheme({ preset: key, accent: null }).light;
            const info = copy.stationery.presets[key as PresetKey];
            return (
              <label key={key} className={`swatch bg-card ${preset === key ? "!border-accent" : ""}`}>
                <span className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="preset"
                    value={key}
                    checked={preset === key}
                    onChange={() => onPreset(key)}
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
            onChange={(event) => onAccent(event.target.value)}
            className="h-11 w-14 cursor-pointer rounded-md border border-line-strong bg-card p-1"
          />
          <input
            aria-label={copy.stationery.accentInput}
            aria-invalid={accentInvalid}
            aria-describedby="accent-status"
            value={accent}
            onChange={(event) => onAccent(event.target.value)}
            placeholder={theme.light.accent}
            maxLength={7}
            spellCheck={false}
            autoCapitalize="none"
            className="field h-11 w-32 py-0 font-mono"
          />
          {accent !== "" ? (
            <button type="button" className="btn btn-quiet h-10 text-[14px]" onClick={() => onAccent("")}>
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
    </>
  );
}
