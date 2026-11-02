import {
  deliveryEmail,
  inviteEmail,
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
    body: "Chose: The lake\nResults: The lake: 2 · The mountains: 1 · The coast: 0 · Backyard tents: 0",
  },
  {
    question: "Where should we camp this summer?",
    author: "Alice",
    body: "Chose: The lake\nResults: The lake: 2 · The mountains: 1 · The coast: 0 · Backyard tents: 0",
  },
];

const SECTIONS: SectionEmailBlock[] = [
  {
    title: "The potluck corner",
    emoji: "🍲",
    answers: [
      { author: "Alice", body: "Lemon cake, obviously — got to the corner café early for the last slice." },
      { author: "Sam", body: "Only soup. Delicious soup.", photoCount: 2 },
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
        deadlineLabel: "Friday at 9:00 AM",
      }),
    },
    {
      id: "reminder",
      email: reminderEmail({
        groupName: "Saturday Club",
        memberName: "Alice",
        url: "https://friendloop.dev/r/preview-token",
        deadlineLabel: "Friday at 9:00 AM",
        remaining: 2,
      }),
    },
    {
      id: "delivery",
      email: deliveryEmail({
        groupName: "Saturday Club",
        issueNumber: 11,
        url: "https://friendloop.dev/i/preview",
        answers: ANSWERS,
      }),
    },
    {
      id: "deliveryShared",
      email: deliveryEmail({
        groupName: "Saturday Club",
        issueNumber: 11,
        url: "https://friendloop.dev/i/preview",
        answers: ANSWERS,
        shareUrl: "https://friendloop.dev/s/preview-share-token",
      }),
    },
    {
      id: "paused",
      email: pausedEmail({
        groupName: "Saturday Club",
        url: "https://friendloop.dev/g/preview",
      }),
    },
  ];
}
