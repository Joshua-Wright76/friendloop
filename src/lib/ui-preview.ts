import { cookies } from "next/headers";
import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  comments,
  events,
  groups,
  issueQuestions,
  issueSections,
  issues,
  magicLinks,
  memberships,
  musicLinks,
  questionSuggestions,
  questions,
  replies,
  sectionMedia,
  sectionReplies,
  sections,
  sessions,
  users,
  reactions,
} from "@/db/schema";
import { createSession } from "./auth";
import { secureCookies } from "./e2e";
import { nextSlot } from "./schedule";
import { hashToken, safeEqual } from "./tokens";

const PREVIEW_COOKIE = "fl_preview";
const PREVIEW_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Local development is open; anything deployed needs the shared key. */
export function isLocalUiPreview(): boolean {
  return process.env.NODE_ENV === "development" && !process.env.VERCEL_ENV;
}

export function previewSecret(): string | null {
  return process.env.UI_PREVIEW_SECRET?.trim() || null;
}

export function previewCookieName(): string {
  return PREVIEW_COOKIE;
}

/** The value the cookie carries: the hashed secret, never the secret itself. */
export function previewCookieValue(): string | null {
  const secret = previewSecret();
  return secret ? hashToken(secret) : null;
}

export function previewKeyMatches(key: string | null | undefined): boolean {
  const secret = previewSecret();
  return Boolean(key && secret && safeEqual(hashToken(key), hashToken(secret)));
}

export function previewCookieMatches(value: string | undefined): boolean {
  const expected = previewCookieValue();
  return Boolean(value && expected && safeEqual(value, expected));
}

/**
 * The demo's tokens are in this public repository and its owner can invite
 * anyone, so production never holds it, with or without the key. There the key
 * opens only the inboxes and the stats.
 */
export function demoDataAllowed(): boolean {
  return process.env.VERCEL_ENV !== "production";
}

/**
 * Every /dev route is locked outside local development (see proxy.ts). Visiting
 * /dev/ui with `?key=<UI_PREVIEW_SECRET>` once sets a cookie scoped to /dev.
 */
export async function unlockUiInbox(key: string | null): Promise<void> {
  const expected = previewCookieValue();
  const jar = await cookies();
  if (!expected || !previewKeyMatches(key) || previewCookieMatches(jar.get(PREVIEW_COOKIE)?.value)) return;

  jar.set(PREVIEW_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    // Fail closed over plain HTTP: a self-hosted deployment without TLS keeps
    // /dev locked instead of leaking the cookie across the network.
    secure: secureCookies(),
    path: "/dev",
    maxAge: PREVIEW_COOKIE_MAX_AGE,
  });
}

const PREVIEW_OWNER_REPLY_ID = "22222222-2222-4222-8222-2222222222a0";
const PREVIEW_ALICE_REPLY_ID = "22222222-2222-4222-8222-2222222222a1";
const PREVIEW_COMMENT_IDS = [
  "22222222-2222-4222-8222-222222222271",
  "22222222-2222-4222-8222-222222222272",
  "22222222-2222-4222-8222-222222222273",
  "22222222-2222-4222-8222-222222222274",
] as const;

