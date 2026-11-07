import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser } from "@playwright/test";
import { sql as drizzleSql } from "drizzle-orm";
import { db } from "@/db";
import {
  comments, events, groups, issueQuestions, issueSections, issues, magicLinks, memberships, musicLinks, outbox,
  questionSuggestions, questions, reactions, replies, sectionMedia, sectionReplies, sections, sessions, users,
} from "@/db/schema";

/**
 * A loop that has been running for six months, because that is when a query with no
 * limit starts to cost something: twelve people, twenty-six delivered rounds of real
 * length, comments, reactions, photos at the size phones really upload, and mail in
 * the outbox. Deterministic, so two runs measure the same thing.
 */
export const WORLD_SIZE = { members: 12, deliveredRounds: 26, questionsPerRound: 5, photos: 6 };

const SENTENCES = [
  "We finally made it out to the lake and the water was colder than anyone had promised.",
  "The kids decided that breakfast is now a competitive sport, and I am losing badly.",
  "I started reading again on the train, which has done wonders for my mood.",
  "Work was a lot this week, but the new team is kind and that changes everything.",
  "My neighbour brought over a tray of figs and we sat on the step until it got dark.",
  "I burned the first loaf, the second one was fine, and the third one was honestly great.",
  "We watched the whole thing in one sitting and I have many opinions about the ending.",
  "It rained for four days straight and I have never been so happy to own decent boots.",
  "I called my sister for the first time in a while and we talked for two hours.",
  "The bike is fixed, the knee is not, and I am pretending this is a fair trade.",
];
const NAMES = ["Sam", "Alice", "Bob", "Priya", "Marco", "Yuki", "Tom", "Lena", "Omar", "Grace", "Ines", "Noah"];
const QUESTION_TEXT = [
  "What made you laugh this week?", "What are you looking forward to?", "What's something small you're proud of?",
  "What did you eat that was worth remembering?", "Who did you think about this week?", "What did you read, watch or hear?",
  "What surprised you?", "Where did you go?", "What are you stuck on?", "What would you tell yourself a year ago?",
  "What's on your desk right now?", "What's the best thing you bought lately?",
];
const EMOJI = ["❤️", "😂", "🙌", "🥲", "🔥", "🌱", "🎉", "👏"];
const DAY = 24 * 60 * 60 * 1000;

function prng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export type Person = {
  userId: string;
  email: string;
  name: string;
  membershipId: string;
  replyToken: string;
  sessionToken: string;
};

export type World = {
  app: string;
  loopId: string;
  owner: Person;
  admin: Person;
  member: Person;
  reader: Person;
  pending: { email: string; membershipId: string; replyToken: string };
  people: Person[];
  openIssueId: string;
  latestIssueId: string;
  latestIssueNumber: number;
  olderIssueId: string;
  shareToken: string;
  questionIds: string[];
  sectionIds: string[];
  /**
   * Set up a small loop nobody minds losing, owned by the owner. Whatever the last
   * sample left behind goes first, so "your loops" never grows over a run.
   */
  throwawayLoop(): Promise<ThrowawayLoop>;
  /** A throwaway loop with an open round in the same shape as the real one: questions, a poll, three sections. */
  throwawayRound(): Promise<ThrowawayLoop & { issueId: string; issueQuestionIds: string[] }>;
  /** Delete every throwaway and wizard-made loop, so the owner is back to their three. */
  dropThrowaways(): Promise<void>;
  /** A person in no loop, signed in on a session nobody else's cookie shares. */
  throwawayUser(): Promise<{ userId: string; email: string; sessionToken: string }>;
  /** A fresh sign-in link for this address, without sending the mail: the path to open. */
  magicLink(email: string): Promise<string>;
  /** The newest sign-in link for an address, read from the outbox. */
  signInLink(email: string): Promise<string>;
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string): Promise<T[]>;
};

export type ThrowawayLoop = {
  id: string;
  name: string;
  questionIds: string[];
  members: Array<{ id: string; email: string; replyToken: string }>;
};

