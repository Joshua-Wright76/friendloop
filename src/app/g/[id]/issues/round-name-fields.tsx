"use client";

import { useState, type CSSProperties } from "react";
import { copy, text } from "@/lib/copy";
import { issueRef, MAX_ISSUE_NAME } from "@/lib/issue-name";
import { COVER_TINTS, COVER_TINT_KEYS, coverOf } from "@/lib/looks";
import { CHARM_KEYS, stickerSrc } from "@/lib/stickers";
import { RoundCoverBand } from "@/components/round-cover";

const stickerName = (key: string) => copy.stickers[key as keyof typeof copy.stickers] ?? key;
const tintName = (key: string) => copy.rounds.cover.tints[key as keyof typeof copy.rounds.cover.tints] ?? key;

/**
 * A round's name and its cover, inside the rename form: the name field, then a
 * sticker and a colour, previewed live as the cover and as the email's opening line.
 * A cover belongs to a name, so the pickers wait for one; "No cover" takes it off.
 * Plain radios underneath, so the form posts the choice with or without script.
 */
export function RoundNameFields({
  number,
  loopName,
  name: savedName,
  coverSticker,
  coverTint,
}: {
  number: number;
  loopName: string;
  name: string | null;
  coverSticker: string | null;
  coverTint: string | null;
}) {
  const saved = coverOf({ name: savedName, coverSticker, coverTint });
  const [name, setName] = useState(savedName ?? "");
  const [sticker, setSticker] = useState(saved?.sticker ?? "");
  const [tint, setTint] = useState(saved?.tint ?? COVER_TINT_KEYS[0]);
  const named = name.trim() !== "";
  const cover = coverOf({ name: named ? name : null, coverSticker: sticker || null, coverTint: tint });
  const subject = text(copy.emails.delivery.subject, { groupName: loopName, issueRef: issueRef(number, named ? name.trim() : null) });

  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-soft">{text(copy.rounds.nameLabel, { number })}</span>
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={MAX_ISSUE_NAME}
          placeholder={copy.rounds.namePlaceholder}
          className="field h-11 py-0"
        />
      </label>
      <p className="text-[13px] leading-relaxed text-ink-muted">{text(copy.rounds.nameHint, { number })}</p>

      <fieldset className="cover-picker" disabled={!named}>
        <legend className="cover-picker__legend">{copy.rounds.cover.legend}</legend>
        <p className="cover-picker__hint">{named ? copy.rounds.cover.hint : copy.rounds.cover.needsName}</p>

        <fieldset className="cover-picker__group">
          <legend className="cover-picker__label">{copy.rounds.cover.sticker}</legend>
          <div className="cover-stickers">
            <label className="cover-sticker cover-sticker--none">
              <input type="radio" name="coverSticker" value="" checked={sticker === ""} onChange={() => setSticker("")} />
              <span>{copy.rounds.cover.none}</span>
            </label>
            {CHARM_KEYS.map((key) => (
              <label key={key} className="cover-sticker">
                <input type="radio" name="coverSticker" value={key} checked={sticker === key} onChange={() => setSticker(key)} aria-label={stickerName(key)} />
                {/* eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing. */}
                <img src={stickerSrc(key)} alt="" width={34} height={34} loading="lazy" />
              </label>
            ))}
          </div>
        </fieldset>

        {sticker ? (
          <fieldset className="cover-picker__group">
            <legend className="cover-picker__label">{copy.rounds.cover.tint}</legend>
            <div className="cover-tints">
              {COVER_TINT_KEYS.map((key) => (
                <label key={key} className="cover-tint" data-tint={key} style={{ "--swatch": COVER_TINTS[key].tint, "--cover-ink": COVER_TINTS[key].ink } as CSSProperties}>
                  <input type="radio" name="coverTint" value={key} checked={tint === key} onChange={() => setTint(key)} />
                  <span className="cover-tint__swatch" aria-hidden="true" />
                  <span className="cover-tint__name">{tintName(key)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {cover ? (
          <div className="cover-preview">
            <p className="cover-picker__label">{copy.rounds.cover.preview}</p>
            <RoundCoverBand cover={cover} chip={text(copy.rounds.round, { number })} title={name.trim()} titleAs="p" className="round-cover--preview" />
          </div>
        ) : null}
      </fieldset>

      <div className="cover-preview">
        <p className="cover-picker__label">{copy.rounds.cover.emailPreview}</p>
        <p className="email-line">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing.
            <img src={stickerSrc(cover.sticker)} alt="" aria-hidden="true" width={24} height={24} />
          ) : null}
          <span className="min-w-0 wrap-any">{subject}</span>
        </p>
      </div>
    </>
  );
}