// Real cards, cached so the preview never calls the providers. Qobuz playlists
// have no cover, so that card shows the provider tile instead.
const SPOTIFY_ALBUM_URL = "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3";
const QOBUZ_PLAYLIST_URL = "https://open.qobuz.com/playlist/2007557";
const BANDCAMP_ALBUM_URL = "https://radiohead.bandcamp.com/album/in-rainbows";
const PREVIEW_MUSIC = [
  {
    url: SPOTIFY_ALBUM_URL,
    provider: "spotify",
    title: "Emotion (Deluxe), by Carly Rae Jepsen",
    artworkUrl: "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e025618ee6467c0becf0dd23d68",
    trackCount: 15,
    tracks: [
      { title: "Run Away With Me", artist: "Carly Rae Jepsen", seconds: 251 },
      { title: "Emotion", artist: "Carly Rae Jepsen", seconds: 197 },
      { title: "I Really Like You", artist: "Carly Rae Jepsen", seconds: 205 },
      { title: "Gimmie Love", artist: "Carly Rae Jepsen", seconds: 202 },
      { title: "All That", artist: "Carly Rae Jepsen", seconds: 277 },
      { title: "Boy Problems", artist: "Carly Rae Jepsen", seconds: 222 },
      { title: "Making The Most Of The Night", artist: "Carly Rae Jepsen", seconds: 239 },
      { title: "Your Type", artist: "Carly Rae Jepsen", seconds: 200 },
    ],
  },
  {
    url: QOBUZ_PLAYLIST_URL,
    provider: "qobuz",
    title: "John Carpenter",
    artworkUrl: null,
    trackCount: 39,
    tracks: [
      { title: "Weeping Ghost", artist: "John Carpenter", seconds: 213 },
      { title: "Halloween", artist: "John Carpenter", seconds: 179 },
      { title: "Vortex", artist: "John Carpenter", seconds: 284 },
      { title: "Angel's Asylum", artist: "John Carpenter", seconds: 257 },
      { title: "Assault on Precinct 13", artist: "John Carpenter", seconds: 175 },
      { title: "Christine", artist: "John Carpenter", seconds: 255 },
      { title: "Theme from The Fog", artist: "John Carpenter", seconds: 307 },
      { title: "Starman", artist: "John Carpenter", seconds: 154 },
    ],
  },
  {
    url: BANDCAMP_ALBUM_URL,
    provider: "bandcamp",
    title: "In Rainbows, by Radiohead",
    artworkUrl: "https://f4.bcbits.com/img/a0552435637_5.jpg",
    trackCount: 10,
    tracks: [
      { title: "15 Step", artist: null, seconds: 237 },
      { title: "Bodysnatchers", artist: null, seconds: 242 },
      { title: "Nude", artist: null, seconds: 255 },
      { title: "Weird Fishes/ Arpeggi", artist: null, seconds: 318 },
      { title: "All I Need", artist: null, seconds: 228 },
      { title: "Faust Arp", artist: null, seconds: 129 },
      { title: "Reckoner", artist: null, seconds: 290 },
      { title: "House Of Cards", artist: null, seconds: 328 },
    ],
  },
];

export const UI_PREVIEW = {
  groupId: "22222222-2222-4222-8222-222222222222",
  userId: "22222222-2222-4222-8222-222222222223",
  ownerMembershipId: "22222222-2222-4222-8222-222222222224",
  aliceMembershipId: "22222222-2222-4222-8222-222222222225",
  samMembershipId: "22222222-2222-4222-8222-222222222226",
  openIssueId: "22222222-2222-4222-8222-222222222230",
  deliveredIssueId: "22222222-2222-4222-8222-222222222231",
  ownerToken: "ui-preview-owner-token",
  aliceToken: "ui-preview-alice-token",
  samToken: "ui-preview-sam-token",
  shareToken: "ui-preview-share-token",
  magicToken: "ui-preview-magic-token",
} as const;

const QUESTION_IDS = [
  "22222222-2222-4222-8222-222222222240",
  "22222222-2222-4222-8222-222222222241",
  "22222222-2222-4222-8222-222222222242",
  "22222222-2222-4222-8222-222222222243",
  "22222222-2222-4222-8222-222222222280",
  "22222222-2222-4222-8222-222222222281",
];
const OPEN_QUESTION_IDS = [
  "22222222-2222-4222-8222-222222222250",
  "22222222-2222-4222-8222-222222222251",
  "22222222-2222-4222-8222-222222222252",
  "22222222-2222-4222-8222-222222222253",
  "22222222-2222-4222-8222-222222222282",
  "22222222-2222-4222-8222-222222222283",
];
/*
 * Every table gets its own id range, so no two seeded rows ever share an id across
 * tables that are, or were, copied into one another (sections and events into
 * questions, round sections into round questions, section answers into answers):
 * questions …240–243 and …280–281, round questions …250–253, …260–263 and
 * …282–285, sections …2b0–2b2, round sections …245–24a, …24d and …24e, events
 * …24b and …24c, answers …2a0 and …2a1 (the rest of the answers get fresh ids).
 */