/** Photos at the size prepare-image.ts lets through: 2560px on the long edge. */
async function makePhotos(browser: Browser, count: number): Promise<string[]> {
  const directory = path.join(process.cwd(), "public", "uploads");
  mkdirSync(directory, { recursive: true });
  const urls: string[] = [];
  const page = await browser.newPage();
  for (let index = 0; index < count; index++) {
    const name = createHash("sha256").update(`perf-photo-${index}`).digest("hex");
    const file = path.join(directory, `${name}.jpg`);
    if (!existsSync(file)) {
      const base64 = await page.evaluate((seed) => {
        const canvas = document.createElement("canvas");
        canvas.width = 2560;
        canvas.height = 1920;
        const context = canvas.getContext("2d")!;
        const gradient = context.createLinearGradient(0, 0, 2560, 1920);
        gradient.addColorStop(0, `hsl(${(seed * 67) % 360} 45% 62%)`);
        gradient.addColorStop(1, `hsl(${(seed * 67 + 80) % 360} 40% 38%)`);
        context.fillStyle = gradient;
        context.fillRect(0, 0, 2560, 1920);
        // Enough detail that the file costs what a photograph costs.
        let state = seed + 1;
        const next = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
        for (let dot = 0; dot < 90000; dot++) {
          context.fillStyle = `hsla(${next() * 360} 40% ${30 + next() * 50}% / .35)`;
          context.fillRect(next() * 2560, next() * 1920, 3 + next() * 14, 3 + next() * 14);
        }
        return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
      }, index);
      writeFileSync(file, Buffer.from(base64, "base64"));
    }
    urls.push(`/uploads/${name}.jpg`);
  }
  await page.close();
  return urls;
}

const token = () => randomBytes(32).toString("base64url");
const hashed = (value: string) => createHash("sha256").update(value).digest("base64url");

