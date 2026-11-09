"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { BackgroundPicker, MascotPicker, PaperPackPicker, TapePackPicker } from "@/components/stationery-pickers";
import { Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";
import {
  THEME_PRESET_KEYS,
  cssVars,
  normalizeHex,
  previewTheme,
  type SchemeTokens,
} from "@/lib/theme";
import { pageLayers, paperVars, tapeVars } from "@/lib/stationery";

/** Everything besides colour, chosen together. */
export type StationeryLooks = { background: string; paperPack: string; tapePack: string; mascot: string };

type PresetKey = keyof typeof copy.stationery.presets;

type Props = {
  preset: string;
  onPreset: (preset: string) => void;
  accent: string;
  onAccent: (accent: string) => void;
  /** Called when the person is done with the colour: leaving the field, or letting go of the picker. */
  onAccentCommit?: (accent: string) => void;
  looks: StationeryLooks;
  onLooks: (change: Partial<StationeryLooks>) => void;
  /** Shown in the mascot's little previews. */
  loopName: string;
};

/** A small round of the interface in one scheme's tokens: what the owner is choosing. */
function PreviewCard({ scheme, label, tokens, looks }: { scheme: "light" | "dark"; label: string; tokens: SchemeTokens; looks: StationeryLooks }) {
  const page = pageLayers(looks.background, tokens);
  return (
    <div
      className="rounded-md border p-3"
      style={{
        ...(cssVars(tokens) as CSSProperties),
        ...(paperVars(looks.paperPack) as CSSProperties),
        ...(tapeVars(looks.tapePack) as CSSProperties),
        backgroundColor: tokens.page,
        backgroundImage: page.image,
        backgroundSize: page.size,
        borderColor: tokens.lineStrong,
        color: tokens.ink,
      }}
      data-testid={`stationery-preview-${scheme}`}
    >
      <p className="m-0 text-[13px] font-extrabold" style={{ color: tokens.inkMuted }}>{label}</p>
      <div className="card mt-5 p-3 pt-4" data-paper="answer">
        <Tape tone="dots" position="right" />
        <p className="m-0 font-display text-[22px] font-bold leading-tight" style={{ color: tokens.ink }}>
          {copy.stationery.previewHeading}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Avatar name={copy.stationery.previewAnswerName} className="!h-7 !w-7 !text-[13px]" />
          <p className="m-0 text-[13px] font-extrabold" style={{ color: tokens.inkSoft }}>{copy.stationery.previewAnswerName}</p>
        </div>
        <p className="answer-text mt-1 text-[14px] leading-snug" style={{ color: tokens.ink }}>{copy.stationery.previewAnswer}</p>
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
/**
 * One group of choices. On a wide screen every group simply shows; on a phone each folds
 * to a line naming what's chosen, so the whole look fits on a screen or two, and the
 * first (colours) starts open.
 */
function LookGroup({ title, value, startOpen = false, children }: { title: string; value: string; startOpen?: boolean; children: ReactNode }) {
  const group = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!startOpen && group.current && window.matchMedia("(max-width: 639px)").matches) group.current.open = false;
  }, [startOpen]);
  return (
    <details ref={group} className="look-group" open>
      <summary className="look-group__summary">
        <span className="look-group__title">{title}</span>
        <span className="look-group__value">{value}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="look-group__chevron"><path d="m5.5 8 4.5 4.5L14.5 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </summary>
      <div className="look-group__body">{children}</div>
    </details>
  );
}

