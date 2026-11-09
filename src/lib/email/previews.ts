import { readFileSync } from "node:fs";
import path from "node:path";
import { appUrl } from "../urls.ts";
import { coverOf } from "../looks.ts";
import {
  deliveryEmail,
  emailMarksOf,
  emailThemeOf,
  inviteEmail,
  mentionEmail,
  pausedEmail,
  promptEmail,
  reminderEmail,
  signInEmail,
  joinEmail,
  type AnswerBlock,
  type RenderedEmail,
  type SectionEmailBlock,
} from "./templates";

export type EmailPreview = { id: string; email: RenderedEmail };

const ANSWERS: AnswerBlock[] = [
  {
    question: "What made you laugh this week?",
    author: "Alex",
    body: "A group of geese has decided my bus stop belongs to them. They have a schedule now. I respect it.",
  },
  {
    question: "What made you laugh this week?",
    author: "Alice",
    body: "My dad sent a four-minute voice memo of himself trying to find the record button.",
    audioUrl: "https://friendloop.dev/dev-preview/voice-note.webm",
    audioDurationMs: 84_000,
    addedLater: true,
  },
  {
    question: "What are you looking forward to?",
    author: "Alex",
    body: "Three hours in a bookshop and I regret nothing.",
  },
  {
    question: "Where should we camp this summer?",
    author: "Alex",
    body: "Chose: The lake",
    pollResults: "Results: The lake: 2 · The mountains: 1 · The coast: 0 · Backyard tents: 0",
  },
  {
    question: "Where should we camp this summer?",
    author: "Alice",
    body: "Chose: The lake",
    pollResults: "Results: The lake: 2 · The mountains: 1 · The coast: 0 · Backyard tents: 0",
  },
];

const SECTIONS: SectionEmailBlock[] = [
  {
    title: "The potluck corner",
    emoji: "🍲",
    answers: [
      { author: "Alice", body: "Lemon cake, obviously. Got to the corner café early for the last slice." },
      { author: "Sam", body: "Only soup. Delicious soup.", photoCount: 2 },
    ],
  },
  {
    title: "Alice's birthday",
    emoji: "🎂",
    answers: [
      { author: "Sam", body: "Happy birthday, Alice. Thank you for the lemon cake, the road trips, and all of it." },
    ],
  },
  {
    title: "Music picks",
    emoji: "🎵",
    answers: [
      {
        author: "Alice",
        body: "Our road trip record",
        linkUrl: "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
      },
    ],
  },
];

/** Every email Friendloop sends, rendered with sample data. */
/** Every loop email carries its recipient's "stop emails" link. */
const PREVIEW_STOP_URL = "https://friendloop.dev/u/preview-unsubscribe-token";

/**
 * Previews render in sandboxed frames, whose images must be https or data. A deployed
 * app's stickers and pattern tiles already are; on plain-http localhost they go in as data.
 */
