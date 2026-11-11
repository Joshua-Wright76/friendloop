"use client";

import { useCallback, useId, useState, type CSSProperties } from "react";
import { Celebration } from "@/components/celebration";
import { Postmark, WaxSeal } from "@/components/round-marks";
import { Group, PickedMark } from "@/components/stationery-pickers";
import { copy } from "@/lib/copy";
import { dividerBorder } from "@/lib/dividers";
import { CELEBRATION_KEYS, DEFAULT_WAX, DIVIDER_KEYS, MOTTO_MAX, SEAL_STYLES, SIGN_OFF_MAX, WAX_COLOR_KEYS } from "@/lib/looks";
import type { ResolvedTheme } from "@/lib/theme";

/**
 * The owner's marks on every round, as a draft the form holds: text as typed, and ""
 * for "none" (or the original cherry wax). The server cleans and checks it all again.
 */
export type MarksDraft = { motto: string; signOff: string; sealStyle: string; sealColor: string; divider: string; celebration: string };

export const EMPTY_MARKS: MarksDraft = { motto: "", signOff: "", sealStyle: "", sealColor: DEFAULT_WAX, divider: "", celebration: "" };

export function draftOf(marks: { motto: string | null; signOff: string | null; sealStyle: string | null; sealColor: string | null; divider: string | null; celebration: string | null }): MarksDraft {
  return {
    motto: marks.motto ?? "",
    signOff: marks.signOff ?? "",
    sealStyle: marks.sealStyle ?? "",
    sealColor: marks.sealColor ?? DEFAULT_WAX,
    divider: marks.divider ?? "",
    celebration: marks.celebration ?? "",
  };
}

/** A change, and whether the person is still typing it (text saves when they leave the field). */
export type OnMarks = (change: Partial<MarksDraft>, typing?: boolean) => void;

/** Fixed for the preview, so the postmark there never says anything about a real round. */
const PREVIEW_ROUND = { number: 12, date: new Date("2026-11-06T17:00:00Z"), zone: "UTC" };

export function WordsFields({ marks, onMarks }: { marks: MarksDraft; onMarks: OnMarks }) {
  const id = useId();
  const field = (name: "motto" | "signOff", label: string, hint: string, placeholder: string, max: number) => (
    <div className="mt-3 first:mt-0">
      <label htmlFor={`${id}-${name}`} className="block text-[14px] font-bold text-ink">{label}</label>
      <p id={`${id}-${name}-hint`} className="mt-0.5 text-[13px] leading-snug text-ink-muted">{hint}</p>
      <input
        id={`${id}-${name}`}
        name={name}
        value={marks[name]}
        maxLength={max}
        placeholder={placeholder}
        aria-describedby={`${id}-${name}-hint ${id}-words-note`}
        onChange={(event) => onMarks({ [name]: event.target.value }, true)}
        onBlur={(event) => onMarks({ [name]: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onMarks({ [name]: event.currentTarget.value });
          }
        }}
        className="field mt-1.5 h-11 py-0"
      />
    </div>
  );
  return (
    <div className="mt-2">
      {field("motto", copy.stationery.mottoLabel, copy.stationery.mottoHint, copy.stationery.mottoPlaceholder, MOTTO_MAX)}
      {field("signOff", copy.stationery.signOffLabel, copy.stationery.signOffHint, copy.stationery.signOffPlaceholder, SIGN_OFF_MAX)}
      <p id={`${id}-words-note`} className="mt-2 text-[13px] leading-snug text-ink-muted">{copy.stationery.wordsBlank}</p>
    </div>
  );
}