const SECTION_IDS = [
  "22222222-2222-4222-8222-2222222222b0",
  "22222222-2222-4222-8222-2222222222b1",
  "22222222-2222-4222-8222-2222222222b2",
];
const OPEN_SECTION_IDS = [
  "22222222-2222-4222-8222-222222222245",
  "22222222-2222-4222-8222-222222222246",
  "22222222-2222-4222-8222-222222222247",
];
const DELIVERED_SECTION_IDS = [
  "22222222-2222-4222-8222-222222222248",
  "22222222-2222-4222-8222-222222222249",
  "22222222-2222-4222-8222-22222222224a",
];
const PREVIEW_BIRTHDAY_EVENT_ID = "22222222-2222-4222-8222-22222222224b";
const PREVIEW_ONCE_EVENT_ID = "22222222-2222-4222-8222-22222222224c";
const OPEN_BIRTHDAY_SECTION_ID = "22222222-2222-4222-8222-22222222224d";
const DELIVERED_BIRTHDAY_SECTION_ID = "22222222-2222-4222-8222-22222222224e";
const DELIVERED_QUESTION_IDS = [
  "22222222-2222-4222-8222-222222222260",
  "22222222-2222-4222-8222-222222222261",
  "22222222-2222-4222-8222-222222222262",
  "22222222-2222-4222-8222-222222222263",
  "22222222-2222-4222-8222-222222222284",
  "22222222-2222-4222-8222-222222222285",
];
const QUESTION_TEXT = [
  "What made you laugh this week?",
  "What are you looking forward to?",
  "What's something small you're proud of?",
  "What did you eat that was worth remembering?",
  "Where should we camp this summer?",
  "Which weekends should we plan?",
];
/** The last two questions are polls: one pick, and pick-any. */
const POLLS: Record<number, { multiple: boolean; options: string[] }> = {
  4: { multiple: false, options: ["The lake", "The mountains", "The coast", "Backyard tents"] },
  5: { multiple: true, options: ["Mid June", "Early July", "Late July", "August"] },
};
const OWNER_PICKS: Record<number, number[]> = { 4: [0], 5: [1, 2] };
const ALICE_PICKS: Record<number, number[]> = { 4: [0], 5: [1] };
const OWNER_ANSWERS = [
  "A group of geese has decided my bus stop belongs to them. They have a schedule now. I respect it.",
  "Three hours in a bookshop and I regret nothing.",
  "I finally finished the shelf I started in March.",
  "The little lemon cake from the corner café.",
  "",
  "",
];
const ALICE_ANSWERS = [
  "My dad sent a four-minute voice memo of himself trying to find the record button.",
  "Seeing everyone this weekend.",
  "I kept a plant alive for a whole month.",
  "Homemade dumplings on a rainy evening.",
  "",
  "",
];

/** Whole outfits to try on the demo loop in one click. */
type PreviewLook = { preset: string; background: string; paperPack: string; tapePack: string; mascot: string };

export const PREVIEW_LOOKS = {
  harbour: { preset: "bluebell", background: "stars", paperPack: "journal", tapePack: "seaside", mascot: "duck" },
  schoolbook: { preset: "gingham", background: "hearts", paperPack: "schoolbook", tapePack: "garden", mascot: "frog" },
  parcel: { preset: "marmalade", background: "confetti", paperPack: "recycled", tapePack: "kraft", mascot: "lemon" },
  sketchbook: { preset: "lilac", background: "daisies", paperPack: "watercolor", tapePack: "starlight", mascot: "cat" },
  postcard: { preset: "meadow", background: "scallops", paperPack: "airmail", tapePack: "candy", mascot: "snail" },
  original: { preset: "gingham", background: "gingham", paperPack: "cream", tapePack: "picnic", mascot: "cherries" },
} as const satisfies Record<string, PreviewLook>;

export type PreviewLookKey = keyof typeof PREVIEW_LOOKS;

function lookColumns(look: PreviewLook) {
  const original = PREVIEW_LOOKS.original;
  const unless = (value: string, base: string) => (value === base ? null : value);
  return {
    themePreset: unless(look.preset, original.preset),
    themeAccent: null,
    themeBackground: unless(look.background, original.background),
    themePaperPack: unless(look.paperPack, original.paperPack),
    themeTapePack: unless(look.tapePack, original.tapePack),
    themeMascot: unless(look.mascot, original.mascot),
  };
}

/** Dress the demo loop, and only the demo loop. False for a look that doesn't exist. */
export async function wearPreviewLook(key: string | null): Promise<boolean> {
  if (!key || !Object.hasOwn(PREVIEW_LOOKS, key)) return false;
  await db.update(groups).set(lookColumns(PREVIEW_LOOKS[key as PreviewLookKey])).where(eq(groups.id, UI_PREVIEW.groupId));
  return true;
}

/** A second lock behind proxy.ts, for the pages that hold real people's data. */
export async function requireUiPreview() {
  if (isLocalUiPreview()) return;
  const jar = await cookies();
  if (!previewCookieMatches(jar.get(PREVIEW_COOKIE)?.value)) notFound();
}

