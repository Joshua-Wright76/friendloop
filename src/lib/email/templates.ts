/**
 * Email templates. Table-based, inline styles, readable with images off.
 *
 * These are the product's voice in the one place everyone actually sees it, so the
 * copy is plain and warm: no "Hello User", no exclamation-mark confetti.
 */

type LayoutInput = {
  preheader: string;
  heading: string;
  body: string[];
  cta?: { label: string; url: string };
  footer?: string;
  answers?: AnswerBlock[];
};

export type AnswerBlock = {
  question: string;
  author: string;
  body: string;
  photoUrl?: string | null;
  addedLater?: boolean;
};

const COLORS = {
  ink: "#1f1b16",
  muted: "#6b6259",
  line: "#e8e1d7",
  paper: "#fbf8f3",
  accent: "#3f6b52",
};

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
        `<p style="margin:0 0 16px;font:400 16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLORS.ink}">${escapeHtml(
          line,
        )}</p>`,
    )
    .join("");
}

function answersHtml(answers: AnswerBlock[]): string {
  return answers
    .map((answer) => {
      const photo = answer.photoUrl
        ? `<img src="${escapeHtml(answer.photoUrl)}" alt="" width="520" style="display:block;width:100%;max-width:520px;border-radius:12px;margin:12px 0 0" />`
        : "";
      const note = answer.addedLater
        ? `<div style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLORS.muted};margin-top:8px">added after the loop went out</div>`
        : "";
      return `<div style="padding:20px 0;border-top:1px solid ${COLORS.line}">
  <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLORS.muted};text-transform:uppercase;letter-spacing:.06em">${escapeHtml(
        answer.question,
      )}</div>
  <div style="font:600 15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLORS.ink};margin:10px 0 4px">${escapeHtml(
        answer.author,
      )}</div>
  <div style="font:400 16px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLORS.ink};white-space:pre-wrap">${escapeHtml(
        answer.body,
      )}</div>
  ${photo}${note}
</div>`;
    })
    .join("");
}

export function layout({ preheader, heading, body, cta, footer, answers }: LayoutInput): string {
  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:999px;background:${COLORS.accent}"><a href="${escapeHtml(
        cta.url,
      )}" style="display:inline-block;padding:14px 26px;font:600 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(
        cta.label,
      )}</a></td></tr></table>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(
    heading,
  )}</title></head>
<body style="margin:0;padding:0;background:${COLORS.paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.paper}"><tr><td align="center" style="padding:40px 20px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 24px">
<div style="font:600 12px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLORS.muted};letter-spacing:.14em;text-transform:uppercase">Friendloop</div>
<h1 style="margin:14px 0 0;font:600 30px/1.2 Georgia,'Times New Roman',serif;color:${COLORS.ink};letter-spacing:-.01em">${escapeHtml(
    heading,
  )}</h1>
</td></tr>
<tr><td>${paragraphs(body)}${ctaHtml}</td></tr>
${answers ? `<tr><td>${answersHtml(answers)}</td></tr>` : ""}
<tr><td style="padding:28px 0 0;border-top:1px solid ${COLORS.line}"><p style="margin:0;font:400 13px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${COLORS.muted}">${escapeHtml(
    footer ?? "You're getting this because you're in a Friendloop.",
  )}</p></td></tr>
