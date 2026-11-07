import type { Ctx, Interaction } from "../lib/types";
import { catchDownload, DOWNLOADED, live, PHOTO, AVATAR, VOICE, WALL_PHOTO, stash } from "./helpers";

const bob = (c: Ctx) => c.world.member;
const sheetPath = (c: Ctx) => `/r/${bob(c).replyToken}`;

/** Bob with nothing on the open round, as a person arriving from the email is. */
async function clearBob(c: Ctx) {
  const { membershipId } = bob(c);
  await c.world.query(`delete from section_media where section_reply_id in (select id from section_replies where membership_id = '${membershipId}')`);
  await c.world.query(`delete from section_replies where membership_id = '${membershipId}' and issue_id = '${c.world.openIssueId}'`);
  await c.world.query(`delete from replies where membership_id = '${membershipId}' and issue_id = '${c.world.openIssueId}'`);
}

async function sheet(c: Ctx, target: string) {
  await c.page.goto(target);
  await live(c.page.locator("textarea").first());
}

/**
 * The sheet as Bob first sees it. The sample before may have left a draft on its way
 * out of the door, and that write can land after the clear, so check the page came back empty.
 */
async function freshSheet(c: Ctx) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  for (let attempt = 0; attempt < 5; attempt++) {
    await clearBob(c);
    await sheet(c, sheetPath(c));
    if (await c.page.locator("textarea:not(:placeholder-shown)").count() === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const firstAnswer = (c: Ctx) => c.page.locator("textarea").first();
const extras = (c: Ctx, title: string) => c.page.locator(`[data-paper="note"]`).filter({ has: c.page.locator("h3", { hasText: title }) });

const nobody = stash<string>();

export const replyInteractions: Interaction[] = [
  {
    id: "reply.sheet.load",
    label: "Open your reply link from an email, first time on this phone",
    surface: "reply", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["B4", "D4"], routes: ["/r/[token]"],
    act: (c) => c.visit(`/r/${c.world.member.replyToken}`),
    done: () => ({ selector: "textarea" }),
  },
  {
    id: "reply.sheet.warm",
    label: "Come back to your reply link",
    surface: "reply", kind: "page-load", viewer: "anon", cache: "warm",
    flows: ["D4", "K2"], routes: ["/r/[token]"],
    act: (c) => c.visit(sheetPath(c)),
    done: () => ({ selector: "textarea" }),
  },
  {
    id: "reply.answer.type",
    label: "Type a letter into an answer",
    surface: "reply", kind: "instant", viewer: "anon",
    flows: ["D4"], routes: ["/r/[token]"],
    prepare: freshSheet,
    act: (c) => firstAnswer(c).pressSequentially("a"),
    // Every box on the sheet is empty and showing its placeholder until the letter lands.
    done: () => ({ selector: "textarea:not(:placeholder-shown)" }),
  },
  {
    id: "reply.answer.autosave",
    label: "Type a letter and see the answer saved",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["D4"], routes: ["/r/[token]", "/api/reply/[token]"],
    prepare: freshSheet,
    act: (c) => firstAnswer(c).pressSequentially("a"),
    done: () => ({ selector: ".question-status span", text: "Saved" }),
  },
  {
    id: "reply.poll.pick",
    label: "Pick a poll option",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["L2"], routes: ["/r/[token]", "/api/reply/[token]"],
    prepare: async (c) => {
      await freshSheet(c);
      await live(c.page.locator(`[data-paper="poll"] input`).first());
    },
    act: (c) => c.page.locator(`[data-paper="poll"]`).getByLabel("The lake").check(),
    done: () => ({ selector: `[data-paper="poll"] p[aria-live="polite"]`, text: "Pick saved" }),
  },
  {
    id: "reply.photo.attach",
    label: "Attach a photo to an answer",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["T1"], routes: ["/r/[token]", "/api/reply/[token]/photo"],
    prepare: async (c) => {
      await freshSheet(c);
      await live(c.page.locator(`input[id^="photo-"]`).first());
    },
    act: (c) => c.page.locator(`input[id^="photo-"]`).first().setInputFiles(PHOTO),
    done: () => ({ selector: `[data-paper="answer"] [aria-live="polite"]`, text: "Photo saved" }),
  },
  {
    id: "reply.voice.attach",
    label: "Attach a voice note from a file",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["J4", "J6"], routes: ["/r/[token]", "/api/reply/[token]/audio"],
    prepare: async (c) => {
      await freshSheet(c);
      await live(c.page.locator(`input[id^="audio-"]`).first());
    },
    act: (c) => c.page.locator(`input[id^="audio-"]`).first().setInputFiles(VOICE),
    done: () => ({ selector: `[data-paper="answer"] [aria-live="polite"]`, text: "Voice note saved." }),
  },
  {
    id: "reply.wall.photo",
    label: "Add a photo to the photo wall",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["K4", "T1"], routes: ["/r/[token]", "/api/reply/[token]/section-media"],
    prepare: async (c) => {
      await freshSheet(c);
      await live(extras(c, "Photo wall").locator(`input[type="file"]`).first());
    },
    act: (c) => extras(c, "Photo wall").locator(`input[type="file"]`).first().setInputFiles(WALL_PHOTO),
    done: () => ({ selector: `[data-paper="note"] p[role="status"]`, text: "Photo added." }),
  },
  {
    id: "reply.music.paste",
    label: "Paste a music link and leave the field",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["K5"], routes: ["/r/[token]", "/api/reply/[token]"],
    prepare: async (c) => {
      await freshSheet(c);
      const link = c.page.getByPlaceholder("Spotify, Bandcamp or Qobuz link");
      await live(link);
      // A link the seed already has metadata for: the save never waits on Spotify, in the lab or here.
      await link.fill("https://open.spotify.com/album/perf26x0");
    },
    act: (c) => extras(c, "Now playing").locator("h3").click(),
    done: () => ({ selector: `[data-paper="note"] span[aria-live="polite"]`, text: "Saved" }),
  },
  {
    id: "reply.answer.submit",
    label: "Send your answers and see the confirmation",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["D5"], routes: ["/r/[token]", "/api/reply/[token]"],
    prepare: async (c) => {
      const round = await c.world.throwawayRound();
      await sheet(c, `/r/${round.members[0].replyToken}`);
      await firstAnswer(c).fill("Answered in the lab.");
    },
    act: (c) => c.page.getByRole("button", { name: "Send answers" }).click(),
    done: () => ({ selector: "#reply-confirmation-heading", text: "Sent" }),
  },
  {
    id: "reply.edit.open",
    label: "Press Edit my answers after sending",
    surface: "reply", kind: "instant", viewer: "anon",
    flows: ["D5"], routes: ["/r/[token]"],
    prepare: async (c) => {
      const round = await c.world.throwawayRound();
      await sheet(c, `/r/${round.members[0].replyToken}`);
      await firstAnswer(c).fill("Answered in the lab.");
      await c.page.getByRole("button", { name: "Send answers" }).click();
      await c.page.locator("#reply-confirmation-heading").waitFor();
    },
    act: (c) => c.page.getByRole("button", { name: "Edit my answers" }).click(),
    done: () => ({ selector: "textarea" }),
  },
  {
    id: "reply.edit.save",
    label: "Change a sent answer and press Done",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["D6"], routes: ["/r/[token]", "/api/reply/[token]"],
    prepare: async (c) => {
      const round = await c.world.throwawayRound();
      const one = round.members[0];
      await c.world.query(`insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at)
        values ('${round.issueId}', '${round.issueQuestionIds[0]}', '${one.id}', 'First version.', 'submitted', now())`);
      await sheet(c, `/r/${one.replyToken}`);
      await firstAnswer(c).fill("Second version, with the good detail.");
    },
    act: (c) => c.page.getByRole("button", { name: "Done", exact: true }).click(),
    done: () => ({ selector: "#reply-confirmation-heading", text: "Changes saved" }),
  },
  {
    id: "reply.suggest.load",
    label: "Open the page for suggesting a question",
    surface: "reply", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["I1"], routes: ["/r/[token]/suggest"],
    act: (c) => c.visit(`${sheetPath(c)}/suggest`),
    done: () => ({ selector: "textarea" }),
  },
  {
    id: "reply.suggest.submit",
    label: "Send a suggested question",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["I1"], routes: ["/r/[token]/suggest", "/api/suggest/[token]"],
    prepare: async (c) => {
      await c.world.query(`delete from question_suggestions where group_id = '${c.world.loopId}' and text like 'Perf %'`);
      await c.page.goto(`${sheetPath(c)}/suggest`);
      const field = c.page.getByLabel("Your question");
      await live(field);
      await field.fill(`Perf suggestion ${c.unique}?`);
    },
    act: (c) => c.page.getByRole("button", { name: "Send suggestion" }).click(),
    done: () => ({ selector: "p", text: "Suggestion sent" }),
  },
  {
    id: "reply.profile.photo",
    label: "Set your photo from your reply link",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["N5", "T1"], routes: ["/r/[token]", "/api/reply/[token]/profile-photo"],
    prepare: async (c) => {
      await c.world.query(`update memberships set photo_url = null where id = '${bob(c).membershipId}'`);
      await sheet(c, sheetPath(c));
      const summary = c.page.locator("details.reply-identity summary");
      await live(summary);
      await summary.click();
      await live(c.page.getByLabel("Choose a photo of yourself"));
    },
    act: (c) => c.page.getByLabel("Choose a photo of yourself").setInputFiles(AVATAR),
    done: () => ({ selector: `.reply-identity p[aria-live="polite"]`, text: "Photo saved." }),
  },
  {
    id: "reply.reminder.change",
    label: "Change your reminder preference",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["R3"], routes: ["/r/[token]"],
    prepare: async (c) => {
      await c.world.query(`update memberships set reminder_preference = 'all' where id = '${bob(c).membershipId}'`);
      await sheet(c, sheetPath(c));
      await live(c.page.locator("#reminders").getByLabel("No reminders"));
    },
    act: (c) => c.page.locator("#reminders").getByLabel("No reminders").check(),
    done: () => ({ selector: `#reminders p[aria-live="polite"]`, text: "Saved." }),
  },
  {
    id: "reply.leave.load",
    label: "Open the page for leaving the loop",
    surface: "reply", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["V3"], routes: ["/r/[token]/leave"],
    act: (c) => c.visit(`${sheetPath(c)}/leave`),
    done: () => ({ selector: `input[name="confirm"]` }),
  },
  {
    id: "reply.leave.confirm",
    label: "Leave a loop and land on goodbye",
    surface: "reply", kind: "write", viewer: "anon",
    flows: ["V3"], routes: ["/r/[token]/leave", "/goodbye"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.page.goto(`/r/${loop.members[0].replyToken}/leave`);
      const box = c.page.locator(`input[name="confirm"]`);
      await live(box);
      await box.check();
    },
    act: (c) => c.page.getByRole("button", { name: "Leave and delete my answers" }).click(),
    done: () => ({ selector: "h1", text: "It's all gone.", path: "^/goodbye" }),
  },
  {
    id: "reply.export.download",
    label: "Download what you wrote in this loop",
    surface: "reply", kind: "navigation", viewer: "anon",
    flows: ["V4"], routes: ["/r/[token]/leave", "/r/[token]/export"],
    prepare: async (c) => {
      await c.page.goto(`${sheetPath(c)}/leave`);
      await catchDownload(c, `${sheetPath(c)}/export`);
    },
    act: (c) => c.page.getByRole("link", { name: "Download what I wrote here" }).click(),
    done: () => DOWNLOADED,
  },
  {
    id: "reply.invalid.load",
    label: "Open a reply link that doesn't work",
    surface: "reply", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["A6"], routes: ["/r/[token]"],
    act: (c) => c.visit("/r/not-a-token-anyone-was-sent"),
    done: () => ({ selector: "h1", text: "This link doesn't work anymore" }),
  },
  {
    id: "reply.reader.load",
    label: "Open your link as a reader, with nothing to answer",
    surface: "reply", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["N5"], routes: ["/r/[token]"],
    act: (c) => c.visit(`/r/${c.world.reader.replyToken}`),
    done: () => ({ selector: "h1", text: "You're a reader in" }),
  },
  {
    id: "reply.nothingopen.load",
    label: "Open your link when no round is open",
    surface: "reply", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["N5"], routes: ["/r/[token]"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      nobody.put(c, loop.members[0].replyToken);
    },
    act: (c) => c.visit(`/r/${nobody.take(c)}`),
    done: () => ({ selector: "h1", text: "Nothing open right now" }),
  },
];