/**
 * Whether this deployment shows the captured inbox. Production never does, key
 * or not: a sent email there is someone's private loop, and nobody running
 * Friendloop should have a page that reads it back.
 */
export function capturedInboxAllowed(): boolean {
  return process.env.VERCEL_ENV !== "production";
}

/** The captured inbox's lock: the preview key, and never in production. */
export async function requireCapturedInbox() {
  if (!capturedInboxAllowed()) notFound();
  await requireUiPreview();
}

/**
 * True for Postgres integrity errors (SQLSTATE class 23), the way stale demo
 * rows fail. Drizzle wraps the driver's error, so the code is usually on `cause`.
 */
export function isConstraintViolation(error: unknown): boolean {
  const { cause, code } = (error ?? {}) as { cause?: { code?: unknown }; code?: unknown };
  const sqlState = cause?.code ?? code;
  return typeof sqlState === "string" && sqlState.startsWith("23");
}

/**
 * Seeds on top of whatever is there, which only works while that data matches
 * this seed: rows from an older seed keep their old ids behind the unique
 * indexes, and the demo is open for anyone to edit. So when topping up breaks a
 * constraint, rebuild the demo loop rather than leaving /dev/ui broken until
 * someone finds the reset link. Any other error, such as a dropped connection,
 * says nothing about the data, so it is not worth wiping the demo for.
 *
 * The rebuild keeps the demo user, because deleting it would strip the owner from
 * any other loop a visitor made while signed in as the demo user.
 */
/**
 * Older seeds gave the demo's sections the ids of its first three questions. The
 * copy into one list keeps those apart now, but topping up such a demo would
 * leave its old sections beside the new ones, so it is rebuilt instead.
 */
const RETIRED_SECTION_IDS = [
  "22222222-2222-4222-8222-222222222240",
  "22222222-2222-4222-8222-222222222241",
  "22222222-2222-4222-8222-222222222242",
];

async function olderSeedPresent(): Promise<boolean> {
  const [row] = await db.select({ id: sections.id }).from(sections).where(inArray(sections.id, RETIRED_SECTION_IDS)).limit(1);
  return Boolean(row);
}

/** Seeds the demo and signs the caller in as its owner. False where the demo isn't allowed. */
export async function enableUiPreview(reset = false): Promise<boolean> {
  if (!demoDataAllowed()) return false;
  const now = new Date();

  try {
    const rebuild = reset || (await olderSeedPresent());
    await seedUiPreview(now, { deleteGroup: rebuild, deleteUser: reset });
  } catch (error) {
    if (reset || !isConstraintViolation(error)) throw error;
    const { cause } = error as { cause?: { code?: string; constraint_name?: string } };
    // Not the error itself: drizzle's message carries the whole query and its parameters.
    console.warn("UI preview data could not be topped up, so it is being rebuilt", cause?.code, cause?.constraint_name);
    await seedUiPreview(now, { deleteGroup: true, deleteUser: false });
  }

  await createSession(UI_PREVIEW.userId, now);
  return true;
}

