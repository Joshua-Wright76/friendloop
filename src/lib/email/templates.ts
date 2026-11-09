/**
 * Friendloop's stationery, adapted for email clients: tables, inline styles,
 * solid-color fallbacks, and no required images or remote fonts.
 */

import { copy, text } from "../copy.ts";
import { url as appLink } from "../urls.ts";
import { formatAudioDuration } from "../audio-validation.ts";
import { formatDate } from "../format.ts";
import { issueHeading, issueRef } from "../issue-name.ts";
import { DEFAULT_MASCOT, isCharmKey, isMascotKey, stickerPng } from "../stickers.ts";
import { isStickerKey } from "../looks.ts";
import { emailPalette, GINGHAM_EMAIL, type EmailPalette } from "../theme.ts";
import { emailPatternTile, type EmailPatternTile } from "../stationery.ts";
import { appUrl } from "../urls.ts";
import { emailDividerStrip, type EmailDividerStrip } from "../dividers.ts";
import { marksOf, type LoopMarks, type RoundCover } from "../looks.ts";
import { EMAIL_SEAL_SIZE, EMAIL_STAMP, postmarkDate, sealPng, stampPng } from "../seal-art.ts";

type LayoutInput = {
  preheader: string;
  heading: string;
  body: string[];
  cta?: { label: string; url: string };
  footer?: string;
  /** For the emails that ask for an answer, where a reply is the natural mistake. */
  replyHint?: boolean;
  answers?: AnswerBlock[];
  sections?: SectionEmailBlock[];
  /** Where "listen on the web issue" points for voice notes. */
  answersUrl?: string;
  /** The loop's stationery; absent means Gingham Picnic, exactly as before themes. */
  theme?: EmailTheme;
  /** This recipient's "stop emails from this loop" page. Every loop email has one. */
  unsubscribeUrl?: string;
  /** Whose letter this is. Loop emails lead with the loop; only account mail says Friendloop. */
  sender?: string;
  /** Listed in the card, above the button: what's actually being asked. */
  questions?: { label: string; items: string[] };
  /** A sign-in code, big under the button, with a quiet line after it. */
  code?: { label: string; value: string; note: string };
  /** Under a delivered issue: the round that opened as it went out. */
  next?: NextRoundBlock;
  /** A delivered round's marks from its owner; absent is the round as it always was. */
  marks?: RoundEmailMarks;
  /** Everyone's line this round, as a roll call above the answers; absent or empty shows nothing. */
  rollCall?: EmailRollCallEntry[];
  /** The signed card closing the round; absent when nobody who wrote has a signature. */
  signed?: { note: string; signatures: EmailSignature[] };
  /** A named round's cover, in place of the plain heading; `chip` says which round it is. */
  cover?: { look: RoundCover; chip: string };
};

/** One person's line in the roll call. */
export type EmailRollCallEntry = { name: string; line: string };

/** A signature's picture (`src`, absolute), drawn at its own shape inside the card. */
export type EmailSignature = { name: string; src: string; width: number; height: number };

/**
 * What an owner added to every round, ready for email: words as plain text, the seal
 * or stamp as a PNG from the app's own address (dynamic words beside it as real text),
 * and the divider as a strip. Each part is null when it wasn't chosen.
 */
export type RoundEmailMarks = {
  motto: string | null;
  signOff: string | null;
  /** "Round 15 goes out Fri 20 Nov.", when there is a next round to promise. */
  nextLine: string | null;
  seal: { kind: "wax"; src: string } | { kind: "postmark"; src: string; round: string; day: string; year: string } | null;
  divider: EmailDividerStrip | null;
};

/** A loop's marks for one delivered round's email. */
export function emailMarksOf(
  group: Partial<LoopMarks> & { themePreset: string | null; themeMascot: string | null; timezone: string },
  round: { number: number; deliveredAt: Date },
  next: { number: number; deliversAt: Date } | null,
): RoundEmailMarks {
  const marks = marksOf(group);
  const mascot = group.themeMascot ?? "";
  const { day, year } = postmarkDate(round.deliveredAt, group.timezone);
  return {
    motto: marks.motto,
    signOff: marks.signOff,
    nextLine:
      marks.signOff && next
        ? text(copy.issue.signOffNext, { round: text(copy.issue.round, { number: next.number }), date: formatDate(next.deliversAt, group.timezone) })
        : null,
    seal:
      marks.sealStyle === "wax"
        ? { kind: "wax", src: sealPng(mascot, marks.sealColor ?? "") }
        : marks.sealStyle === "postmark"
          ? { kind: "postmark", src: stampPng(mascot), round: text(copy.issue.round, { number: round.number }), day, year }
          : null,
    divider: emailDividerStrip(marks.divider, group.themePreset),
  };
}

/** The round that opens as an issue goes out, for one contributor. */
export type NextRoundBlock = {
  issueNumber: number;
  /** Their own reply link. */
  url: string;
  deadlineLabel: string;
  questions: string[];
};

export type EmailTheme = {
  palette: EmailPalette;
  headerImageUrl?: string | null;
  mascot?: string | null;
  /** The loop's page pattern as a PNG tile; absent means gingham's stripes. */
  pattern?: EmailPatternTile | null;
};

