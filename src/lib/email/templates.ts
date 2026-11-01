/**
 * Friendloop's stationery, adapted for email clients: tables, inline styles,
 * solid-color fallbacks, and no required images or remote fonts.
 */

import { copy, text } from "../copy.ts";
import { formatAudioDuration } from "../audio-validation.ts";

type LayoutInput = {
  preheader: string;
  heading: string;
  body: string[];
  cta?: { label: string; url: string };
  footer?: string;
  answers?: AnswerBlock[];
  /** Where "listen on the web issue" points for voice notes. */
  answersUrl?: string;
};

export type AnswerBlock = {
  question: string;
  author: string;
  body: string;
  photoUrl?: string | null;
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  addedLater?: boolean;
};

const COLORS = {
  page: "#fff3f5",
  check: "rgba(236,118,148,.15)",
  card: "#fffdfa",
  line: "#f1dae0",
  lineStrong: "#e4bcc6",
  ink: "#3d2a30",
  soft: "#674d55",
  muted: "#86676f",
  accent: "#cc3456",
  tape: "#f6a6ba",
};
const BODY_FONT = "Nunito,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const DISPLAY_FONT = "Gaegu,Comic Sans MS,Chalkboard SE,cursive";
const GINGHAM = `background-color:${COLORS.page};background-image:linear-gradient(90deg,${COLORS.check} 50%,transparent 0),linear-gradient(${COLORS.check} 50%,transparent 0);background-size:32px 32px`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(lines: string[]): string {
  return lines
    .map(
      (line) =>
        `<p style="margin:0 0 18px;font:400 16px/1.6 ${BODY_FONT};color:${COLORS.soft}">${escapeHtml(line)}</p>`,
    )
    .join("");
}

function answersHtml(answers: AnswerBlock[], url: string): string {
  return answers
    .map((answer) => {
      const photo = answer.photoUrl
        ? `<img src="${escapeHtml(answer.photoUrl)}" alt="" width="520" style="display:block;width:100%;max-width:520px;border:1px solid ${COLORS.line};border-radius:6px;margin:14px 0 0" />`
        : "";
      // Email never attempts to play audio; the web issue is the canonical player.
      const voice = answer.audioUrl
        ? `<div style="margin:14px 0 0;border:1px dashed ${COLORS.lineStrong};border-radius:6px;padding:10px 12px;font:400 13px/1.5 ${BODY_FONT};color:${COLORS.soft}">${escapeHtml(copy.emails.voiceNote.replace("{duration}", formatAudioDuration(answer.audioDurationMs ?? 0)))} — <a href="${escapeHtml(url)}" style="color:${COLORS.accent}">${escapeHtml(copy.emails.voiceNoteListen)}</a></div>`
        : "";
      const note = answer.addedLater
        ? `<div style="font:400 12px/1.5 ${BODY_FONT};color:${COLORS.muted};margin-top:10px">${escapeHtml(copy.emails.addedLater)}</div>`
        : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:${COLORS.card};border:1px solid ${COLORS.line};border-radius:6px"><tr><td style="padding:22px 22px 20px">
  <div style="font:700 24px/1.2 ${DISPLAY_FONT};color:${COLORS.ink}">${escapeHtml(answer.question)}</div>
  <div style="font:800 14px/1.5 ${BODY_FONT};color:${COLORS.soft};margin:16px 0 4px">${escapeHtml(answer.author)}</div>
  <div style="font:400 16px/1.65 ${BODY_FONT};color:${COLORS.ink};white-space:pre-wrap">${escapeHtml(answer.body)}</div>
  ${photo}${voice}${note}
</td></tr></table>`;
    })
    .join("");
}

export function layout({ preheader, heading, body, cta, footer, answers, answersUrl }: LayoutInput): string {
  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px"><tr><td style="border-radius:999px;background:${COLORS.accent}"><a href="${escapeHtml(
        cta.url,
      )}" style="display:inline-block;padding:15px 26px;font:800 16px/1 ${BODY_FONT};color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(
        cta.label,
      )}</a></td></tr></table>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;${GINGHAM}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${GINGHAM}"><tr><td align="center" style="padding:36px 14px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 8px 24px;font:700 27px/1 ${DISPLAY_FONT};color:${COLORS.ink}"><span style="font-size:24px;vertical-align:-2px">${copy.common.cherry}</span> ${escapeHtml(copy.common.brand)}</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.card};border:1px solid ${COLORS.line};border-radius:6px;box-shadow:0 14px 26px -18px rgba(160,40,70,.4)"><tr><td style="padding:0 30px 30px">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:-11px 0 13px;position:relative;z-index:2;transform:rotate(-2deg);opacity:.92;clip-path:polygon(0 0,100% 0,97% 25%,100% 50%,97% 75%,100% 100%,0 100%,3% 75%,0 50%,3% 25%)"><tr><td width="88" height="22" style="width:88px;height:22px;background-color:${COLORS.tape};background-image:radial-gradient(circle,rgba(255,255,255,.85) 1.8px,transparent 2.3px);background-size:9px 9px"></td></tr></table>
<h1 style="margin:0 0 22px;font:700 36px/1.08 ${DISPLAY_FONT};color:${COLORS.ink};letter-spacing:0">${escapeHtml(heading)}</h1>
${paragraphs(body)}${ctaHtml}
</td></tr></table>
</td></tr>
${answers ? `<tr><td style="padding-top:20px">${answersHtml(answers, answersUrl ?? "#")}</td></tr>` : ""}
<tr><td style="padding:24px 10px 0"><p style="margin:0;font:400 13px/1.6 ${BODY_FONT};color:${COLORS.muted};text-align:center">${escapeHtml(
    footer ?? copy.emails.defaultFooter,
  )}</p></td></tr>
</table></td></tr></table></body></html>`;
}

export type RenderedEmail = { subject: string; html: string; text: string };

export function signInEmail(url: string): RenderedEmail {
  const content = copy.emails.signIn;
  return {
    subject: content.subject,
    html: layout({
      preheader: content.preheader,
      heading: content.heading,
      body: [content.body],
      cta: { label: content.cta, url },
      footer: content.footer,
    }),
    text: text(content.text, { body: content.body, url }),
  };
}

export function inviteEmail(input: {
  groupName: string;
  inviterName: string;
  url: string;
  isReader: boolean;
  personalNote?: string;
}): RenderedEmail {
  const { groupName, inviterName, url, isReader, personalNote } = input;
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
      footer: text(content.footer, values),
    }),
    text: `${text(content.text, values)}${note ? `\n\n${note}` : ""}`,
  };
}