async function seedUiPreview(now: Date, { deleteGroup, deleteUser }: { deleteGroup: boolean; deleteUser: boolean }) {
  await db.transaction(async (tx) => {
    if (deleteGroup) await tx.delete(groups).where(eq(groups.id, UI_PREVIEW.groupId));
    if (deleteUser) await tx.delete(users).where(eq(users.id, UI_PREVIEW.userId));

    await tx.insert(users).values({
      id: UI_PREVIEW.userId,
      email: "ui-preview@friendloop.local",
      name: "Alex",
      timezone: "Europe/Amsterdam",
      isSynthetic: true,
    }).onConflictDoNothing();

    await tx.insert(groups).values({
      id: UI_PREVIEW.groupId,
      name: "Saturday Club",
      displayName: "Saturday Club",
      timezone: "Europe/Amsterdam",
      promptWeekday: 5,
      promptHour: 9,
      cadenceWeeks: 1,
      shareEnabled: true,
      isSynthetic: true,
      createdAt: new Date(now.getTime() - 30 * 86400000),
    }).onConflictDoNothing();

    await tx.insert(memberships).values([
      {
        id: UI_PREVIEW.ownerMembershipId,
        groupId: UI_PREVIEW.groupId,
        userId: UI_PREVIEW.userId,
        email: "ui-preview@friendloop.local",
        name: "Alex",
        access: "owner",
        participation: "contributor",
        replyToken: UI_PREVIEW.ownerToken,
        acceptedAt: now,
      },
      {
        id: UI_PREVIEW.aliceMembershipId,
        groupId: UI_PREVIEW.groupId,
        email: "alice@friendloop.local",
        name: "Alice",
        access: "member",
        participation: "contributor",
        replyToken: UI_PREVIEW.aliceToken,
        acceptedAt: now,
      },
      {
        // Sam only drops a music pick, so the delivered issue shows all three providers.
        id: UI_PREVIEW.samMembershipId,
        groupId: UI_PREVIEW.groupId,
        email: "sam@friendloop.local",
        name: "Sam",
        access: "member",
        participation: "contributor",
        replyToken: UI_PREVIEW.samToken,
        acceptedAt: now,
      },
    ]).onConflictDoNothing();

    await tx.insert(questions).values(QUESTION_TEXT.map((text, index) => ({
      id: QUESTION_IDS[index],
      groupId: UI_PREVIEW.groupId,
      text,
      position: index,
      kind: POLLS[index] ? "poll" as const : "written" as const,
      pollMultiple: POLLS[index]?.multiple ?? false,
      pollOptions: POLLS[index]?.options ?? null,
    }))).onConflictDoNothing();

    const previewDelivery = nextSlot({ timezone: "Europe/Amsterdam", promptWeekday: 5, promptHour: 9, cadenceWeeks: 1, createdAt: new Date(now.getTime() - 30 * 86400000) }, now);
    await tx.insert(issues).values([
      {
        id: UI_PREVIEW.openIssueId,
        groupId: UI_PREVIEW.groupId,
        number: 12,
        status: "open",
        slotAt: previewDelivery,
        opensAt: new Date(now.getTime() - 86400000),
        // As in a real weekly loop: open since the last issue went out, due at the next delivery.
        deliversAt: previewDelivery,
      },
      {
        id: UI_PREVIEW.deliveredIssueId,
        groupId: UI_PREVIEW.groupId,
        number: 11,
        status: "delivered",
        slotAt: new Date(now.getTime() - 8 * 86400000),
        opensAt: new Date(now.getTime() - 8 * 86400000),
        deliversAt: new Date(now.getTime() - 86400000),
        deliveredAt: new Date(now.getTime() - 86400000),
        shareToken: UI_PREVIEW.shareToken,
      },
    ]).onConflictDoNothing();

    // Identity features, applied on every run so an older preview picks them up too:
    // a non-default paper with a header picture, a named round, and profile photos.
    await tx.update(groups).set({ ...lookColumns(PREVIEW_LOOKS.harbour), headerImageUrl: "/dev-preview/header.svg" })
      .where(eq(groups.id, UI_PREVIEW.groupId));
    await tx.update(issues).set({ name: "Camping weekend" }).where(eq(issues.id, UI_PREVIEW.deliveredIssueId));
    await tx.update(memberships).set({ photoUrl: "/dev-preview/avatar-alice.svg", charm: "frog", avatarFrame: "doily" })
      .where(eq(memberships.id, UI_PREVIEW.aliceMembershipId));
    await tx.update(memberships).set({ photoUrl: "/dev-preview/avatar-owner.svg", charm: "star", avatarFrame: "rosette" })
      .where(eq(memberships.id, UI_PREVIEW.ownerMembershipId));
    await tx.update(memberships).set({ charm: "snail", avatarFrame: "polaroid" })
      .where(eq(memberships.id, UI_PREVIEW.samMembershipId));

    await tx.insert(issueQuestions).values(QUESTION_TEXT.flatMap((text, index) => {
      const poll = {
        kind: POLLS[index] ? "poll" as const : "written" as const,
        pollMultiple: POLLS[index]?.multiple ?? false,
        pollOptions: POLLS[index]?.options ?? null,
      };
      return [
        { id: OPEN_QUESTION_IDS[index], issueId: UI_PREVIEW.openIssueId, questionId: QUESTION_IDS[index], text, position: index, ...poll },
        { id: DELIVERED_QUESTION_IDS[index], issueId: UI_PREVIEW.deliveredIssueId, questionId: QUESTION_IDS[index], text, position: index, ...poll },
      ];
    })).onConflictDoNothing();

    const replyRows: Array<typeof replies.$inferInsert> = QUESTION_TEXT.flatMap((_, index) => [
      {
        ...(index === 0 ? { id: PREVIEW_OWNER_REPLY_ID } : {}),
        issueId: UI_PREVIEW.deliveredIssueId,
        issueQuestionId: DELIVERED_QUESTION_IDS[index],
        membershipId: UI_PREVIEW.ownerMembershipId,
        body: OWNER_ANSWERS[index],
        pollChoices: OWNER_PICKS[index] ?? [],
        status: "submitted" as const,
        submittedAt: new Date(now.getTime() - 86400000),
      },
      {
        // Alice answers the first question out loud so the issue player and the
        // email's voice-note block have something real to show.
        ...(index === 0 ? { id: PREVIEW_ALICE_REPLY_ID } : {}),
        issueId: UI_PREVIEW.deliveredIssueId,
        issueQuestionId: DELIVERED_QUESTION_IDS[index],
        membershipId: UI_PREVIEW.aliceMembershipId,
        body: ALICE_ANSWERS[index],
        audioUrl: index === 0 ? "/dev-preview/voice-note.webm" : null,
        audioDurationMs: index === 0 ? 1_408 : null,
        pollChoices: ALICE_PICKS[index] ?? [],
        status: "submitted" as const,
        submittedAt: new Date(now.getTime() - 86400000),
      },
    ]);
    replyRows.push({
      issueId: UI_PREVIEW.openIssueId,
      issueQuestionId: OPEN_QUESTION_IDS[0],
      membershipId: UI_PREVIEW.ownerMembershipId,
      body: "The cat accepted a fist bump but refused a high five.",
      status: "submitted",
      submittedAt: now,
    });
    await tx.insert(replies).values(replyRows).onConflictDoNothing();

    // Reactions past the three defaults, so the issue shows chips from the picker.
    await tx.insert(reactions).values([
      { replyId: PREVIEW_ALICE_REPLY_ID, membershipId: UI_PREVIEW.ownerMembershipId, emoji: "🪿" },
      { replyId: PREVIEW_ALICE_REPLY_ID, membershipId: UI_PREVIEW.samMembershipId, emoji: "🪿" },
      { replyId: PREVIEW_ALICE_REPLY_ID, membershipId: UI_PREVIEW.samMembershipId, emoji: "❤️" },
      { replyId: PREVIEW_OWNER_REPLY_ID, membershipId: UI_PREVIEW.aliceMembershipId, emoji: "🐸" },
    ]).onConflictDoNothing();

    // A thread with all the new moving parts: a mention, a quoted reply, one hanging
    // from a single answer, and one the quote of which has been removed.
    const mention = `@[${UI_PREVIEW.aliceMembershipId}]`;
    await tx.insert(comments).values([
      {
        id: "22222222-2222-4222-8222-222222222270",
        issueId: UI_PREVIEW.deliveredIssueId,
        membershipId: UI_PREVIEW.aliceMembershipId,
        body: "This made my morning.",
      },
      {
        id: PREVIEW_COMMENT_IDS[0],
        issueId: UI_PREVIEW.deliveredIssueId,
        membershipId: UI_PREVIEW.ownerMembershipId,
        body: `${mention} that goose story needs its own newsletter.`,
      },
      {
        id: PREVIEW_COMMENT_IDS[1],
        issueId: UI_PREVIEW.deliveredIssueId,
        membershipId: UI_PREVIEW.aliceMembershipId,
        body: "Only if the geese get a column.",
        quoteCommentId: PREVIEW_COMMENT_IDS[0],
      },
      {
        id: PREVIEW_COMMENT_IDS[2],
        issueId: UI_PREVIEW.deliveredIssueId,
        membershipId: UI_PREVIEW.ownerMembershipId,
        replyId: PREVIEW_ALICE_REPLY_ID,
        body: "The voice memo is the best part. Four minutes!",
      },
      {
        id: PREVIEW_COMMENT_IDS[3],
        issueId: UI_PREVIEW.deliveredIssueId,
        membershipId: UI_PREVIEW.aliceMembershipId,
        replyId: PREVIEW_ALICE_REPLY_ID,
        body: "He found it eventually.",
        quoteCommentId: PREVIEW_COMMENT_IDS[2],
      },
    ]).onConflictDoNothing();

    // Sections: a recurring potluck note, a photo wall, and music picks, so the
    // sheet, the delivered issue, and the dashboard all have something to show.
    const sectionRows = [
      {
        id: SECTION_IDS[0],
        groupId: UI_PREVIEW.groupId,
        kind: "standard" as const,
        title: "The potluck corner",
        emoji: "🍲",
        description: "What did you cook, eat, or share this week?",
        position: 0,
      },
      {
        id: SECTION_IDS[1],
        groupId: UI_PREVIEW.groupId,
        kind: "photo_wall" as const,
        title: "The fridge wall",
        emoji: "🧲",
        description: "Pin up the photos worth keeping.",
        position: 1,
      },
      {
        id: SECTION_IDS[2],
        groupId: UI_PREVIEW.groupId,
        kind: "music" as const,
        title: "Music picks",
        emoji: "🎵",
        description: null,
        position: 2,
      },
    ];
    await tx.insert(sections).values(sectionRows).onConflictDoNothing();

    // Events: Alice's birthday (every year) and a one-time housewarming, plus the
    // birthday as a snapshotted section in both rounds, as the sweep would leave it.
    await tx.insert(events).values([
      {
        id: PREVIEW_BIRTHDAY_EVENT_ID,
        groupId: UI_PREVIEW.groupId,
        kind: "birthday" as const,
        title: null,
        emoji: "🎂",
        month: 3,
        day: 14,
        year: null,
        membershipId: UI_PREVIEW.aliceMembershipId,
      },
      {
        id: PREVIEW_ONCE_EVENT_ID,
        groupId: UI_PREVIEW.groupId,
        kind: "once" as const,
        title: "The housewarming",
        emoji: "🏡",
        month: 6,
        day: 20,
        year: now.getUTCFullYear() + 1,
        membershipId: null,
      },
    ]).onConflictDoNothing();
    await tx.insert(issueSections).values([
      {
        id: OPEN_BIRTHDAY_SECTION_ID,
        issueId: UI_PREVIEW.openIssueId,
        sectionId: null,
        kind: "standard" as const,
        title: "Alice's birthday",
        emoji: "🎂",
        description: "Leave Alice a note or a photo. It lands in the round for everyone to read.",
        adminOnly: false,
        position: 3,
        eventId: PREVIEW_BIRTHDAY_EVENT_ID,
        eventDate: `${now.getUTCFullYear()}-03-14`,
      },
      {
        id: DELIVERED_BIRTHDAY_SECTION_ID,
        issueId: UI_PREVIEW.deliveredIssueId,
        sectionId: null,
        kind: "standard" as const,
        title: "Alice's birthday",
        emoji: "🎂",
        description: "Leave Alice a note or a photo. It lands in the round for everyone to read.",
        adminOnly: false,
        position: 3,
        eventId: PREVIEW_BIRTHDAY_EVENT_ID,
        eventDate: `${now.getUTCFullYear() - 1}-03-14`,
      },
    ]).onConflictDoNothing();

    await tx.insert(issueSections).values([
      ...sectionRows.map((section, index) => ({
        id: OPEN_SECTION_IDS[index],
        issueId: UI_PREVIEW.openIssueId,
        sectionId: section.id,
        kind: section.kind,
        title: section.title,
        emoji: section.emoji,
        description: section.description,
        adminOnly: false,
        position: index,
      })),
      ...sectionRows.map((section, index) => ({
        id: DELIVERED_SECTION_IDS[index],
        issueId: UI_PREVIEW.deliveredIssueId,
        sectionId: section.id,
        kind: section.kind,
        title: section.title,
        emoji: section.emoji,
        description: section.description,
        adminOnly: false,
        position: index,
      })),
    ]).onConflictDoNothing();

    // Round 11 answers the sections; round 12 keeps a draft in progress. Any
    // of these already existing (a repeat /dev/ui visit) is treated as done.
    await tx.insert(sectionReplies).values([
      {
        issueId: UI_PREVIEW.deliveredIssueId,
        issueSectionId: DELIVERED_SECTION_IDS[0],
        membershipId: UI_PREVIEW.aliceMembershipId,
        body: "Lemon cake, obviously. Got to the corner café early for the last slice.",
        status: "submitted",
        submittedAt: new Date(now.getTime() - 86400000),
      },
      {
        issueId: UI_PREVIEW.deliveredIssueId,
        issueSectionId: DELIVERED_SECTION_IDS[1],
        membershipId: UI_PREVIEW.aliceMembershipId,
        body: "",
        status: "submitted",
        submittedAt: new Date(now.getTime() - 86400000),
      },
      {
        issueId: UI_PREVIEW.deliveredIssueId,
        issueSectionId: DELIVERED_SECTION_IDS[2],
        membershipId: UI_PREVIEW.aliceMembershipId,
        body: "Our road trip record",
        linkUrl: SPOTIFY_ALBUM_URL,
        linkProvider: "spotify",
        status: "submitted",
        submittedAt: new Date(now.getTime() - 86400000),
      },
      {
        issueId: UI_PREVIEW.deliveredIssueId,
        issueSectionId: DELIVERED_SECTION_IDS[2],
        membershipId: UI_PREVIEW.ownerMembershipId,
        body: "Ghost-story soundtrack for the campfire, as promised",
        linkUrl: QOBUZ_PLAYLIST_URL,
        linkProvider: "qobuz",
        status: "submitted",
        submittedAt: new Date(now.getTime() - 86400000),
      },
      {
        issueId: UI_PREVIEW.deliveredIssueId,
        issueSectionId: DELIVERED_SECTION_IDS[2],
        membershipId: UI_PREVIEW.samMembershipId,
        body: "For the drive home",
        linkUrl: BANDCAMP_ALBUM_URL,
        linkProvider: "bandcamp",
        status: "submitted",
        submittedAt: new Date(now.getTime() - 86400000),
      },
      {
        issueId: UI_PREVIEW.openIssueId,
        issueSectionId: OPEN_SECTION_IDS[0],
        membershipId: UI_PREVIEW.ownerMembershipId,
        body: "The soup story, take two.",
        status: "submitted",
      },
      {
        issueId: UI_PREVIEW.deliveredIssueId,
        issueSectionId: DELIVERED_BIRTHDAY_SECTION_ID,
        membershipId: UI_PREVIEW.ownerMembershipId,
        body: "Happy birthday, Alice. Thank you for the lemon cake, the road trips, and all of it.",
        status: "submitted",
        submittedAt: new Date(now.getTime() - 86400000),
      },
    ]).onConflictDoNothing();

    const [wallReply] = await tx
      .select({ id: sectionReplies.id })
      .from(sectionReplies)
      .where(
        and(
          eq(sectionReplies.issueId, UI_PREVIEW.deliveredIssueId),
          eq(sectionReplies.issueSectionId, DELIVERED_SECTION_IDS[1]),
        ),
      )
      .limit(1);

    // section_media has no natural unique key, so conflict handling cannot make
    // this idempotent: replace the wall's photos instead of appending to them.
    await tx.delete(sectionMedia).where(eq(sectionMedia.sectionReplyId, wallReply.id));
    await tx.insert(sectionMedia).values([
      {
        sectionReplyId: wallReply.id,
        url: "/dev-preview/potluck.png",
        caption: "The whole table",
        position: 0,
      },
      {
        sectionReplyId: wallReply.id,
        url: "/dev-preview/fridge.png",
        caption: "The leftovers",
        position: 1,
      },
      // Captions are optional, so the demo wall shows a photo without one.
      {
        sectionReplyId: wallReply.id,
        url: "/dev-preview/dusk.png",
        caption: null,
        position: 2,
      },
    ]);

    // Upserted so an older preview picks up the songs (and stays fresh).
    for (const card of PREVIEW_MUSIC) {
      await tx.insert(musicLinks).values({ ...card, fetchedAt: now }).onConflictDoUpdate({
        target: musicLinks.url,
        set: { title: card.title, artworkUrl: card.artworkUrl, tracks: card.tracks, trackCount: card.trackCount, fetchedAt: now },
      });
    }

    await tx.insert(questionSuggestions).values({
      id: "22222222-2222-4222-8222-222222222290",
      groupId: UI_PREVIEW.groupId,
      membershipId: UI_PREVIEW.aliceMembershipId,
      text: "What's a small thing that made your week lighter?",
      authorDisplay: "name",
      status: "pending",
      createdAt: now,
    }).onConflictDoNothing();

    await tx.insert(magicLinks).values({
      id: "22222222-2222-4222-8222-222222222271",
      email: "ui-preview@friendloop.local",
      tokenHash: hashToken(UI_PREVIEW.magicToken),
      expiresAt: new Date(now.getTime() + 15 * 60000),
      usedAt: null,
    }).onConflictDoUpdate({
      target: magicLinks.id,
      set: { expiresAt: new Date(now.getTime() + 15 * 60000), usedAt: null },
    });

    await tx.delete(sessions).where(eq(sessions.userId, UI_PREVIEW.userId));
  });
}
