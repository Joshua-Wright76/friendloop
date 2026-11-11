import type { CSSProperties, ReactNode } from "react";
import type { RoundCover } from "@/lib/looks";
import { stickerSrc } from "@/lib/stickers";
import { DisplayDigits } from "./display-digits";

/**
 * A named round's cover: its tint (with a soft pattern on the band), its sticker big
 * and tilted, which round it is, and its name in the tint's ink. The tint and ink are
 * fixed pairs (`COVER_TINTS`), checked for contrast, so the cover reads the same in
 * light and dark. The sticker is decoration; the words carry everything.
 */

const coverStyle = (cover: RoundCover) => ({ "--cover-tint": cover.color, "--cover-ink": cover.ink }) as CSSProperties;

export function RoundCoverBand({
  cover,
  chip,
  title,
  meta,
  titleAs: Title = "h1",
  className = "",
}: {
  cover: RoundCover;
  /** "Round 14". */
  chip: string;
  title: string;
  meta?: ReactNode;
  /** The round page's heading; a preview's is only words. */
  titleAs?: "h1" | "p";
  className?: string;
}) {
  return (
    <div className={`round-cover ${className}`.trim()} data-tint={cover.tint} data-cover={cover.sticker} style={coverStyle(cover)}>
      <div className="round-cover__band">
        <span className="round-cover__no numeric">{chip}</span>
        {/* eslint-disable-next-line @next/next/no-img-element -- A small static drawing; there is nothing for the image optimiser to do. */}
        <img className="round-cover__sticker" src={stickerSrc(cover.sticker)} alt="" aria-hidden="true" width={84} height={84} />
      </div>
      <div className="round-cover__words">
        <Title className="round-cover__name wrap-any"><DisplayDigits>{title}</DisplayDigits></Title>
        {meta ? <p className="round-cover__meta numeric">{meta}</p> : null}
      </div>
    </div>
  );
}

/**
 * A covered round in the rounds list: a little zine, its sticker, name and number on
 * the tint. It repeats the card's own heading, so it's hidden from screen readers.
 */
export function ZineCover({ cover, name, number }: { cover: RoundCover; name: string; number: string }) {
  return (
    <div className="zine-cover" data-tint={cover.tint} aria-hidden="true" style={coverStyle(cover)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- A small static drawing. */}
      <img src={stickerSrc(cover.sticker)} alt="" width={46} height={46} />
      <b className="zine-cover__name">{name}</b>
      <small className="zine-cover__no numeric">{number}</small>
    </div>
  );
}
