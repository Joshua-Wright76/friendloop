/**
 * Friendloop's stationery, adapted for email clients: tables, inline styles,
 * solid-color fallbacks, and no required images or remote fonts.
 */

import { copy, text } from "../copy.ts";
import { formatAudioDuration } from "../audio-validation.ts";
import { issueHeading, issueRef } from "../issue-name.ts";
import { emailPalette, GINGHAM_EMAIL, type EmailPalette } from "../theme.ts";

type LayoutInput = {
  preheader: string;
  heading: string;
  body: string[];
  cta?: { label: string; url: string };
  footer?: string;
  answers?: AnswerBlock[];
  sections?: SectionEmailBlock[];
  /** Where "listen on the web issue" points for voice notes. */
  answersUrl?: string;
  /** The loop's stationery; absent means Gingham Picnic, exactly as before themes. */
  theme?: EmailTheme;
  /** This recipient's "stop emails from this loop" page. Every loop email has one. */
  unsubscribeUrl?: string;
};

export type EmailTheme = { palette: EmailPalette; headerImageUrl?: string | null };

/** What an email needs from a loop to wear its stationery. */
export function emailThemeOf(group: {
  themePreset: string | null;
  themeAccent: string | null;
  headerImageUrl: string | null;
}): EmailTheme {
  return {
    palette: emailPalette({ preset: group.themePreset, accent: group.themeAccent }),
    headerImageUrl: group.headerImageUrl,
  };
}

export type SectionEmailBlock = {
  title: string;
  emoji: string | null;
  answers: Array<{
    author: string;
    body: string;
    linkUrl?: string | null;
    addedLater?: boolean;
    photoCount?: number;
  }>;
};

export type AnswerBlock = {
  question: string;
  author: string;
  body: string;
  photoUrl?: string | null;
  audioUrl?: string | null;
  audioDurationMs?: number | null;
  addedLater?: boolean;
  /** A poll's tally. The same for every voter, so it is shown once per question. */
  pollResults?: string | null;
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
const DISPLAY_FONT = "Gaegu,Comic Sans MS,Chalkboard SE,cursive";
function gingham(c: EmailPalette): string {
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
            ? ` <a href="${escapeHtml(answer.linkUrl)}" style="color:${c.accent}">${escapeHtml(musicLinkLabel(answer.linkUrl))}</a>`
            : "";
          const photos =
            answer.photoCount && answer.photoCount > 0
              ? ` <span style="color:${c.muted}">${escapeHtml(copy.emails.photosAdded.replace("{count}", String(answer.photoCount)))}</span>`
              : "";
          return `<div style="margin:10px 0 0;font:400 15px/1.6 ${BODY_FONT};color:${c.ink}"><span style="font:800 13px/1.5 ${BODY_FONT};color:${c.soft}">${escapeHtml(answer.author)}</span> ${escapeHtml(answer.body)}${link}${photos}</div>`;
        })
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:${c.card};border:1px dashed ${c.lineStrong};border-radius:6px"><tr><td style="padding:20px 22px">
  <h2 style="margin:0;font:700 20px/1.2 ${DISPLAY_FONT};color:${c.ink}">${escapeHtml(`${section.emoji ?? ""} ${section.title}`.trim())}</h2>
  ${rows || `<div style="margin:10px 0 0;font:400 14px/1.5 ${BODY_FONT};color:${c.muted}">${escapeHtml(copy.emails.sectionEmpty)}</div>`}
</td></tr></table>`;
    })
    .join("");
}

function answersHtml(answers: AnswerBlock[], url: string, c: EmailPalette): string {
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
          const divider = index > 0 ? `border-top:1px dashed ${c.line};padding-top:14px;` : "";
          return `<div style="${divider}margin:16px 0 0">
  <div style="font:800 14px/1.5 ${BODY_FONT};color:${c.soft};margin:0 0 4px">${escapeHtml(answer.author)}</div>
  <div style="font:400 16px/1.65 ${BODY_FONT};color:${c.ink};white-space:pre-wrap">${escapeHtml(answer.body)}</div>
  ${photo}${voice}${note}
</div>`;
        })
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:${c.card};border:1px solid ${c.line};border-radius:6px"><tr><td style="padding:22px 22px 20px">
  <h2 style="margin:0;font:700 24px/1.2 ${DISPLAY_FONT};color:${c.ink}">${escapeHtml(group.question)}</h2>
  ${results}${rows}
</td></tr></table>`;
    })
    .join("");
}