</table></td></tr></table></body></html>`;
}

export type RenderedEmail = { subject: string; html: string; text: string };

export function signInEmail(url: string): RenderedEmail {
  return {
    subject: "Your Friendloop sign-in link",
    html: layout({
      preheader: "Good for 15 minutes, one use.",
      heading: "Here's your way in",
      body: [
        "Tap the button and you're signed in. This link works once and expires in 15 minutes.",
        "If you didn't ask for this, you can ignore it — nothing happens.",
      ],
      cta: { label: "Sign in to Friendloop", url },
      footer: "Friendloop · private group newsletters",
    }),
    text: `Sign in to Friendloop\n\n${url}\n\nThis link works once and expires in 15 minutes.`,
  };
}

export function inviteEmail(input: {
  groupName: string;
  inviterName: string;
  url: string;
  isReader: boolean;
}): RenderedEmail {
  const { groupName, inviterName, url, isReader } = input;
  return {
    subject: `${inviterName} added you to ${groupName}`,
    html: layout({
      preheader: isReader ? "You'll get the issues, no questions to answer." : "You'll get a few questions each round.",
      heading: `You're in ${groupName}`,
      body: [
        `${inviterName} added you to ${groupName}, a private newsletter for your group.`,
        isReader
          ? "You'll get each issue when it goes out. Nothing to answer — just have a read."
          : "Every round you'll get a few questions. Answer whatever you feel like, and everyone's answers become the next issue.",
      ],
      cta: { label: isReader ? "Have a look" : "Answer the first round", url },
      footer: `${groupName} · sent by Friendloop`,
    }),
    text: `${inviterName} added you to ${groupName}.\n\n${url}`,
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
  const plural = questionCount === 1 ? "question" : "questions";
  return {
    subject: `${memberName}, ${questionCount} ${plural} for ${groupName}`,
    html: layout({
      preheader: `Closes ${deadlineLabel}.`,
      heading: `Round ${issueNumber} is open`,
      body: [
        `${questionCount} ${plural}, no rush. Closes ${deadlineLabel}.`,
        "Write as much or as little as you like — a sentence counts.",
      ],
      cta: { label: `Answer ${questionCount} ${plural}`, url },
      footer: `${groupName} · you can change your answers until it closes`,
    }),
    text: `${groupName} round ${issueNumber} is open: ${questionCount} ${plural}.\n\n${url}\n\nCloses ${deadlineLabel}.`,
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
  return {
    subject: `Still time for ${groupName}`,
    html: layout({
      preheader: `Closes ${deadlineLabel}.`,
      heading: `A nudge from ${groupName}`,
      body: [
        `${memberName}, ${remaining} ${remaining === 1 ? "answer is" : "answers are"} still waiting. It closes ${deadlineLabel}.`,
        "One line is plenty.",
      ],
      cta: { label: "Finish my answers", url },
      footer: `${groupName} · sent by Friendloop`,
    }),
    text: `${memberName}, ${remaining} still waiting on ${groupName}. Closes ${deadlineLabel}.\n\n${url}`,
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
  return {
    subject: `${groupName} · round ${issueNumber}`,
    html: layout({
      preheader: `${answers.length} ${answers.length === 1 ? "answer" : "answers"} from the group.`,
      heading: `Round ${issueNumber}`,
      body: [`Here's what everyone wrote.`],
      answers,
      cta: { label: "Read it on the web", url },
      footer: shareUrl
        ? `${groupName} · shareable link: ${shareUrl}`
        : `${groupName} · reply to this email to talk about it`,
    }),
    text: `${groupName} · round ${issueNumber}\n\n${url}\n\n${answers
      .map((a) => `${a.question}\n${a.author}: ${a.body}`)
      .join("\n\n")}`,
  };
}

export function pausedEmail(input: { groupName: string; url: string }): RenderedEmail {
  const { groupName, url } = input;
  return {
    subject: `${groupName} paused itself`,
    html: layout({
      preheader: "Nobody answered, so nothing was sent.",
      heading: "Nothing to send this round",
      body: [
        `Nobody answered this round's questions in ${groupName}, so we skipped it rather than send an empty issue.`,
        "The loop is paused. Pick it back up whenever the group's ready — no need to rebuild anything.",
      ],
      cta: { label: "Open the loop", url },
      footer: `${groupName} · sent by Friendloop`,
    }),
    text: `Nobody answered, so ${groupName} skipped this round and paused.\n\n${url}`,
  };
}