export async function buildWorld(input: { app: string; browser: Browser }): Promise<World> {
  const random = prng(20261106);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const paragraph = (sentences: number) => Array.from({ length: sentences }, () => pick(SENTENCES)).join(" ");
  const now = Date.now();
  const photos = (await makePhotos(input.browser, WORLD_SIZE.photos)).map((file) => `${input.app}${file}`);

  const [group] = await db.insert(groups).values({
    name: "The Friday Loop",
    displayName: "The Friday Loop",
    timezone: "Europe/Amsterdam",
    promptWeekday: 5,
    promptHour: 9,
    cadenceWeeks: 1,
    shareEnabled: true,
    createdAt: new Date(now - 200 * DAY),
    lastSlotAt: new Date(now - 2 * DAY),
    headerImageUrl: photos[0],
  }).returning();

  const people: Person[] = [];
  for (const [index, name] of NAMES.entries()) {
    const email = `${name.toLowerCase()}@friendloop.test`;
    const [user] = await db.insert(users).values({ email, name, timezone: index % 2 ? "America/New_York" : "Europe/Amsterdam" }).returning();
    const replyToken = token();
    const sessionToken = token();
    const access = index === 0 ? "owner" : index === 1 ? "admin" : "member";
    const participation = name === "Noah" ? "reader" : "contributor";
    const [membership] = await db.insert(memberships).values({
      groupId: group.id, userId: user.id, email, name, access, participation, replyToken,
      acceptedAt: new Date(now - 190 * DAY),
      photoUrl: index < 4 ? photos[index + 1] : null,
    }).returning();
    await db.insert(sessions).values({ userId: user.id, tokenHash: hashed(sessionToken), expiresAt: new Date(now + 30 * DAY) });
    people.push({ userId: user.id, email, name, membershipId: membership.id, replyToken, sessionToken });
  }
  const [owner, admin, member] = people;
  const reader = people[people.length - 1];
  const contributors = people.slice(0, -1);

  const pendingToken = token();
  const [pendingRow] = await db.insert(memberships).values({
    groupId: group.id, email: "invited@friendloop.test", replyToken: pendingToken, invitedAt: new Date(now - DAY),
  }).returning();

  const questionRows = await db.insert(questions).values(QUESTION_TEXT.map((text, position) => ({ groupId: group.id, text, position }))).returning();
  const [poll] = await db.insert(questions).values({
    groupId: group.id, text: "Where should we camp this summer?", position: QUESTION_TEXT.length, kind: "poll",
    pollOptions: ["The lake", "The mountains", "The coast", "Backyard tents"],
  }).returning();
  const sectionRows = await db.insert(sections).values([
    { groupId: group.id, kind: "standard" as const, title: "Small wins", emoji: "🌱", description: "Anything that went right.", position: 0 },
    { groupId: group.id, kind: "photo_wall" as const, title: "Photo wall", emoji: "📷", position: 1 },
    { groupId: group.id, kind: "music" as const, title: "Now playing", emoji: "🎧", position: 2 },
  ]).returning();
  await db.insert(events).values([
    { groupId: group.id, kind: "birthday" as const, month: 3, day: 14, membershipId: member.membershipId },
    { groupId: group.id, kind: "once" as const, title: "The reunion", emoji: "🎉", month: 8, day: 2, year: 2027 },
  ]);
  await db.insert(questionSuggestions).values([
    { groupId: group.id, membershipId: member.membershipId, text: "What song is stuck in your head?" },
    { groupId: group.id, membershipId: people[3].membershipId, text: "What's the last thing you made?", authorDisplay: "anonymous" as const },
  ]);

  const musicUrl = (round: number, who: number) => `https://open.spotify.com/album/perf${round}x${who}`;
  let latestIssueId = "";
  let olderIssueId = "";
  let shareToken = "";

  const addRound = async (number: number, status: "delivered" | "open", opensAt: Date) => {
    const deliversAt = new Date(opensAt.getTime() + 7 * DAY);
    const roundShare = status === "delivered" ? token() : null;
    const [issue] = await db.insert(issues).values({
      groupId: group.id, number, status, slotAt: opensAt, opensAt, deliversAt,
      deliveredAt: status === "delivered" ? deliversAt : null, shareToken: roundShare,
    }).returning();
    const chosen = Array.from({ length: WORLD_SIZE.questionsPerRound - 1 }, (_, index) => questionRows[(number + index) % questionRows.length]);
    const asked = await db.insert(issueQuestions).values([
      ...chosen.map((question, position) => ({ issueId: issue.id, questionId: question.id, text: question.text, position })),
      { issueId: issue.id, questionId: poll.id, text: poll.text, position: chosen.length, kind: "poll" as const, pollOptions: poll.pollOptions },
    ]).returning();
    const carried = await db.insert(issueSections).values(sectionRows.map((section) => ({
      issueId: issue.id, sectionId: section.id, kind: section.kind, title: section.title, emoji: section.emoji,
      description: section.description, position: section.position,
    }))).returning();

    // An open round is part-way done: the member under test has only drafts.
    const authors = status === "open" ? contributors.filter((person) => person !== member).slice(0, 6) : contributors;
    const submittedAt = new Date(opensAt.getTime() + 2 * DAY);
    const replyRows = await db.insert(replies).values(authors.flatMap((person) => asked.map((question) => ({
      issueId: issue.id, issueQuestionId: question.id, membershipId: person.membershipId,
      body: question.kind === "poll" ? "" : paragraph(1 + Math.floor(random() * 4)),
      pollChoices: question.kind === "poll" ? [Math.floor(random() * 4)] : [],
      photoUrl: question.kind === "written" && random() < 0.08 ? pick(photos) : null,
      status: "submitted" as const, submittedAt,
    })))).returning();

    for (const section of carried) {
      const rows = await db.insert(sectionReplies).values(authors.slice(0, 6).map((person, who) => ({
        issueId: issue.id, issueSectionId: section.id, membershipId: person.membershipId,
        body: section.kind === "photo_wall" ? "" : paragraph(1),
        linkUrl: section.kind === "music" ? musicUrl(number, who) : null,
        linkProvider: section.kind === "music" ? "spotify" : null,
        status: "submitted" as const, submittedAt,
      }))).returning();
      if (section.kind === "photo_wall") {
        await db.insert(sectionMedia).values(rows.map((row, position) => ({
          sectionReplyId: row.id, url: photos[position % photos.length], caption: position % 2 ? "From the weekend" : null, position,
        })));
      }
      if (section.kind === "music") {
        await db.insert(musicLinks).values(rows.map((row) => ({
          url: row.linkUrl!, provider: "spotify", title: `Album ${number}`, trackCount: 10,
          tracks: Array.from({ length: 10 }, (_, track) => ({ title: `Track ${track + 1}`, artist: "A band", seconds: 200 })),
        })));
      }
    }

    const written = replyRows.filter((row) => row.body);
    await db.insert(reactions).values(Array.from({ length: 60 }, () => ({
      replyId: pick(written).id, membershipId: pick(people).membershipId, emoji: pick(EMOJI),
    }))).onConflictDoNothing();
    await db.insert(comments).values(Array.from({ length: 10 }, (_, index) => ({
      issueId: issue.id,
      membershipId: pick(people).membershipId,
      body: index % 3 === 0 ? `@[${pick(people).membershipId}] ${pick(SENTENCES)}` : pick(SENTENCES),
      replyId: index % 2 ? pick(written).id : null,
      createdAt: new Date(submittedAt.getTime() + index * 60_000),
    })));

    // Every round leaves a prompt, a reminder and a delivery per person in the outbox.
    const mail = "<html><body>" + paragraph(40).repeat(3) + "</body></html>";
    await db.insert(outbox).values(people.flatMap((person) => (["prompt", "reminder", "delivery"] as const).map((kind) => ({
      to: person.email, subject: `Round ${number}`, html: mail, text: "Round", kind, status: "sent" as const,
      dedupeKey: `${kind}:${issue.id}:${person.membershipId}`,
      groupId: group.id, issueId: issue.id, membershipId: person.membershipId, sentAt: opensAt,
    }))));
    return { id: issue.id, shareToken: roundShare ?? "" };
  };

  for (let number = 1; number <= WORLD_SIZE.deliveredRounds; number++) {
    const opensAt = new Date(now - (WORLD_SIZE.deliveredRounds - number + 1) * 7 * DAY - 2 * DAY);
    const round = await addRound(number, "delivered", opensAt);
    if (number === WORLD_SIZE.deliveredRounds) {
      latestIssueId = round.id;
      shareToken = round.shareToken;
    }
    if (number === WORLD_SIZE.deliveredRounds - 12) olderIssueId = round.id;
  }
  const open = await addRound(WORLD_SIZE.deliveredRounds + 1, "open", new Date(now - 2 * DAY));

  // Two other loops, so "your loops" is a real list.
  for (const name of ["Book club", "College friends"]) {
    const [other] = await db.insert(groups).values({ name, displayName: name, createdAt: new Date(now - 90 * DAY) }).returning();
    await db.insert(memberships).values({
      groupId: other.id, userId: owner.userId, email: owner.email, name: owner.name, access: "owner", replyToken: token(), acceptedAt: new Date(now - 90 * DAY),
    });
    await db.insert(questions).values({ groupId: other.id, text: "What are you reading?", position: 0 });
  }

  let throwaways = 0;
  const query: World["query"] = async (text) => (await db.execute(drizzleSql.raw(text))) as unknown as never[];
  const dropThrowaways: World["dropThrowaways"] = async () => {
    await query("delete from groups where name like 'Throwaway %' or name like 'Perf loop %'");
  };
  const throwawayLoop: World["throwawayLoop"] = async () => {
    await dropThrowaways();
    throwaways += 1;
    const name = `Throwaway ${throwaways}`;
    const [loop] = await db.insert(groups).values({ name, displayName: name, createdAt: new Date(Date.now() - 30 * DAY) }).returning();
    const rows = await db.insert(memberships).values([
      { groupId: loop.id, userId: owner.userId, email: owner.email, name: owner.name, access: "owner" as const, replyToken: token(), acceptedAt: new Date() },
      { groupId: loop.id, email: `one-${throwaways}@friendloop.test`, name: "One", replyToken: token(), acceptedAt: new Date() },
      { groupId: loop.id, email: `two-${throwaways}@friendloop.test`, name: "Two", replyToken: token(), invitedAt: new Date() },
    ]).returning();
    const asked = await db.insert(questions).values(["First?", "Second?", "Third?"].map((text, position) => ({ groupId: loop.id, text, position }))).returning();
    return {
      id: loop.id, name, questionIds: asked.map((row) => row.id),
      members: rows.slice(1).map((row) => ({ id: row.id, email: row.email, replyToken: row.replyToken })),
    };
  };
  return {
    app: input.app,
    loopId: group.id,
    owner, admin, member, reader,
    pending: { email: "invited@friendloop.test", membershipId: pendingRow.id, replyToken: pendingToken },
    people,
    openIssueId: open.id,
    latestIssueId,
    latestIssueNumber: WORLD_SIZE.deliveredRounds,
    olderIssueId,
    shareToken,
    questionIds: questionRows.map((row) => row.id),
    sectionIds: sectionRows.map((row) => row.id),
    throwawayLoop,
    dropThrowaways,
    async throwawayRound() {
      const loop = await throwawayLoop();
      const opensAt = new Date(Date.now() - DAY);
      const [issue] = await db.insert(issues).values({
        groupId: loop.id, number: 1, status: "open", slotAt: opensAt, opensAt, deliversAt: new Date(opensAt.getTime() + 7 * DAY),
      }).returning();
      const asked = await db.insert(issueQuestions).values([
        ...["First?", "Second?", "Third?"].map((text, position) => ({ issueId: issue.id, questionId: loop.questionIds[position], text, position })),
        { issueId: issue.id, text: "Which one?", position: 3, kind: "poll" as const, pollOptions: ["This", "That"] },
      ]).returning();
      await db.insert(issueSections).values([
        { issueId: issue.id, kind: "standard" as const, title: "Small wins", emoji: "🌱", position: 0 },
        { issueId: issue.id, kind: "photo_wall" as const, title: "Photo wall", emoji: "📷", position: 1 },
        { issueId: issue.id, kind: "music" as const, title: "Now playing", emoji: "🎧", position: 2 },
      ]);
      return { ...loop, issueId: issue.id, issueQuestionIds: asked.map((row) => row.id) };
    },
    async throwawayUser() {
      const email = `perf-user-${randomBytes(6).toString("hex")}@friendloop.test`;
      const [user] = await db.insert(users).values({ email, name: "Passing Through", timezone: "Europe/Amsterdam" }).returning();
      const sessionToken = token();
      await db.insert(sessions).values({ userId: user.id, tokenHash: hashed(sessionToken), expiresAt: new Date(Date.now() + 30 * DAY) });
      return { userId: user.id, email, sessionToken };
    },
    async magicLink(email) {
      const value = token();
      await db.insert(magicLinks).values({ email, tokenHash: hashed(value), expiresAt: new Date(Date.now() + 15 * 60_000) });
      return `/signin/confirm?token=${value}`;
    },
    async signInLink(email) {
      const rows = await query<{ html: string }>(
        `select html from outbox where "to" = '${email}' and kind = 'signin' order by created_at desc limit 1`,
      );
      const found = rows[0] && /href="([^"]*\/signin\/confirm[^"]*)"/.exec(rows[0].html);
      if (!found) throw new Error(`No sign-in mail for ${email}`);
      return found[1].replaceAll("&amp;", "&");
    },
    query,
  };
}