export function layout({ preheader, heading, body, cta, footer, answers, sections, answersUrl, theme, unsubscribeUrl }: LayoutInput): string {
  const c = theme?.palette ?? GINGHAM_EMAIL;
  const GINGHAM = gingham(c);
  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px"><tr><td style="border-radius:999px;background:${c.accent}"><a href="${escapeHtml(
        cta.url,
      )}" style="display:inline-block;padding:15px 26px;font:800 16px/1 ${BODY_FONT};color:${c.onAccent};text-decoration:none;border-radius:999px">${escapeHtml(
        cta.label,
      )}</a></td></tr></table>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;${GINGHAM}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${GINGHAM}"><tr><td align="center" style="padding:36px 14px 40px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
${headerImage(theme?.headerImageUrl, c)}<tr><td style="padding:0 8px 24px;font:700 27px/1 ${DISPLAY_FONT};color:${c.ink}"><span style="font-size:24px;vertical-align:-2px">${copy.common.cherry}</span> ${escapeHtml(copy.common.brand)}</td></tr>
<tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border:1px solid ${c.line};border-radius:6px;box-shadow:${c.shadow}"><tr><td style="padding:0 30px 30px">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:-11px 0 13px;position:relative;z-index:2;transform:rotate(-2deg);opacity:.92;clip-path:polygon(0 0,100% 0,97% 25%,100% 50%,97% 75%,100% 100%,0 100%,3% 75%,0 50%,3% 25%)"><tr><td width="88" height="22" style="width:88px;height:22px;background-color:${c.tape};background-image:radial-gradient(circle,rgba(255,255,255,.85) 1.8px,transparent 2.3px);background-size:9px 9px"></td></tr></table>
<h1 style="margin:0 0 22px;font:700 36px/1.08 ${DISPLAY_FONT};color:${c.ink};letter-spacing:0">${escapeHtml(heading)}</h1>
${paragraphs(body, c)}${ctaHtml}
</td></tr></table>
</td></tr>
${answers ? `<tr><td style="padding-top:20px">${answersHtml(answers, answersUrl ?? "#", c)}</td></tr>` : ""}
${sections && sections.length > 0 ? `<tr><td style="padding-top:20px">${sectionsHtml(sections, c)}</td></tr>` : ""}
<tr><td align="center" style="padding:24px 10px 0"><p style="display:inline-block;margin:0;padding:4px 10px;font:400 13px/1.6 ${BODY_FONT};color:${c.soft};background-color:${c.page};text-align:center">${escapeHtml(
    footer ?? copy.emails.defaultFooter,
  )}${
    unsubscribeUrl
      ? `<br /><a href="${escapeHtml(unsubscribeUrl)}" style="color:${c.muted};text-decoration:underline">${escapeHtml(copy.emails.stopLink)}</a>`
      : ""
  }</p></td></tr>
</table></td></tr></table></body></html>`;
}

export type RenderedEmail = { subject: string; html: string; text: string };

/** The plain-text twin of the footer link. */
function withStopLine(body: string, unsubscribeUrl: string | undefined): string {
  return unsubscribeUrl ? `${body}\n\n${text(copy.emails.stopText, { url: unsubscribeUrl })}` : body;
}

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
      footer: text(content.footer, values),
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(`${text(content.text, values)}${note ? `\n\n${note}` : ""}`, unsubscribeUrl),
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
  theme?: EmailTheme;
  unsubscribeUrl?: string;
}): RenderedEmail {
  const { groupName, memberName, issueNumber, issueName, questionCount, url, deadlineLabel, theme, unsubscribeUrl } = input;
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
      cta: { label: text(content.cta, values), url },
      footer: text(content.footer, values),
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(text(content.text, values), unsubscribeUrl),
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
      footer: text(content.footer, values),
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(text(content.text, values), unsubscribeUrl),
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
  theme?: EmailTheme;
  unsubscribeUrl?: string;
}): RenderedEmail {
  const { groupName, issueNumber, issueName, url, answers, sections, shareUrl, theme, unsubscribeUrl } = input;
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
      footer: text(shareUrl ? content.shareFooter : content.replyFooter, values),
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(text(content.text, { ...values, answers: answerText }), unsubscribeUrl),
  };
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
      theme,
      unsubscribeUrl,
    }),
    text: withStopLine(text(content.text, values), unsubscribeUrl),
  };
}