export function PaperFields({ preset, onPreset, accent, onAccent, onAccentCommit, looks, onLooks, loopName }: Props) {
  const pickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hex = normalizeHex(accent);
  const accentInvalid = accent.trim() !== "" && !hex;
  const theme = previewTheme({ preset, accent: hex });

  const presetName = copy.stationery.presets[preset as PresetKey]?.name ?? preset;
  const named = <T extends Record<string, unknown>>(names: T, key: string) => String((names as Record<string, unknown>)[key] ?? key);
  return (
    <>
      <div className="look-preview">
        <p className="mb-2 text-[13px] font-medium text-ink-soft">{copy.stationery.previewTitle}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <PreviewCard scheme="light" label={copy.stationery.previewLight} tokens={theme.light} looks={looks} />
          <PreviewCard scheme="dark" label={copy.stationery.previewDark} tokens={theme.dark} looks={looks} />
        </div>
      </div>

      <LookGroup title={copy.stationery.paperLegend} value={presetName} startOpen>
      <fieldset className="m-0 mt-5 min-w-0 border-0 p-0">
        <legend className="mb-2 text-[13px] font-medium text-ink-soft">{copy.stationery.paperLegend}</legend>
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESET_KEYS.map((key) => {
            const { light, dark } = previewTheme({ preset: key, accent: null });
            const info = copy.stationery.presets[key as PresetKey];
            const scrap = {
              "--scrap-page-light": light.page, "--scrap-check-light": light.check, "--scrap-card-light": light.card, "--scrap-ink-light": light.ink, "--scrap-soft-light": light.inkSoft, "--scrap-accent-light": light.accent, "--scrap-line-light": light.lineStrong,
              "--scrap-page-dark": dark.page, "--scrap-check-dark": dark.check, "--scrap-card-dark": dark.card, "--scrap-ink-dark": dark.ink, "--scrap-soft-dark": dark.inkSoft, "--scrap-accent-dark": dark.accent, "--scrap-line-dark": dark.lineStrong,
            } as CSSProperties;
            return (
              <label key={key} className="paper-tile" style={scrap}>
                <input type="radio" name="preset" value={key} checked={preset === key} onChange={() => onPreset(key)} />
                {/* An actual scrap of the paper, in its own colours whatever the page is wearing. */}
                <span className="paper-tile__ground">
                  <span className="paper-tile__note">
                    <span className="paper-tile__tape" aria-hidden="true" />
                    <span className="paper-tile__mark" aria-hidden="true">
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5"><path d="m5 10.5 3.4 3.4L15 6.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <span className="paper-tile__name">{info.name}</span>
                    <span className="paper-tile__desc">{info.description}</span>
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
            onChange={(event) => {
              const value = event.target.value;
              onAccent(value);
              // The native picker fires as it's dragged and may never blur: a pause counts as letting go.
              if (pickerTimer.current) clearTimeout(pickerTimer.current);
              pickerTimer.current = setTimeout(() => onAccentCommit?.(value), 800);
            }}
            className="h-11 w-14 cursor-pointer rounded-md border border-line-strong bg-card p-1"
          />
          <input
            id="accent-input"
            aria-label={copy.stationery.accentInput}
            aria-invalid={accentInvalid}
            aria-describedby="accent-status"
            value={accent}
            onChange={(event) => onAccent(event.target.value)}
            onBlur={(event) => onAccentCommit?.(event.target.value)}
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
        <p id="accent-status" className={`mt-1.5 text-[13px] leading-relaxed ${accentInvalid ? "text-danger" : "text-ink-muted"}`} role="status">
          {accentInvalid
            ? copy.stationery.accentInvalid
            : hex && theme.adjusted
              ? copy.stationery.adjusted
              : accent === ""
                ? copy.stationery.accentUsing
                : ""}
        </p>
      </fieldset>

      </LookGroup>
      <LookGroup title={copy.stationery.backgroundLegend} value={named(copy.stationery.backgrounds, looks.background)}>
      <BackgroundPicker value={looks.background} onChange={(background) => onLooks({ background })} theme={theme} />
      </LookGroup>
      <LookGroup title={copy.stationery.packLegend} value={(copy.stationery.packs as Record<string, { name: string }>)[looks.paperPack]?.name ?? looks.paperPack}>
      <PaperPackPicker value={looks.paperPack} onChange={(paperPack) => onLooks({ paperPack })} />
      </LookGroup>
      <LookGroup title={copy.stationery.tapeLegend} value={named(copy.stationery.tapes, looks.tapePack)}>
      <TapePackPicker value={looks.tapePack} onChange={(tapePack) => onLooks({ tapePack })} />
      </LookGroup>
      <LookGroup title={copy.stationery.mascotLegend} value={named(copy.stickers, looks.mascot)}>
      <MascotPicker value={looks.mascot} onChange={(mascot) => onLooks({ mascot })} loopName={loopName} />
      </LookGroup>
    </>
  );
}
