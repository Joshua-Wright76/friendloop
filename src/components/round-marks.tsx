import { useId } from "react";
import { Cherries } from "@/components/stationery";
import { DEFAULT_WAX } from "@/lib/looks";
import { postmarkDate, postmarkSvg, stampSvg, waxSealSvg } from "@/lib/seal-art";
import { DEFAULT_MASCOT, isMascotKey, stickerSrc } from "@/lib/stickers";

/**
 * The marks an owner adds to every round: a seal or postmark at the top, a motto
 * under the loop's name and a sign-off at the end. Each renders nothing when it
 * wasn't chosen, so a loop that chose none reads exactly as it always has. The art is
 * decoration: the round's number and date are always in the words beside it.
 */

/** SVG ids from React's, without the characters a url(#…) reference trips on. */
function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

const mascotOf = (mascot: string | null | undefined) => (isMascotKey(mascot) ? mascot : DEFAULT_MASCOT);

export function WaxSeal({ mascot, color, className = "" }: { mascot: string | null | undefined; color: string | null | undefined; className?: string }) {
  const id = useSvgId("wax");
  const key = mascotOf(mascot);
  return (
    <span
      className={`wax-seal ${className}`.trim()}
      aria-hidden="true"
      data-wax={color ?? DEFAULT_WAX}
      dangerouslySetInnerHTML={{ __html: waxSealSvg({ mascotHref: stickerSrc(key), color: color ?? DEFAULT_WAX, id, seed: key }) }}
    />
  );
}

export function Postmark({ mascot, number, loopName, deliveredAt, timezone, className = "" }: {
  mascot: string | null | undefined;
  number: number;
  loopName: string;
  deliveredAt: Date;
  timezone: string;
  className?: string;
}) {
  const id = useSvgId("pm");
  const { day, year } = postmarkDate(deliveredAt, timezone);
  return (
    <span className={`postmark-mark ${className}`.trim()} aria-hidden="true">
      <span className="postmark-mark__stamp" dangerouslySetInnerHTML={{ __html: stampSvg({ mascotHref: stickerSrc(mascotOf(mascot)), number, id: `${id}s` }) }} />
      <span className="postmark-mark__cancel" dangerouslySetInnerHTML={{ __html: postmarkSvg({ loopName, number, day, year, id: `${id}c` }) }} />
    </span>
  );
}

/** Whichever mark the loop chose, for the top of a delivered round. */
export function RoundMark(props: {
  sealStyle: string | null;
  sealColor: string | null;
  mascot: string | null | undefined;
  number: number;
  loopName: string;
  deliveredAt: Date;
  timezone: string;
}) {
  if (props.sealStyle === "wax") return <WaxSeal mascot={props.mascot} color={props.sealColor} className="round-mark" />;
  if (props.sealStyle === "postmark") {
    return <Postmark mascot={props.mascot} number={props.number} loopName={props.loopName} deliveredAt={props.deliveredAt} timezone={props.timezone} className="round-mark" />;
  }
  return null;
}

export function Motto({ text, className = "" }: { text: string | null; className?: string }) {
  if (!text) return null;
  return <p className={`loop-motto ${className}`.trim()}>{text}</p>;
}

/**
 * The closing card. On a loop's own pages the mark is the loop's mascot through the
 * stylesheet; a preview outside them passes the mascot to draw.
 */
export function SignOff({ text, next, mascot }: { text: string | null; next?: string | null; mascot?: string }) {
  if (!text) return null;
  return (
    <section className="card sign-off">
      {mascot ? (
        // eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do.
        <img src={stickerSrc(mascotOf(mascot))} alt="" width={44} height={44} className="sign-off__mark" />
      ) : (
        <Cherries className="sign-off__mark" />
      )}
      <p className="sign-off__words">{text}</p>
      {next ? <p className="sign-off__next">{next}</p> : null}
    </section>
  );
}