function withLocalStickers<T extends { html: string }>(email: T): T {
  if (!appUrl().startsWith("http:")) return email;
  const inline = (dir: string, file: string) =>
    `data:image/png;base64,${readFileSync(path.join(process.cwd(), "public", dir, file)).toString("base64")}`;
  const html = email.html
    .replace(/src="[^"]*\/stickers\/png\/([a-z]+\.png)"/g, (_, file: string) => `src="${inline("stickers/png", file)}"`)
    .replace(/url\('[^']*\/patterns\/email\/([a-z]+-[a-z]+\.png)'\)/g, (_, file: string) => `url('${inline("patterns/email", file)}')`)
    .replace(/url\('[^']*\/dividers\/email\/([a-z]+-[a-z]+\.png)'\)/g, (_, file: string) => `url('${inline("dividers/email", file)}')`)
    .replace(/src="[^"]*\/seals\/([a-z]+-[a-z]+(?:-[a-z]+)?\.png)"/g, (_, file: string) => `src="${inline("seals", file)}"`)
    .replace(/src="[^"]*\/dev-preview\/(signature\.png)"/g, (_, file: string) => `src="${inline("dev-preview", file)}"`);
  return { ...email, html };
}

export function emailPreviews(): EmailPreview[] {
  return [
    {
      id: "signIn",
      email: signInEmail("https://friendloop.dev/signin/confirm?token=preview-token", "418093"),
    },
    {
      id: "join",
      email: joinEmail("Saturday Club", "https://friendloop.dev/signin/confirm?token=preview-token", "418093"),
    },
    {
      id: "inviteContributor",
      email: inviteEmail({
        groupName: "Saturday Club",
        inviterName: "Alex",
        url: "https://friendloop.dev/r/preview-token",
        unsubscribeUrl: PREVIEW_STOP_URL,
        isReader: false,
        personalNote: "We're giving this a go. Answer whatever feels easy.",
      }),
    },
    {
      // A loop in its own stationery: the page pattern, colours and mascot all carry over.
      id: "inviteThemed",
      email: withLocalStickers(inviteEmail({
        groupName: "Notes from the neighborhood",
        inviterName: "Alex",
        url: "https://friendloop.dev/r/preview-token",
        unsubscribeUrl: PREVIEW_STOP_URL,
        isReader: false,
        theme: emailThemeOf({
          themePreset: "lilac",
          themeAccent: null,
          themeBackground: "hearts",
          headerImageUrl: null,
          themeMascot: "mushroom",
        }),
      })),
    },
    {
      id: "inviteReader",
      email: inviteEmail({
        groupName: "Saturday Club",
        inviterName: "Alex",
        url: "https://friendloop.dev/r/preview-token",
        unsubscribeUrl: PREVIEW_STOP_URL,
        isReader: true,
      }),
    },
    {
      id: "prompt",
      email: promptEmail({
        groupName: "Saturday Club",
        memberName: "Alice",
        issueNumber: 12,
        questionCount: 3,
        url: "https://friendloop.dev/r/preview-token",
        unsubscribeUrl: PREVIEW_STOP_URL,
        deadlineLabel: "on Fri 13 Nov, 9:00 AM your time",
        questions: ["What made you laugh this week?", "What are you looking forward to?", "Where should we camp this summer?"],
      }),
    },
    {
      id: "reminder",
      email: reminderEmail({
        groupName: "Saturday Club",
        memberName: "Alice",
        url: "https://friendloop.dev/r/preview-token",
        unsubscribeUrl: PREVIEW_STOP_URL,
        deadlineLabel: "on Fri 13 Nov, 9:00 AM your time",
        remaining: 2,
      }),
    },
    {
      id: "mention",
      email: mentionEmail({
        groupName: "Saturday Club",
        memberName: "Alice",
        authorName: "Alex",
        issueNumber: 11,
        excerpt: "@Alice that geese story is the best thing I read all week.",
        url: "https://friendloop.dev/i/preview?m=preview-token",
        unsubscribeUrl: PREVIEW_STOP_URL,
      }),
    },
    {
      id: "delivery",
      email: deliveryEmail({
        issueName: "Camping weekend",
        groupName: "Saturday Club",
        issueNumber: 11,
        url: "https://friendloop.dev/i/preview",
        unsubscribeUrl: PREVIEW_STOP_URL,
        answers: ANSWERS,
        sections: SECTIONS,
      }),
    },
    {
      id: "deliveryShared",
      email: deliveryEmail({
        groupName: "Saturday Club",
        issueNumber: 11,
        url: "https://friendloop.dev/i/preview",
        unsubscribeUrl: PREVIEW_STOP_URL,
        answers: ANSWERS,
        shareUrl: "https://friendloop.dev/s/preview-share-token",
      }),
    },
    {
      // A loop with its own stationery and a named round: Bluebell paper, a header
      // picture, and the name where the number would be.
      id: "deliveryThemed",
      email: withLocalStickers(deliveryEmail({
        groupName: "Saturday Club",
        issueNumber: 11,
        issueName: "Camping weekend",
        url: "https://friendloop.dev/i/preview",
        unsubscribeUrl: PREVIEW_STOP_URL,
        answers: ANSWERS.slice(0, 2).map((answer, index) => ({ ...answer, authorCharm: ["frog", "star"][index] })),
        theme: emailThemeOf({
          themePreset: "bluebell",
          themeAccent: null,
          themeBackground: "daisies",
          headerImageUrl: "https://friendloop.dev/dev-preview/header.svg",
          themeMascot: "duck",
        }),
      })),
    },
    ...(["wax", "postmark"] as const).map((sealStyle) => ({
      // The owner's marks: a motto, a seal or postmark, a divider and a sign-off.
      id: sealStyle === "wax" ? "deliveryMarked" : "deliveryPostmarked",
      email: withLocalStickers(deliveryEmail({
        groupName: "Saturday Club",
        issueNumber: 11,
        url: "https://friendloop.dev/i/preview",
        unsubscribeUrl: PREVIEW_STOP_URL,
        answers: ANSWERS,
        theme: emailThemeOf({ themePreset: "meadow", themeAccent: null, themeBackground: null, headerImageUrl: null, themeMascot: "frog" }),
        marks: emailMarksOf(
          {
            themePreset: "meadow",
            themeMascot: "frog",
            timezone: "Europe/Amsterdam",
            motto: "est. 2019 · still terrible at replying",
            signOff: "xo, the Saturday crew",
            sealStyle,
            sealColor: "moss",
            divider: sealStyle === "wax" ? "vine" : "ricrac",
          },
          { number: 11, deliveredAt: new Date("2026-11-07T08:00:00Z") },
          { number: 12, deliversAt: new Date("2026-11-14T08:00:00Z") },
        ),
      })),
    })),
    {
      // What people add themselves: everyone's line, stickers on answers, and the signed card.
      id: "deliveryPeople",
      email: withLocalStickers(deliveryEmail({
        groupName: "Saturday Club",
        issueNumber: 11,
        url: "https://friendloop.dev/i/preview",
        unsubscribeUrl: PREVIEW_STOP_URL,
        answers: ANSWERS.map((answer, index) => ({ ...answer, sticker: ["peach", null, "frog"][index] ?? null })),
        rollCall: [
          { name: "Alex", line: "🧳 off to Lisbon on Thursday" },
          { name: "Alice", line: "📚 halfway through Middlemarch, again" },
        ],
        signatures: [
          { name: "Alex", src: "https://friendloop.dev/dev-preview/signature.png", width: 150, height: 32 },
          { name: "Alice", src: "https://friendloop.dev/dev-preview/signature.png", width: 120, height: 26 },
        ],
      })),
    },
    {
      // A named round with a cover: its tint and sticker open the email.
      id: "deliveryCovered",
      email: withLocalStickers(deliveryEmail({
        groupName: "Saturday Club",
        issueNumber: 11,
        issueName: "Camping weekend",
        url: "https://friendloop.dev/i/preview",
        unsubscribeUrl: PREVIEW_STOP_URL,
        answers: ANSWERS,
        cover: coverOf({ name: "Camping weekend", coverSticker: "mushroom", coverTint: "moss" }),
      })),
    },
    {
      id: "paused",
      email: pausedEmail({
        groupName: "Saturday Club",
        url: "https://friendloop.dev/g/preview",
        unsubscribeUrl: PREVIEW_STOP_URL,
      }),
    },
  ];
}