/** What an email needs from a loop to wear its stationery. */
export function emailThemeOf(group: {
  themePreset: string | null;
  themeAccent: string | null;
  /** Required, so a caller that selects only some columns can't quietly fall back to gingham. */
  themeBackground: string | null;
  headerImageUrl: string | null;
  themeMascot?: string | null;
}): EmailTheme {
  return {
    palette: emailPalette({ preset: group.themePreset, accent: group.themeAccent }),
    headerImageUrl: group.headerImageUrl,
    mascot: group.themeMascot,
    pattern: emailPatternTile(group.themeBackground, group.themePreset),
  };
}

export type SectionEmailBlock = {
  title: string;
  emoji: string | null;
  answers: Array<{
    author: string;
    authorCharm?: string | null;
    body: string;
    linkUrl?: string | null;
    /** The pick's name when the provider told us; the link alone otherwise. */
    linkTitle?: string | null;
    addedLater?: boolean;
    photoCount?: number;
    /** The sticker its author stuck on it, beside their name. */
    sticker?: string | null;
  }>;
};

export type AnswerBlock = {
  question: string;
  author: string;
  /** A sticker beside their name. With images off, the name simply stands alone. */
  authorCharm?: string | null;
  body: string;
  photoUrl?: string | null;
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  addedLater?: boolean;
  /** A poll's tally. The same for every voter, so it is shown once per question. */
  pollResults?: string | null;
  /** The sticker its author stuck on it, beside their name. Decoration, like the charm. */
  sticker?: string | null;
};

type QuestionGroup = { question: string; pollResults: string | null; answers: AnswerBlock[] };

/** Answers arrive one row per person; the email reads one heading per question. */
function byQuestion(answers: AnswerBlock[]): QuestionGroup[] {
  const groups = new Map<string, QuestionGroup>();
  for (const answer of answers) {
    const group = groups.get(answer.question) ?? { question: answer.question, pollResults: null, answers: [] };
    group.pollResults ??= answer.pollResults ?? null;
    group.answers.push(answer);
    groups.set(answer.question, group);
  }
  return [...groups.values()];
}

const MUSIC_HOSTS: Array<[RegExp, keyof typeof copy.emails.musicProviders]> = [
  [/(^|\.)spotify\.com$/, "spotify"],
  [/(^|\.)bandcamp\.com$/, "bandcamp"],
  [/(^|\.)qobuz\.com$/, "qobuz"],
];

/** "Open in Spotify" where the link says where it goes; a plain "Open the link" otherwise. */
export function musicLinkLabel(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return copy.emails.openLink;
  }
  const match = MUSIC_HOSTS.find(([pattern]) => pattern.test(host));
  return match ? text(copy.emails.openIn, { provider: copy.emails.musicProviders[match[1]] }) : copy.emails.openLink;
}

const BODY_FONT = "Nunito,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
// Web fonts don't reach most inboxes, so this asks for the handwriting each system
// already ships (Comic Sans is deliberately not on the list) and lands on a rounded
// sans anywhere that has none. No image, no remote font, and it reads with both off.
const DISPLAY_FONT = "'Noteworthy','Chalkboard SE','Segoe Print','Bradley Hand',ui-rounded,'Arial Rounded MT Bold','Varela Round',Nunito,'Trebuchet MS',sans-serif";
/**
 * The loop's page behind the letter. A pattern is a PNG tile from the app's own
 * address; gingham is two gradients. Either way, a client that shows neither (or has
 * images off) still gets the loop's page colour.
 */
