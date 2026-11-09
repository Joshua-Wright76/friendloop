import type { CSSProperties } from "react";
import { Avatar, NameCharm } from "./avatar";
import { SignatureInk } from "./signature-ink";
import { Tape } from "./stationery";
import { copy, text } from "@/lib/copy";
import type { IssueSignature, IssueStatusLine } from "@/lib/issue-view";
import { isStickerKey } from "@/lib/looks";
import { stickerSrc } from "@/lib/stickers";

/**
 * What people add to a round themselves: a line each ("currently…"), a signature,
 * and a sticker on an answer. Each renders nothing when nobody chose it, so a round
 * without them reads exactly as it always has. The art is decoration: names are
 * always printed, and a signature says whose it is.
 */

/** "Who's here this round": everyone with a line, at the top of the round. */
export function RollCall({ lines }: { lines?: IssueStatusLine[] }) {
  if (!lines || lines.length === 0) return null;
  return (
    <section className="card roll-call ride-in p-5 pt-6" aria-labelledby="roll-call-title">
      <Tape tone="mint" position="left" />
      <h2 id="roll-call-title" className="text-ink">{copy.issue.rollCallTitle}</h2>
      <ul className="roll-call__list">
        {lines.map((line) => (
          <li key={line.id} className="roll-call__person">
            <Avatar name={line.name} photoUrl={line.photoUrl} frame={line.frame} />
            <span className="min-w-0">
              <span className="roll-call__name">{line.name}<NameCharm charm={line.charm} /></span>
              <span className="roll-call__line">{line.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A person's line under their name when reading by person. "currently" is fixed, so it reads as a status. */
export function StatusBubble({ body }: { body?: string | null }) {
  if (!body) return null;
  return (
    <p className="status-bubble">
      <span className="status-bubble__lead">{copy.issue.currently}</span> {body}
    </p>
  );
}

/** "—" and their signature, closing their answers when reading by person. It writes itself in once. */
export function SignOffSignature({ name, strokes }: { name: string; strokes?: number[][] | null }) {
  if (!strokes) return null;
  return (
    <div className="signature-sign-off">
      <span className="signature-sign-off__dash" aria-hidden="true">—</span>
      <SignatureInk strokes={strokes} name={name} maxWidth={200} maxHeight={64} draw />
    </div>
  );
}

/** A loose scatter, never the same tilt twice in a row. */
const TILTS = [-5, 4, 2, -3, 5, -2, 3, -4];

/** "Signed, sealed, delivered": everyone who wrote in the round and signs, gathered on one card. */
export function SignedCard({ signatures, round }: { signatures?: IssueSignature[]; round: number }) {
  if (!signatures || signatures.length === 0) return null;
  return (
    <section className="card signed-card ride-in" aria-labelledby="signed-card-title">
      <Tape tone="dots" position="center" />
      <h2 id="signed-card-title" className="text-ink">{copy.signatures.cardTitle}</h2>
      <p className="signed-card__note">{text(copy.signatures.cardNote, { round: text(copy.issue.round, { number: round }) })}</p>
      <ul className="signed-card__list">
        {signatures.map((signature, index) => (
          <li key={signature.id} className="signed-card__person" style={{ "--tilt": `${TILTS[index % TILTS.length]}deg` } as CSSProperties}>
            <SignatureInk strokes={signature.strokes} name={signature.name} maxWidth={170} maxHeight={60} draw />
            {/* The drawing already says whose it is; the printed name is for the eye. */}
            <span className="signed-card__name" aria-hidden="true">{signature.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The sticker someone slapped on their answer. One element, two looks: beside the
 * name on a phone, slapped on the answer's corner with a die-cut edge on a wide screen.
 */
export function AnswerSticker({ sticker }: { sticker?: string | null }) {
  if (!isStickerKey(sticker)) return null;
  // eslint-disable-next-line @next/next/no-img-element -- A tiny static drawing; there is nothing for the image optimiser to do.
  return <img src={stickerSrc(sticker)} alt="" width={56} height={56} loading="lazy" className="answer-sticker" />;
}
