import type { Ctx, Interaction } from "../lib/types";
import { live } from "./helpers";

const round = (c: Ctx) => `/i/${c.world.latestIssueId}`;
const ANSWER = "article.answer-card";
const firstAnswer = (c: Ctx) => c.page.locator(ANSWER).first();
const composer = (c: Ctx) => c.page.getByLabel("Comment", { exact: true });
const comment = (unique: string) => `Perf comment ${unique}`;

/** Bob's reactions off this round, so none of the buttons starts out pressed. */
async function clearReactions(c: Ctx) {
  await c.world.query(`delete from reactions where membership_id = '${c.world.member.membershipId}'
    and reply_id in (select id from replies where issue_id = '${c.world.latestIssueId}')`);
}

async function clearComments(c: Ctx) {
  await c.world.query(`delete from comments where issue_id = '${c.world.latestIssueId}' and body like 'Perf %'`);
}

async function openRound(c: Ctx) {
  await c.page.goto(round(c));
  await live(firstAnswer(c).locator("button").first());
}

async function openReadingMenu(c: Ctx) {
  await openRound(c);
  const summary = c.page.locator(".issue-bar__menu--grow summary");
  await live(summary);
  await summary.click();
  await c.page.locator(`nav[aria-label="Reading this issue"]`).waitFor();
}

async function openEmojiPicker(c: Ctx) {
  await openRound(c);
  await firstAnswer(c).locator("button.reaction-chip--add").click();
  await c.page.locator("dialog.emoji-picker button[data-emoji]").first().waitFor();
}