export function SealPicker({ marks, onMarks, mascot, loopName }: { marks: MarksDraft; onMarks: OnMarks; mascot: string; loopName: string }) {
  const styles = ["", ...SEAL_STYLES];
  return (
    <Group legend={copy.stationery.sealLegend} hint={copy.stationery.sealHint}>
      <div className="mark-tiles mark-tiles--seals">
        {styles.map((style) => {
          const info = copy.stationery.seals[(style || "none") as keyof typeof copy.stationery.seals];
          return (
            <label key={style || "none"} className="mark-tile">
              <input type="radio" name="sealStyle" value={style} checked={marks.sealStyle === style} onChange={() => onMarks({ sealStyle: style })} />
              <span className="mark-tile__art" aria-hidden="true">
                {style === "wax" ? <WaxSeal mascot={mascot} color={marks.sealColor} /> : null}
                {style === "postmark" ? (
                  <Postmark mascot={mascot} number={PREVIEW_ROUND.number} loopName={loopName} deliveredAt={PREVIEW_ROUND.date} timezone={PREVIEW_ROUND.zone} />
                ) : null}
                {style === "" ? <span className="mark-tile__none" /> : null}
              </span>
              <PickedMark />
              <span className="mark-tile__name">{info.name}</span>
              <span className="mark-tile__desc">{info.description}</span>
            </label>
          );
        })}
      </div>
      {marks.sealStyle === "wax" ? (
        <fieldset className="m-0 mt-3 min-w-0 border-0 p-0">
          <legend className="mb-2 text-[13px] font-medium text-ink-soft">{copy.stationery.waxLegend}</legend>
          <div className="wax-tiles">
            {WAX_COLOR_KEYS.map((color) => (
              <label key={color} className="mascot-tile wax-tile">
                <input type="radio" name="sealColor" value={color} checked={marks.sealColor === color} onChange={() => onMarks({ sealColor: color })} />
                <WaxSeal mascot={mascot} color={color} />
                <span className="mascot-tile__name">{copy.stationery.waxes[color as keyof typeof copy.stationery.waxes]}</span>
                <PickedMark />
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </Group>
  );
}

/** Each divider between two scraps of answer, in the colours the loop is wearing right now. */
export function DividerPicker({ value, onChange, theme }: { value: string; onChange: (key: string) => void; theme: ResolvedTheme }) {
  return (
    <Group legend={copy.stationery.dividerLegend} hint={copy.stationery.dividerHint}>
      <div className="mark-tiles">
        {["", ...DIVIDER_KEYS].map((key) => {
          const style = {
            "--divider-light": dividerBorder(key, theme.light, 13),
            "--divider-dark": dividerBorder(key, theme.dark, 13),
          } as CSSProperties;
          return (
            <label key={key || "stitches"} className="mark-tile divider-tile" style={style}>
              <input type="radio" name="divider" value={key} checked={value === key} onChange={() => onChange(key)} />
              <span className="divider-tile__scrap" aria-hidden="true">
                <i className="pack-line" style={{ width: "70%" }} />
                <span className="divider-tile__line divided"><i className="pack-line" style={{ width: "54%" }} /></span>
              </span>
              <PickedMark />
              <span className="mark-tile__name">{copy.stationery.dividers[(key || "stitches") as keyof typeof copy.stationery.dividers]}</span>
            </label>
          );
        })}
      </div>
    </Group>
  );
}

/** Choosing one plays it in the little stage above the tiles, as someone sending would see it. */
export function CelebrationPicker({ value, onChange, mascot }: { value: string; onChange: (key: string) => void; mascot: string }) {
  const [play, setPlay] = useState(0);
  const stop = useCallback(() => setPlay(0), []);
  return (
    <Group legend={copy.stationery.celebrationLegend} hint={copy.stationery.celebrationHint}>
      <div className="celebration-stage" aria-hidden="true">
        <span className="celebration-stage__check">
          <svg viewBox="0 0 20 20" className="sent-stamp h-10 w-10"><path d="M10 1.7a8.3 8.3 0 100 16.6 8.3 8.3 0 000-16.6zm3.8 6.4l-4.4 4.7a.9.9 0 01-1.3 0L6.2 10.9a.9.9 0 111.3-1.3l1.2 1.3 3.8-4a.9.9 0 011.3 1.2z" /></svg>
        </span>
        {play > 0 && value ? <Celebration key={play} kind={value} mascot={mascot} seed={play} onEnd={stop} contained /> : null}
      </div>
      <div className="mark-tiles">
        {["", ...CELEBRATION_KEYS].map((key) => (
          <label key={key || "none"} className="mark-tile mark-tile--text">
            <input
              type="radio"
              name="celebration"
              value={key}
              checked={value === key}
              onChange={() => {
                onChange(key);
                setPlay((count) => count + 1);
              }}
            />
            <PickedMark />
            <span className="mark-tile__name">{copy.stationery.celebrations[(key || "none") as keyof typeof copy.stationery.celebrations]}</span>
          </label>
        ))}
      </div>
      {value ? (
        <button type="button" className="btn btn-quiet mt-2 h-11 min-h-11 text-[14px]" onClick={() => setPlay((count) => count + 1)}>
          {copy.stationery.celebrationPlay}
        </button>
      ) : null}
    </Group>
  );
}
