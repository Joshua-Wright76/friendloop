"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { copy } from "@/lib/copy";
import {
  BACKGROUND_KEYS,
  PAPER_PACK_KEYS,
  TAPE_PACK_KEYS,
  TAPE_TONES,
  pageLayers,
  paperVars,
  tapeVars,
} from "@/lib/stationery";
import { MASCOT_KEYS, stickerSrc } from "@/lib/stickers";
import type { ResolvedTheme } from "@/lib/theme";

/** The check every picked tile carries, so the choice is never down to colour alone. */
export function PickedMark() {
  return (
    <span className="pick-mark" aria-hidden="true">
      <svg viewBox="0 0 20 20" className="h-3 w-3"><path d="m5 10.5 3.4 3.4L15 6.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
  );
}

export function Group({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 mt-5 min-w-0 border-0 p-0 first:mt-0">
      <legend className="mb-1 text-[13px] font-medium text-ink-soft">{legend}</legend>
      {hint ? <p className="mb-2 text-[13px] leading-snug text-ink-muted">{hint}</p> : <div className="mb-2" />}
      {children}
    </fieldset>
  );
}

/** One tile per pattern, each in the colours the loop is wearing right now. */
export function BackgroundPicker({ value, onChange, theme }: { value: string; onChange: (key: string) => void; theme: ResolvedTheme }) {
  return (
    <Group legend={copy.stationery.backgroundLegend} hint={copy.stationery.backgroundHint}>
      <div className="bg-tiles">
        {BACKGROUND_KEYS.map((key) => {
          const light = pageLayers(key, theme.light);
          const dark = pageLayers(key, theme.dark);
          const style = {
            "--swatch-page-light": theme.light.page,
            "--swatch-page-dark": theme.dark.page,
            "--swatch-image-light": light.image,
            "--swatch-image-dark": dark.image,
            "--swatch-size-light": light.size,
            "--swatch-size-dark": dark.size,
          } as CSSProperties;
          return (
            <label key={key} className="bg-tile" style={style}>
              <input type="radio" name="background" value={key} checked={value === key} onChange={() => onChange(key)} />
              <span className="bg-tile__swatch" aria-hidden="true"><PickedMark /></span>
              <span className="bg-tile__name">{copy.stationery.backgrounds[key as keyof typeof copy.stationery.backgrounds]}</span>
            </label>
          );
        })}
      </div>
    </Group>
  );
}

/** A small hand of what the pack does: an answer, a poll and a playlist, in that pack's own paper. */
function PackFan() {
  const line = (width: string) => <i className="pack-line" style={{ width }} />;
  return (
    <span className="pack-fan" aria-hidden="true">
      <span className="pack-sheet pack-sheet--music">
        <span className="pack-track"><i className="pack-art" /><span className="pack-track__lines">{line("90%")}{line("60%")}</span></span>
        <span className="pack-track"><i className="pack-art pack-art--b" /><span className="pack-track__lines">{line("76%")}{line("48%")}</span></span>
        <span className="pack-track"><i className="pack-art pack-art--c" /><span className="pack-track__lines">{line("84%")}{line("54%")}</span></span>
      </span>
      <span className="pack-sheet pack-sheet--poll">
        {line("70%")}
        <span className="pack-option pack-option--on" />
        <span className="pack-option" />
        <span className="pack-option" />
      </span>
      <span className="pack-sheet pack-sheet--answer">
        <span className="pack-byline"><i className="pack-face" />{line("46%")}</span>
        <span className="pack-words">{line("94%")}{line("100%")}{line("88%")}{line("96%")}{line("62%")}</span>
      </span>
    </span>
  );
}

export function PaperPackPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  return (
    <Group legend={copy.stationery.packLegend} hint={copy.stationery.packHint}>
      <div className="pack-tiles">
        {PAPER_PACK_KEYS.map((key) => {
          const info = copy.stationery.packs[key as keyof typeof copy.stationery.packs];
          return (
            <label key={key} className="pack-tile" style={paperVars(key) as CSSProperties}>
              <input type="radio" name="paperPack" value={key} checked={value === key} onChange={() => onChange(key)} />
              <PackFan />
              <PickedMark />
              <span className="pack-tile__name">{info.name}</span>
              <span className="pack-tile__desc">{info.description}</span>
            </label>
          );
        })}
      </div>
    </Group>
  );
}

/** Tapping a roll runs its strips out across the card above. The animation restarts because the strips are keyed to the pack. */
export function TapePackPicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  // The first paint just shows the tape on; only a choice unrolls it.
  const [chosen, setChosen] = useState(false);
  return (
    <Group legend={copy.stationery.tapeLegend} hint={copy.stationery.tapeHint}>
      <div className="tape-stage" style={tapeVars(value) as CSSProperties} data-unroll={chosen ? "" : undefined} data-testid="tape-stage" aria-hidden="true">
        {TAPE_TONES.map((tone, index) => (
          <span key={`${value}-${tone}`} className={`tape-strip tape-strip--${index + 1}`}><i className={`tape-face tape-${tone}`} /></span>
        ))}
        <span className="tape-stage__note">
          <i className="pack-line" style={{ width: "62%" }} />
          <i className="pack-line" style={{ width: "88%" }} />
          <i className="pack-line" style={{ width: "74%" }} />
        </span>
      </div>
      <div className="tape-rolls">
        {TAPE_PACK_KEYS.map((key) => (
          <label key={key} className="tape-roll-tile" style={tapeVars(key) as CSSProperties}>
            <input
              type="radio"
              name="tapePack"
              value={key}
              checked={value === key}
              onChange={() => {
                setChosen(true);
                onChange(key);
              }}
            />
            <span className="tape-roll" aria-hidden="true">
              <i className="tape-roll__tail tape-face tape-stripe" />
              <i className="tape-roll__ring tape-face tape-dots" />
              <PickedMark />
            </span>
            <span className="tape-roll-tile__name">{copy.stationery.tapes[key as keyof typeof copy.stationery.tapes]}</span>
          </label>
        ))}
      </div>
    </Group>
  );
}

function MascotArt({ mascot, className = "" }: { mascot: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do.
  return <img src={stickerSrc(mascot)} alt="" width={64} height={64} className={className} />;
}

export function MascotPicker({ value, onChange, loopName }: { value: string; onChange: (key: string) => void; loopName: string }) {
  return (
    <Group legend={copy.stationery.mascotLegend} hint={copy.stationery.mascotHint}>
      <div className="mascot-tiles">
        {MASCOT_KEYS.map((key) => (
          <label key={key} className="mascot-tile">
            <input type="radio" name="mascot" value={key} checked={value === key} onChange={() => onChange(key)} />
            <MascotArt mascot={key} />
            <span className="mascot-tile__name">{copy.stickers[key as keyof typeof copy.stickers]}</span>
            <PickedMark />
          </label>
        ))}
      </div>
      <div className="mascot-previews" aria-hidden="true" data-testid="mascot-preview">
        <div className="mascot-preview">
          <p className="mascot-preview__label">{copy.stationery.mascotPreviewHeader}</p>
          <div className="mascot-preview__head"><MascotArt mascot={value} /><span>{loopName}</span></div>
        </div>
        <div className="mascot-preview">
          <p className="mascot-preview__label">{copy.stationery.mascotPreviewEmail}</p>
          <div className="mascot-preview__mail">
            <p className="mascot-preview__from"><MascotArt mascot={value} /><span>{loopName}</span></p>
            <p className="mascot-preview__subject">{copy.stationery.mascotPreviewSubject}</p>
          </div>
        </div>
      </div>
    </Group>
  );
}