export const readingInteractions: Interaction[] = [
  {
    id: "reading.round.load",
    label: "Open a round while signed in, first time on this device",
    surface: "reading", kind: "page-load", viewer: "owner", cache: "empty",
    flows: ["E1", "K6", "L3"], routes: ["/i/[id]"],
    act: (c) => c.visit(round(c)),
    done: () => ({ selector: ANSWER }),
  },
  {
    id: "reading.round.warm",
    label: "Come back to a round while signed in",
    surface: "reading", kind: "page-load", viewer: "owner", cache: "warm",
    flows: ["E1"], routes: ["/i/[id]"],
    act: (c) => c.visit(round(c)),
    done: () => ({ selector: ANSWER }),
  },
  {
    id: "reading.token.load",
    label: "Open a round from the delivery email",
    surface: "reading", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["E1"], routes: ["/i/[id]"],
    act: (c) => c.visit(`${round(c)}?m=${c.world.member.replyToken}`),
    done: () => ({ selector: ANSWER }),
  },
  {
    id: "reading.older.load",
    label: "Open an older round",
    surface: "reading", kind: "page-load", viewer: "owner", cache: "empty",
    flows: ["E5"], routes: ["/i/[id]"],
    act: (c) => c.visit(`/i/${c.world.olderIssueId}`),
    done: () => ({ selector: ANSWER }),
  },
  {
    id: "reading.share.load",
    label: "Open a round from a share link",
    surface: "reading", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["E2"], routes: ["/s/[token]"],
    act: (c) => c.visit(`/s/${c.world.shareToken}`),
    done: () => ({ selector: ANSWER }),
  },
  {
    id: "reading.print.load",
    label: "Open the print view of a round",
    surface: "reading", kind: "page-load", viewer: "owner", cache: "empty",
    flows: ["Q1", "Q2"], routes: ["/i/[id]"],
    act: (c) => c.visit(`${round(c)}?print`),
    done: () => ({ selector: ".print-answer" }),
  },
  {
    id: "reading.reaction.add",
    label: "React to an answer",
    surface: "reading", kind: "write", viewer: "member",
    flows: ["E4"], routes: ["/i/[id]"],
    prepare: async (c) => {
      await clearReactions(c);
      await openRound(c);
    },
    act: (c) => firstAnswer(c).locator(`button.reaction-chip[aria-pressed="false"]`).first().click(),
    // Optimistic on purpose: the chip answers at once, and `confirmedMs` carries the write behind it.
    done: () => ({ selector: `button.reaction-chip[aria-pressed="true"]` }),
  },
  {
    id: "reading.reaction.remove",
    label: "Take a reaction back",
    surface: "reading", kind: "write", viewer: "member",
    flows: ["E4"], routes: ["/i/[id]"],
    prepare: async (c) => {
      await clearReactions(c);
      await openRound(c);
      await firstAnswer(c).locator(`button.reaction-chip[aria-pressed="false"]`).first().click();
      await c.page.locator(`button.reaction-chip[aria-pressed="true"]:not([aria-disabled])`).waitFor();
    },
    act: (c) => firstAnswer(c).locator(`button.reaction-chip[aria-pressed="true"]`).first().click(),
    done: () => ({ selector: `button.reaction-chip[aria-pressed="true"]`, gone: true }),
  },
  {
    id: "reading.emoji.open",
    label: "Open the emoji picker and see the emoji",
    surface: "reading", kind: "instant", viewer: "member",
    flows: ["E4"], routes: ["/i/[id]"],
    prepare: openRound,
    act: (c) => firstAnswer(c).locator("button.reaction-chip--add").click(),
    done: () => ({ selector: "dialog.emoji-picker button[data-emoji]" }),
  },
  {
    id: "reading.emoji.search",
    label: "Type into the emoji search",
    surface: "reading", kind: "instant", viewer: "member",
    flows: ["E4"], routes: ["/i/[id]"],
    prepare: openEmojiPicker,
    act: (c) => c.page.getByRole("searchbox", { name: "Search for an emoji" }).pressSequentially("f"),
    done: () => ({ selector: `dialog.emoji-picker p[role="status"]`, text: "Search results below." }),
  },
  {
    id: "reading.comment.post",
    label: "Post a comment and see it in the thread",
    surface: "reading", kind: "write", viewer: "member",
    flows: ["E3"], routes: ["/i/[id]", "/api/issue/[id]/comments"],
    prepare: async (c) => {
      await clearComments(c);
      await openRound(c);
      await live(composer(c));
      await composer(c).fill(comment(c.unique));
    },
    act: (c) => composer(c).locator("xpath=ancestor::form").getByRole("button", { name: "Post", exact: true }).click(),
    done: (c) => ({ selector: "p", text: comment(c.unique) }),
  },
  {
    id: "reading.comment.reply",
    label: "Reply to a comment and see it in the thread",
    surface: "reading", kind: "write", viewer: "member",
    flows: ["M4"], routes: ["/i/[id]", "/api/issue/[id]/comments"],
    prepare: async (c) => {
      await clearComments(c);
      await openRound(c);
      const reply = c.page.getByRole("button", { name: /^Reply to / }).first();
      await live(reply);
      await reply.click();
      await c.page.getByText(/^Replying to /).waitFor();
      await composer(c).fill(comment(c.unique));
    },
    act: (c) => composer(c).locator("xpath=ancestor::form").getByRole("button", { name: "Post", exact: true }).click(),
    done: (c) => ({ selector: "p", text: comment(c.unique) }),
  },
  {
    id: "reading.answer.comment",
    label: "Comment on one answer and see it under that answer",
    surface: "reading", kind: "write", viewer: "member",
    flows: ["M3"], routes: ["/i/[id]", "/api/issue/[id]/comments"],
    prepare: async (c) => {
      await clearComments(c);
      await openRound(c);
      await firstAnswer(c).locator("button[aria-expanded]").click();
      await firstAnswer(c).locator("textarea").fill(comment(c.unique));
    },
    act: (c) => firstAnswer(c).getByRole("button", { name: "Post", exact: true }).click(),
    done: (c) => ({ selector: `${ANSWER} p`, text: comment(c.unique) }),
  },
  {
    id: "reading.mention.open",
    label: "Type @ and see who can be mentioned",
    surface: "reading", kind: "instant", viewer: "member",
    flows: ["M1"], routes: ["/i/[id]"],
    prepare: async (c) => {
      await openRound(c);
      await live(composer(c));
    },
    act: (c) => composer(c).pressSequentially("@"),
    done: () => ({ selector: `ul[role="listbox"][aria-label="People to mention"] li` }),
  },
  {
    id: "reading.filter.person",
    label: "Read only one person's answers",
    surface: "reading", kind: "navigation", viewer: "member",
    flows: ["R2"], routes: ["/i/[id]"],
    prepare: openReadingMenu,
    act: (c) => c.page.locator(`nav[aria-label="Reading this issue"]`).getByRole("link", { name: c.world.admin.name }).click(),
    done: (c) => ({ selector: `p[role="status"]`, text: `Showing only ${c.world.admin.name}'s answers.`, path: "by=" }),
  },
  {
    id: "reading.sort.person",
    label: "Read the round person by person",
    surface: "reading", kind: "navigation", viewer: "member",
    flows: ["R2"], routes: ["/i/[id]"],
    prepare: openReadingMenu,
    act: (c) => c.page.locator(`nav[aria-label="Reading this issue"]`).getByRole("link", { name: "By person" }).click(),
    done: () => ({ selector: `section[id^="person-"]`, path: "sort=" }),
  },
  {
    id: "reading.lightbox.open",
    label: "Open a photo full size from a round",
    surface: "reading", kind: "instant", viewer: "member",
    flows: ["K4"], routes: ["/i/[id]"],
    prepare: async (c) => {
      await openRound(c);
      await live(c.page.getByRole("button", { name: /^Open photo from / }).first());
    },
    act: (c) => c.page.getByRole("button", { name: /^Open photo from / }).first().click(),
    done: () => ({ selector: "dialog.album-viewer[open] img" }),
  },
  {
    id: "album.search.submit",
    label: "Search the Album for a word",
    surface: "album", kind: "navigation", viewer: "owner",
    flows: ["P2"], routes: ["/g/[id]/album"],
    prepare: async (c) => {
      await c.page.goto(`/g/${c.world.loopId}/album`);
      await c.page.locator(".album-grid .album-tile").first().waitFor();
      const fold = c.page.locator("details").filter({ has: c.page.locator(`form[role="search"]`) }).locator("summary");
      await live(fold);
      await fold.click();
      await c.page.locator(`input[name="q"]`).fill("weekend");
    },
    act: (c) => c.page.locator(`form[role="search"] button[type="submit"]`).click(),
    done: () => ({ selector: ".album-grid .album-tile", path: "q=weekend" }),
  },
  {
    id: "album.token.load",
    label: "Open the Album from a reply link",
    surface: "album", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["P1"], routes: ["/album/[id]"],
    act: (c) => c.visit(`/album/${c.world.loopId}?m=${c.world.member.replyToken}`),
    done: () => ({ selector: ".album-grid .album-tile" }),
  },
];