export function promptEmail(input: {
  groupName: string;
  memberName: string;
  issueNumber: number;
  questionCount: number;
  url: string;
  deadlineLabel: string;
}): RenderedEmail {
  const { groupName, memberName, issueNumber, questionCount, url, deadlineLabel } = input;
  const content = copy.emails.prompt;
  const plural = questionCount === 1 ? copy.emails.questionSingular : copy.emails.questionPlural;
  const values = { groupName, memberName, issueNumber, questionCount, url, deadlineLabel, plural };
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: text(content.heading, values),
      body: [text(content.body, values), content.writingNote],
      cta: { label: text(content.cta, values), url },
      footer: text(content.footer, values),
    }),
    text: text(content.text, values),
  };
}

export function reminderEmail(input: {
  groupName: string;
  memberName: string;
  url: string;
  deadlineLabel: string;
  remaining: number;
}): RenderedEmail {
  const { groupName, memberName, url, deadlineLabel, remaining } = input;
  const content = copy.emails.reminder;
  const values = { groupName, memberName, url, deadlineLabel, remaining };
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: text(content.heading, values),
      body: [text(remaining === 1 ? content.bodySingular : content.bodyPlural, values), content.writingNote],
      cta: { label: content.cta, url },
      footer: text(content.footer, values),
    }),
    text: text(content.text, values),
  };
}

export function deliveryEmail(input: {
  groupName: string;
  issueNumber: number;
  url: string;
  answers: AnswerBlock[];
  shareUrl?: string | null;
}): RenderedEmail {
  const { groupName, issueNumber, url, answers, shareUrl } = input;
  const content = copy.emails.delivery;
  const values = {
    groupName,
    issueNumber,
    url,
    shareUrl: shareUrl ?? "",
    count: answers.length,
    plural: answers.length === 1 ? copy.emails.answerSingular : copy.emails.answerPlural,
  };
  const answerText = answers
    .map((answer) => text(content.textAnswer, { question: answer.question, author: answer.author, body: answer.body }))
    .join("\n\n");
  return {
    subject: text(content.subject, values),
    html: layout({
      preheader: text(content.preheader, values),
      heading: text(content.heading, values),
      body: [content.body],
      answers,
      answersUrl: url,
      cta: { label: content.cta, url },
      footer: text(shareUrl ? content.shareFooter : content.replyFooter, values),
    }),
    text: text(content.text, { ...values, answers: answerText }),
  };
}

export function pausedEmail(input: { groupName: string; url: string }): RenderedEmail {
  const { groupName, url } = input;
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
    }),
    text: text(content.text, values),
  };
}