function pageBackground(c: EmailPalette, pattern: EmailPatternTile | null | undefined): string {
  if (pattern) {
    return `background-color:${c.page};background-image:url('${appUrl()}${pattern.path}');background-size:${pattern.width}px ${pattern.height}px;background-repeat:repeat`;
  }
  return `background-color:${c.page};background-image:linear-gradient(90deg,${c.check} 50%,transparent 0),linear-gradient(${c.check} 50%,transparent 0);background-size:32px 32px`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headerImage(url: string | null | undefined, c: EmailPalette): string {
  if (!url) return "";
  // Decorative, and many clients block remote images until asked: the brand line
  // below carries the identity, and the fallback fill keeps the space tidy.
  return `<tr><td style="padding:0 0 20px"><img src="${escapeHtml(url)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;background:${c.line};border:1px solid ${c.line};border-radius:6px" /></td></tr>
`;
}

function paragraphs(lines: string[], c: EmailPalette): string {
  return lines
    .map(
      (line) =>
        `<p style="margin:0 0 18px;font:400 16px/1.6 ${BODY_FONT};color:${c.soft}">${escapeHtml(line)}</p>`,
    )
    .join("");
}

function sectionsHtml(sections: SectionEmailBlock[], c: EmailPalette): string {
  if (sections.length === 0) return "";
  return sections
    .map((section) => {
      const rows = section.answers
        .map((answer) => {
          const link = answer.linkUrl
            ? ` ${answer.linkTitle ? `<strong>${escapeHtml(answer.linkTitle)}</strong> ` : ""}<a href="${escapeHtml(answer.linkUrl)}" style="color:${c.accent}">${escapeHtml(musicLinkLabel(answer.linkUrl))}</a>`
            : "";
          const photos =
            answer.photoCount && answer.photoCount > 0
              ? ` <span style="color:${c.muted}">${escapeHtml(copy.emails.photosAdded.replace("{count}", String(answer.photoCount)))}</span>`
              : "";
          return `<div style="margin:10px 0 0;font:400 15px/1.6 ${BODY_FONT};color:${c.ink}"><span style="font:800 13px/1.5 ${BODY_FONT};color:${c.soft}">${escapeHtml(answer.author)}${charmImage(answer.authorCharm)}${answerSticker(answer.sticker)}</span> ${escapeHtml(answer.body)}${link}${photos}</div>`;
        })
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:${c.card};border:1px dashed ${c.lineStrong};border-radius:6px"><tr><td style="padding:20px 22px">
  <h2 style="margin:0;font:700 20px/1.2 ${DISPLAY_FONT};color:${c.ink}">${escapeHtml(`${section.emoji ?? ""} ${section.title}`.trim())}</h2>
  ${rows || `<div style="margin:10px 0 0;font:400 14px/1.5 ${BODY_FONT};color:${c.muted}">${escapeHtml(copy.emails.sectionEmpty)}</div>`}
</td></tr></table>`;
    })
    .join("");
}

/** Email can't be trusted with SVG, so the drawings go out as PNGs from the app's own address. */
function stickerImage(key: string, size: number, align: string): string {
  return `<img src="${escapeHtml(`${appUrl()}${stickerPng(key)}`)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border:0;vertical-align:${align}" />`;
}

function charmImage(charm: string | null | undefined): string {
  return isCharmKey(charm) ? ` ${stickerImage(charm, 18, "-3px")}` : "";
}

/** A sticker someone stuck on their answer: a little bigger than the charm, beside the name. */
function answerSticker(sticker: string | null | undefined): string {
  return isStickerKey(sticker) ? ` ${stickerImage(sticker, 24, "-7px")}` : "";
}

/** "Who's here this round": each name and their line, as a plain table near the top. */
function rollCallHtml(entries: EmailRollCallEntry[] | undefined, c: EmailPalette): string {
  if (!entries || entries.length === 0) return "";
  const rows = entries
    .map((entry) => `<tr><td valign="top" style="padding:5px 12px 5px 0;font:800 14px/1.45 ${BODY_FONT};color:${c.soft};white-space:nowrap">${escapeHtml(entry.name)}</td><td valign="top" style="padding:5px 0;font:400 14px/1.45 ${BODY_FONT};color:${c.ink}">${escapeHtml(entry.line)}</td></tr>`)
    .join("");
  return `<tr><td style="padding-top:20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border:1px solid ${c.line};border-radius:6px"><tr><td style="padding:20px 22px 16px">
<h2 style="margin:0 0 6px;font:700 22px/1.2 ${DISPLAY_FONT};color:${c.ink}">${escapeHtml(copy.emails.rollCallTitle)}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
</td></tr></table></td></tr>
`;
}

/** The signed card: each signature's picture with the name under it, three to a row. */
function signedHtml(signed: LayoutInput["signed"], c: EmailPalette): string {
  if (!signed || signed.signatures.length === 0) return "";
  const cells = signed.signatures.map((signature) =>
    `<td align="center" valign="bottom" style="padding:10px 12px 4px;text-align:center"><img src="${escapeHtml(signature.src)}" alt="${escapeHtml(text(copy.signatures.signed, { name: signature.name }))}" width="${signature.width}" height="${signature.height}" style="display:block;margin:0 auto;width:${signature.width}px;height:${signature.height}px;border:0" /><div style="margin:2px 0 0;font:800 12px/1.4 ${BODY_FONT};color:${c.muted}">${escapeHtml(signature.name)}</div></td>`);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 3) rows.push(`<tr>${cells.slice(i, i + 3).join("")}</tr>`);
  return `<tr><td style="padding-top:20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border:1px solid ${c.line};border-radius:6px"><tr><td align="center" style="padding:20px 18px 16px;text-align:center">
<h2 style="margin:0;font:700 24px/1.2 ${DISPLAY_FONT};color:${c.ink};text-align:center">${escapeHtml(copy.emails.signedTitle)}</h2>
<p style="margin:4px 0 0;font:400 13px/1.5 ${BODY_FONT};color:${c.muted};text-align:center">${escapeHtml(signed.note)}</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:6px auto 0">${rows.join("")}</table>
</td></tr></table></td></tr>
`;
}

/** The cherries stay the emoji they've always been, which show even with images off. */
function mascotMark(mascot: string | null | undefined): string {
  if (isMascotKey(mascot) && mascot !== DEFAULT_MASCOT) return stickerImage(mascot, 24, "-5px");
  return `<span style="font-size:22px;vertical-align:-1px">${copy.common.cherry}</span>`;
}

/** The loop's divider as a strip of its PNG tile; with images off it simply isn't there. */
function dividerStripHtml(strip: EmailDividerStrip): string {
  return `<div style="height:${strip.height}px;line-height:${strip.height}px;font-size:0;margin:16px 0 0;background-image:url('${escapeHtml(`${appUrl()}${strip.path}`)}');background-repeat:repeat-x;background-position:center;background-size:${strip.width}px ${strip.height}px">&nbsp;</div>`;
}

function answersHtml(answers: AnswerBlock[], url: string, c: EmailPalette, strip: EmailDividerStrip | null = null): string {
  return byQuestion(answers)
    .map((group) => {
      const results = group.pollResults
        ? `<div style="margin:10px 0 0;font:700 13px/1.5 ${BODY_FONT};color:${c.muted}">${escapeHtml(group.pollResults)}</div>`
        : "";
      const rows = group.answers
        .map((answer, index) => {
          const photo = answer.photoUrl
            ? `<img src="${escapeHtml(answer.photoUrl)}" alt="${escapeHtml(text(copy.a11yLabels.photoFrom, { name: answer.author }))}" width="520" style="display:block;width:100%;max-width:520px;border:1px solid ${c.line};border-radius:6px;margin:14px 0 0" />`
            : "";
          // Email never attempts to play audio; the web issue is the canonical player.
          const voice = answer.audioUrl
            ? `<div style="margin:14px 0 0;border:1px dashed ${c.lineStrong};border-radius:6px;padding:10px 12px;font:400 13px/1.5 ${BODY_FONT};color:${c.soft}">${escapeHtml(copy.emails.voiceNote.replace("{duration}", formatAudioDuration(answer.audioDurationMs ?? 0)))}. <a href="${escapeHtml(url)}" style="color:${c.accent}">${escapeHtml(copy.emails.voiceNoteListen)}</a></div>`
            : "";
          const note = answer.addedLater
            ? `<div style="font:400 12px/1.5 ${BODY_FONT};color:${c.muted};margin-top:10px">${escapeHtml(copy.emails.addedLater)}</div>`
            : "";
          if (index > 0 && strip) {
            return `${dividerStripHtml(strip)}<div style="margin:12px 0 0">
  <div style="font:800 14px/1.5 ${BODY_FONT};color:${c.soft};margin:0 0 4px">${escapeHtml(answer.author)}${charmImage(answer.authorCharm)}${answerSticker(answer.sticker)}</div>
  <div style="font:400 16px/1.65 ${BODY_FONT};color:${c.ink};white-space:pre-wrap">${escapeHtml(answer.body)}</div>
  ${photo}${voice}${note}
</div>`;
          }
          const divider = index > 0 ? `border-top:1px dashed ${c.line};padding-top:14px;` : "";
          return `<div style="${divider}margin:16px 0 0">
  <div style="font:800 14px/1.5 ${BODY_FONT};color:${c.soft};margin:0 0 4px">${escapeHtml(answer.author)}${charmImage(answer.authorCharm)}${answerSticker(answer.sticker)}</div>
  <div style="font:400 16px/1.65 ${BODY_FONT};color:${c.ink};white-space:pre-wrap">${escapeHtml(answer.body)}</div>
  ${photo}${voice}${note}
</div>`;
        })
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:${c.card};border:1px solid ${c.line};border-radius:6px"><tr><td style="padding:22px 22px 20px">
  <h2 style="margin:0;font:700 25px/1.2 ${DISPLAY_FONT};color:${c.ink}">${escapeHtml(group.question)}</h2>
  ${results}${rows}
</td></tr></table>`;
    })
    .join("");
}

/** Privacy and terms, under every email's footer. */
function legalLinks(c: EmailPalette): string {
  const link = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" style="color:${c.muted};text-decoration:underline">${escapeHtml(label)}</a>`;
  return `<p style="margin:8px 0 0;font:400 12px/1.6 ${BODY_FONT};color:${c.muted};text-align:center">${link(appLink("/privacy"), copy.legal.privacyLink)} · ${link(appLink("/terms"), copy.legal.termsLink)}</p>`;
}

function codeBlock(code: LayoutInput["code"], c: EmailPalette): string {
  if (!code) return "";
  // One run of digits, spaced by letter-spacing rather than a space, so it copies clean.
  return `<p style="margin:22px 0 10px;font:400 15px/1.6 ${BODY_FONT};color:${c.soft}">${escapeHtml(code.label)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="padding:12px 18px;background:${c.page};border:1px dashed ${c.lineStrong};border-radius:6px;font:700 30px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:8px;color:${c.ink}">${escapeHtml(code.value)}</td></tr></table>
<p style="margin:0;font:400 13px/1.6 ${BODY_FONT};color:${c.muted}">${escapeHtml(code.note)}</p>`;
}

function questionList(questions: LayoutInput["questions"], c: EmailPalette): string {
  if (!questions || questions.items.length === 0) return "";
  const rows = questions.items
    .map((item) => `<tr><td style="padding:12px 0;border-top:1px dashed ${c.lineStrong};font:700 20px/1.25 ${DISPLAY_FONT};color:${c.ink}">${escapeHtml(item)}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr><td style="padding:0 0 8px;font:800 14px/1.4 ${BODY_FONT};color:${c.soft}">${escapeHtml(questions.label)}</td></tr>${rows}</table>`;
}

/** The round that just opened, under a delivered issue: its questions and the way in. */
function nextRoundHtml(next: NextRoundBlock, c: EmailPalette): string {
  const content = copy.emails.delivery;
  const values = { issueHeading: issueHeading(next.issueNumber, null), deadlineLabel: next.deadlineLabel };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border:1px solid ${c.line};border-radius:6px;box-shadow:${c.shadow}"><tr><td style="padding:24px 30px 26px">
<h2 style="margin:0 0 8px;font:700 24px/1.2 ${DISPLAY_FONT};color:${c.ink}">${escapeHtml(text(content.nextHeading, values))}</h2>
${paragraphs([text(content.nextBody, values)], c)}${questionList({ label: copy.emails.promptQuestionsLabel, items: next.questions }, c)}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 0"><tr><td style="border-radius:999px;background:${c.accent}"><a href="${escapeHtml(next.url)}" style="display:inline-block;padding:15px 26px;font:700 16px/1 ${BODY_FONT};color:${c.onAccent};text-decoration:none;border-radius:999px">${escapeHtml(content.nextCta)}</a></td></tr></table>
</td></tr></table>`;
}

/** Postmark ink, readable on any preset's card. */
const POSTMARK_INK = "#4a5272";

/** The seal or the stamp, centred at the top of the round's card. */
function sealHtml(seal: RoundEmailMarks["seal"]): string {
  if (!seal) return "";
  const src = escapeHtml(`${appUrl()}${seal.src}`);
  if (seal.kind === "wax") {
    return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 6px"><tr><td align="center"><img src="${src}" alt="" width="${EMAIL_SEAL_SIZE}" height="${EMAIL_SEAL_SIZE}" style="display:block;width:${EMAIL_SEAL_SIZE}px;height:${EMAIL_SEAL_SIZE}px;border:0" /></td></tr></table>`;
  }
  // A picture can't know the round or the day, so the cancellation beside the stamp is real text.
  const ring = `<td width="76" height="76" align="center" valign="middle" style="width:76px;height:76px;border:2px solid ${POSTMARK_INK};border-radius:50%;font:800 10px/1.35 ${BODY_FONT};color:${POSTMARK_INK};letter-spacing:.5px;text-transform:uppercase;text-align:center">${escapeHtml(seal.round)}<br /><span style="font-size:13px">${escapeHtml(seal.day)}</span><br />${escapeHtml(seal.year)}</td>`;
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 10px"><tr><td valign="middle" style="padding:0 10px 0 0"><img src="${src}" alt="" width="${EMAIL_STAMP.width}" height="${EMAIL_STAMP.height}" style="display:block;width:${EMAIL_STAMP.width}px;height:${EMAIL_STAMP.height}px;border:0" /></td>${ring}</tr></table>`;
}

/** The size a cover's sticker is drawn at in email: the PNG is 96px, so it stays crisp. */
const EMAIL_COVER_STICKER = 72;

/**
 * A named round's cover at the top of its email: the tint as a flat band (a pattern
 * would need an image, and the colour alone carries it), the round's number, its
 * sticker as a PNG and its name in the tint's ink. With images off, the words stand.
 */
function coverHtml(cover: NonNullable<LayoutInput["cover"]>, heading: string): string {
  const { look, chip } = cover;
  const src = escapeHtml(`${appUrl()}${stickerPng(look.sticker)}`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${look.color}" style="margin:0 0 16px;background:${look.color};border-radius:6px"><tr><td align="center" style="padding:16px 18px 20px;text-align:center">
<p style="margin:0 0 8px;font:800 11px/1.4 ${BODY_FONT};letter-spacing:1px;text-transform:uppercase;color:${look.ink};text-align:center">${escapeHtml(chip)}</p>
<img src="${src}" alt="" width="${EMAIL_COVER_STICKER}" height="${EMAIL_COVER_STICKER}" style="display:block;margin:0 auto;width:${EMAIL_COVER_STICKER}px;height:${EMAIL_COVER_STICKER}px;border:0" />
<h1 style="margin:10px 0 0;font:700 32px/1.15 ${DISPLAY_FONT};color:${look.ink};text-align:center">${escapeHtml(heading)}</h1>
</td></tr></table>
`;
}

/** The closing card: the mascot, the owner's sign-off, and when the next round goes out. */
function signOffHtml(marks: RoundEmailMarks, mascot: string | null | undefined, c: EmailPalette): string {
  if (!marks.signOff) return "";
  const next = marks.nextLine ? `<p style="margin:8px 0 0;font:700 13px/1.5 ${BODY_FONT};color:${c.muted};text-align:center">${escapeHtml(marks.nextLine)}</p>` : "";
  return `<tr><td style="padding-top:20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border:1px solid ${c.line};border-radius:6px"><tr><td align="center" style="padding:20px 22px 18px;text-align:center">
<div style="font-size:30px;line-height:1">${mascotMark(mascot)}</div>
<p style="margin:8px 0 0;font:700 26px/1.2 ${DISPLAY_FONT};color:${c.accent};text-align:center">${escapeHtml(marks.signOff)}</p>${next}
</td></tr></table></td></tr>`;
}

export function layout({ preheader, heading, body, cta, footer, answers, sections, answersUrl, theme, unsubscribeUrl, sender, questions, replyHint, code, next, marks, rollCall, signed, cover }: LayoutInput): string {
  const c = theme?.palette ?? GINGHAM_EMAIL;
  const PAGE = pageBackground(c, theme?.pattern);
  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px"><tr><td style="border-radius:999px;background:${c.accent}"><a href="${escapeHtml(
        cta.url,
      )}" style="display:inline-block;padding:15px 26px;font:700 16px/1 ${BODY_FONT};color:${c.onAccent};text-decoration:none;border-radius:999px">${escapeHtml(
        cta.label,
      )}</a></td></tr></table>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;${PAGE}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${PAGE}"><tr><td align="center" style="padding:36px 14px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
${headerImage(theme?.headerImageUrl, c)}<tr><td style="padding:0 8px ${marks?.motto ? 2 : 20}px;font:700 22px/1.2 ${DISPLAY_FONT};color:${c.ink}">${mascotMark(theme?.mascot)} ${escapeHtml(sender ?? copy.common.brand)}</td></tr>${marks?.motto ? `\n<tr><td style="padding:0 8px 20px;font:700 17px/1.3 ${DISPLAY_FONT};color:${c.accent}">${escapeHtml(marks.motto)}</td></tr>` : ""}
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border:1px solid ${c.line};border-radius:6px;box-shadow:${c.shadow}"><tr><td style="padding:0 30px 30px">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:-11px 0 20px;position:relative;z-index:2;transform:rotate(-2deg);opacity:.92;clip-path:polygon(0 0,100% 0,97% 25%,100% 50%,97% 75%,100% 100%,0 100%,3% 75%,0 50%,3% 25%)"><tr><td width="88" height="22" style="width:88px;height:22px;background-color:${c.tape};background-image:radial-gradient(circle,rgba(255,255,255,.85) 1.8px,transparent 2.3px);background-size:9px 9px"></td></tr></table>
${marks ? sealHtml(marks.seal) : ""}${cover ? coverHtml(cover, heading) : `<h1 style="margin:0 0 14px;padding:0 0 12px;border-bottom:2px dashed ${c.lineStrong};font:700 32px/1.15 ${DISPLAY_FONT};color:${c.ink}">${escapeHtml(heading)}</h1>
`}${paragraphs(body, c)}${questionList(questions, c)}${ctaHtml}${codeBlock(code, c)}${replyHint ? `<p style="margin:14px 0 0;font:400 13px/1.6 ${BODY_FONT};color:${c.muted}">${escapeHtml(copy.emails.replyHint)}</p>` : ""}
</td></tr></table>
</td></tr>
${rollCallHtml(rollCall, c)}${answers ? `<tr><td style="padding-top:20px">${answersHtml(answers, answersUrl ?? "#", c, marks?.divider ?? null)}</td></tr>` : ""}
${sections && sections.length > 0 ? `<tr><td style="padding-top:20px">${sectionsHtml(sections, c)}</td></tr>` : ""}
${signedHtml(signed, c)}${marks ? signOffHtml(marks, theme?.mascot, c) : ""}${next ? `<tr><td style="padding-top:20px">${nextRoundHtml(next, c)}</td></tr>` : ""}
<tr><td align="center" style="padding:20px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border:1px solid ${c.line};border-radius:6px"><tr><td align="center" style="padding:14px 18px"><p style="margin:0;font:400 13px/1.6 ${BODY_FONT};color:${c.soft};text-align:center">${escapeHtml(
    footer ?? copy.emails.defaultFooter,
  )}${
    unsubscribeUrl
      ? `<br /><a href="${escapeHtml(unsubscribeUrl)}" style="color:${c.muted};text-decoration:underline">${escapeHtml(copy.emails.stopLink)}</a>`
      : ""
  }</p>${legalLinks(c)}</td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
}

export type RenderedEmail = { subject: string; html: string; text: string };

/** The plain-text twin of the footer's legal links. */
function legalText(): string {
  return `${copy.legal.privacyLink}: ${appLink("/privacy")}\n${copy.legal.termsLink}: ${appLink("/terms")}`;
}

/** The plain-text twin of the footer: the stop link, when there is one, then the legal links. */
function withStopLine(body: string, unsubscribeUrl: string | undefined): string {
  const stop = unsubscribeUrl ? `\n\n${text(copy.emails.stopText, { url: unsubscribeUrl })}` : "";
  return `${body}${stop}\n\n${legalText()}`;
}

export function signInEmail(url: string, code: string): RenderedEmail {
  const content = copy.emails.signIn;
  const values = { url, code, note: content.note };
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: content.heading,
      body: [content.body],
      cta: { label: content.cta, url },
      code: { label: content.codeLabel, value: code, note: content.note },
      footer: content.footer,
    }),
    text: withStopLine(text(content.text, values), undefined),
  };
}

/** The sign-in email for someone who asked to join a loop from its invite link. */
export function joinEmail(groupName: string, url: string, code: string): RenderedEmail {
  const content = copy.emails.join;
  const values = { groupName, url, code, note: content.note };
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: text(content.heading, values),
      body: [text(content.body, values)],
      cta: { label: text(content.cta, values), url },
      code: { label: content.codeLabel, value: code, note: content.note },
      footer: content.footer,
    }),
    text: withStopLine(text(content.text, values), undefined),
  };
}

export function inviteEmail(input: {
  groupName: string;
  inviterName: string;
  url: string;
  isReader: boolean;
  personalNote?: string;
  theme?: EmailTheme;
  unsubscribeUrl?: string;
}): RenderedEmail {
  const { groupName, inviterName, url, isReader, personalNote, theme, unsubscribeUrl } = input;
  const content = copy.emails.invite;
  const values = { groupName, inviterName, url, personalNote: personalNote ?? "" };
  const note = personalNote?.trim()
    ? text(content.personalNote, values)
    : null;
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: isReader ? content.preheaderReader : content.preheaderContributor,
      heading: text(content.heading, values),
      body: [text(content.body, values), isReader ? content.readerBody : content.contributorBody, ...(note ? [note] : [])],
      cta: { label: isReader ? content.readerCta : content.contributorCta, url },
      replyHint: !isReader,
      footer: text(content.footer, values),
      sender: groupName,
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(`${text(content.text, values)}${note ? `\n\n${note}` : ""}${isReader ? "" : `\n\n${copy.emails.replyHint}`}`, unsubscribeUrl),
  };
}

export function promptEmail(input: {
  groupName: string;
  memberName: string;
  issueNumber: number;
  questionCount: number;
  issueName?: string | null;
  url: string;
  deadlineLabel: string;
  /** The questions themselves: the reason to tap the button. */
  questions?: string[];
  theme?: EmailTheme;
  unsubscribeUrl?: string;
}): RenderedEmail {
  const { groupName, memberName, issueNumber, issueName, questionCount, url, deadlineLabel, questions, theme, unsubscribeUrl } = input;
  const content = copy.emails.prompt;
  const plural = questionCount === 1 ? copy.emails.questionSingular : copy.emails.questionPlural;
  const values = {
    groupName, memberName, issueNumber, questionCount, url, deadlineLabel, plural,
    issueRef: issueRef(issueNumber, issueName),
    issueHeading: issueHeading(issueNumber, issueName),
  };
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: text(content.heading, values),
      body: [text(content.body, values), content.writingNote],
      questions: questions?.length ? { label: copy.emails.promptQuestionsLabel, items: questions } : undefined,
      cta: { label: text(content.cta, values), url },
      replyHint: true,
      footer: text(content.footer, values),
      sender: groupName,
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(
      `${text(content.text, values)}${questions?.length ? `\n\n${copy.emails.promptQuestionsLabel}:\n${questions.map((question) => `- ${question}`).join("\n")}` : ""}\n\n${copy.emails.replyHint}`,
      unsubscribeUrl,
    ),
  };
}

export function reminderEmail(input: {
  groupName: string;
  memberName: string;
  url: string;
  deadlineLabel: string;
  remaining: number;
  theme?: EmailTheme;
  unsubscribeUrl?: string;
}): RenderedEmail {
  const { groupName, memberName, url, deadlineLabel, remaining, theme, unsubscribeUrl } = input;
  const content = copy.emails.reminder;
  const values = { groupName, memberName, url, deadlineLabel, remaining, prefNote: content.prefNote };
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: text(content.heading, values),
      body: [text(remaining === 1 ? content.bodySingular : content.bodyPlural, values), content.writingNote, content.prefNote],
      cta: { label: content.cta, url },
      replyHint: true,
      footer: text(content.footer, values),
      sender: groupName,
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(`${text(content.text, values)}\n\n${copy.emails.replyHint}`, unsubscribeUrl),
  };
}

export function mentionEmail(input: {
  groupName: string;
  memberName: string;
  authorName: string;
  issueNumber: number;
  issueName?: string | null;
  excerpt: string;
  url: string;
  theme?: EmailTheme;
  unsubscribeUrl?: string;
}): RenderedEmail {
  const { groupName, memberName, authorName, issueNumber, issueName, excerpt, url, theme, unsubscribeUrl } = input;
  const content = copy.emails.mention;
  const values = { groupName, memberName, authorName, issueNumber, excerpt, url, issueRef: issueRef(issueNumber, issueName) };
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: text(content.heading, values),
      body: [text(content.body, values), `"${excerpt}"`],
      cta: { label: content.cta, url },
      footer: text(content.footer, values),
      sender: groupName,
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(text(content.text, values), unsubscribeUrl),
  };
}

export function deliveryEmail(input: {
  groupName: string;
  issueNumber: number;
  issueName?: string | null;
  url: string;
  answers: AnswerBlock[];
  sections?: SectionEmailBlock[];
  shareUrl?: string | null;
  /** Contributors only: the next round's questions ride along under the issue. */
  next?: NextRoundBlock;
  theme?: EmailTheme;
  unsubscribeUrl?: string;
  /** The owner's motto, seal, divider and sign-off (`emailMarksOf`). */
  marks?: RoundEmailMarks;
  /** Everyone's line this round, for the roll call at the top. */
  rollCall?: EmailRollCallEntry[];
  /** The signatures of those who wrote, for the signed card at the end. */
  signatures?: EmailSignature[];
  /** A named round's cover (`coverOf`), at the top in place of the plain heading. */
  cover?: RoundCover | null;
}): RenderedEmail {
  const { groupName, issueNumber, issueName, url, answers, sections, shareUrl, next, theme, unsubscribeUrl, marks, rollCall, signatures, cover } = input;
  const content = copy.emails.delivery;
  const values = {
    groupName,
    issueNumber,
    issueRef: issueRef(issueNumber, issueName),
    issueHeading: issueHeading(issueNumber, issueName),
    url,
    shareUrl: shareUrl ?? "",
    count: answers.length,
    plural: answers.length === 1 ? copy.emails.answerSingular : copy.emails.answerPlural,
  };
  const answerText = byQuestion(answers)
    .map((group) =>
      [
        group.question,
        ...(group.pollResults ? [group.pollResults] : []),
        ...group.answers.map((answer) => text(content.textAnswer, { author: answer.author, body: answer.body })),
      ].join("\n"),
    )
    .join("\n\n");
  const rollCallText = rollCall && rollCall.length > 0
    ? `${copy.emails.rollCallTitle}\n${rollCall.map((entry) => text(copy.emails.rollCallText, entry)).join("\n")}\n\n`
    : "";
  const signedText = signatures && signatures.length > 0
    ? `\n\n${text(copy.emails.signedText, { names: signatures.map((signature) => signature.name).join(", ") })}`
    : "";
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: text(content.heading, values),
      body: [content.body],
      answers,
      sections,
      answersUrl: url,
      cta: { label: content.cta, url },
      next,
      footer: text(shareUrl ? content.shareFooter : content.replyFooter, values),
      sender: groupName,
      theme,
      unsubscribeUrl,
      marks,
      rollCall,
      signed: signatures && signatures.length > 0
        ? { note: text(copy.signatures.cardNote, { round: text(copy.issue.round, { number: issueNumber }) }), signatures }
        : undefined,
      cover: cover && issueName?.trim() ? { look: cover, chip: text(copy.emails.roundHeading, { number: issueNumber }) } : undefined,
    }),
    text: withStopLine(`${roundText(text(content.text, { ...values, answers: `${rollCallText}${answerText}${signedText}` }), marks)}${next ? `\n\n${nextRoundText(next)}` : ""}`, unsubscribeUrl),
  };
}

/** The plain-text round with the owner's words: the motto under its first line, the sign-off at its end. */
function roundText(body: string, marks: RoundEmailMarks | undefined): string {
  if (!marks) return body;
  const [first, ...rest] = body.split("\n");
  const withMotto = marks.motto ? [first, marks.motto, ...rest].join("\n") : body;
  const closing = marks.signOff ? `\n\n${[marks.signOff, marks.nextLine].filter(Boolean).join("\n")}` : "";
  return `${withMotto}${closing}`;
}

function nextRoundText(next: NextRoundBlock): string {
  const content = copy.emails.delivery;
  const values = { issueHeading: issueHeading(next.issueNumber, null), deadlineLabel: next.deadlineLabel };
  return [
    text(content.nextHeading, values),
    text(content.nextBody, values),
    `${copy.emails.promptQuestionsLabel}:\n${next.questions.map((question) => `- ${question}`).join("\n")}`,
    next.url,
  ].join("\n\n");
}

export function pausedEmail(input: { groupName: string; url: string; theme?: EmailTheme; unsubscribeUrl?: string }): RenderedEmail {
  const { groupName, url, theme, unsubscribeUrl } = input;
  const content = copy.emails.paused;
  const values = { groupName, url };
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: content.preheader,
      heading: content.heading,
      body: [text(content.body, values), content.resumeBody],
      cta: { label: content.cta, url },
      footer: text(content.footer, values),
      sender: groupName,
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(text(content.text, values), unsubscribeUrl),
  };
}

/** The link that moves an account to a new address. Only that inbox can use it. */
export function emailChangeEmail(url: string): RenderedEmail {
  const content = copy.emails.emailChange;
  return {
    subject: content.subject,
    html: layout({ preheader: content.preheader, heading: content.heading, body: [content.body], cta: { label: content.cta, url }, footer: copy.emails.signIn.footer }),
    text: withStopLine(text(content.text, { body: content.body, url }), undefined),
  };
}

/** Told to the old address, so a change nobody asked for doesn't go unnoticed. */
export function emailChangedEmail(input: { newEmail: string }): RenderedEmail {
  const content = copy.emails.emailChanged;
  const body = text(content.body, { newEmail: input.newEmail, contact: copy.legal.contactEmail });
  return {
    subject: content.subject,
    html: layout({ preheader: content.preheader, heading: content.heading, body: [body], footer: copy.emails.signIn.footer }),
    text: withStopLine(`${content.heading}\n\n${body}`, undefined),
  };
}

/** A note from the corner button, for whoever runs this instance. */
/** To whoever runs this instance: the day's email is running low, or loop mail is waiting. */
export function budgetAlertEmail(input: { level: "near" | "reached"; used: number; allowance: number; budget: number }): RenderedEmail {
  const content = copy.emails.budgetAlert[input.level];
  const values = { used: input.used, allowance: input.allowance, budget: input.budget };
  const body = [text(content.body, values), copy.emails.budgetAlert.fix];
  return {
    subject: text(content.subject, values),
    html: layout({ preheader: text(content.subject, values), heading: content.heading, body, footer: copy.emails.signIn.footer }),
    text: withStopLine(body.join("\n\n"), undefined),
  };
}

export function feedbackEmail(input: { message: string; from: string; path: string | null }): RenderedEmail {
  const content = copy.emails.feedback;
  const values = { from: input.from, path: input.path ?? "?" };
  return {
    subject: text(content.subject, values),
    html: layout({ preheader: input.message.slice(0, 90), heading: content.heading, body: [text(content.meta, values), input.message], footer: copy.emails.signIn.footer }),
    text: withStopLine(`${text(content.meta, values)}\n\n${input.message}`, undefined),
  };
}
