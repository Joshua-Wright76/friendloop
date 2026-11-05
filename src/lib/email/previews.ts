import {
  deliveryEmail,
  emailThemeOf,
  inviteEmail,
  mentionEmail,
  pausedEmail,
  promptEmail,
  reminderEmail,
  signInEmail,
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

export function emailPreviews(): EmailPreview[] {
  return [
    {
      id: "signIn",
      email: signInEmail("https://friendloop.dev/signin/confirm?token=preview-token"),
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
      email: deliveryEmail({
        groupName: "Saturday Club",
        issueNumber: 11,
        issueName: "Camping weekend",
        url: "https://friendloop.dev/i/preview",
        unsubscribeUrl: PREVIEW_STOP_URL,
        answers: ANSWERS.slice(0, 2),
        theme: emailThemeOf({
          themePreset: "bluebell",
          themeAccent: null,
          headerImageUrl: "https://friendloop.dev/dev-preview/header.svg",
        }),
      }),
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
