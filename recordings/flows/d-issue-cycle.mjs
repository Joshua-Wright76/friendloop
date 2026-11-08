import { seedLoop, seedOpenIssue, seedReplies } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DELIVERY_DAY, HOUR } from "../../e2e/support/clock.ts";

const AREA = "D · The issue cycle";
const OWNER = "owner@friendloop.test";
const ALICE = "alice@friendloop.test";
const BOB = "bob@friendloop.test";
const LAUGH = "What made you laugh this week?";
const FORWARD = "What are you looking forward to?";
const PROMPT_SUBJECT = "questions for Friday Loop";
const REMINDER_SUBJECT = "Still time for Friday Loop";
const member = (loop, start) => loop.members.find((item) => item.email.startsWith(start));

const count = async (where = "true", params = [], table = "outbox") => {
  const [row] = await rows(`select count(*)::int as count from ${table} where ${where}`, params);
  return row.count;
};

/** Wait until the textareas are measured: the sheet has hydrated. */
const waitForSheet = async (t) => {
  for (let i = 0; i < 40; i++) {
    if (await t.eval(`/height:\\s*\\d+px/.test(document.querySelector("textarea")?.getAttribute("style") ?? "")`)) return;
    await t.pause(150);
  }
  t.check_(false, "The answer sheet never hydrated");
};

/** Type into the Nth answer box, centred first so the sticky send bar can't cover it. */
const answer = async (t, index, text) => {
  await t.eval(`(() => {
    const el = document.querySelectorAll("textarea")[${index}];
    el.setAttribute("data-flrec-answer", "${index}");
    el.scrollIntoView({ block: "center" });
  })()`);
  await t.pause(300);
  await t.ab("click", `[data-flrec-answer="${index}"]`);
  await t.selectAllAndClear();
  await t.typeKeys(text);
};

/** Mailpit renders the message in an iframe, so assert on the message it holds. */
const mailSays = (t, needle) => {
  const body = `${t.lastMail?.HTML ?? ""}\n${t.lastMail?.Text ?? ""}`;
  t.check_(body.includes(needle), `The email should say "${needle}"`);
};

export const flows = {
  D1: { title: "Open an issue on schedule", area: AREA,
    staged: "The cron endpoint is called directly with the clock set past the loop's Friday 09:00 slot. Its report and the rows are real, and the emails went through the real provider path into Mailpit.",
    seed: async () => ({ loop: await seedLoop() }),
    run: async (t, { loop }) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/issues`);
      await t.say("Friday Loop has never had a round");
      await t.see("Nothing open right now");
      await t.say("The clock is past Friday 09:00, and the scheduled sweep runs");
      const report = await t.sweep(new Date(AFTER_FIRST_SLOT));
      t.check_(report.opened === 1, `Expected one round opened, got ${report.opened}`);
      const issues = await rows("select number, status from issues where group_id = $1", [loop.groupId]);
      const snapshot = await rows("select text from issue_questions order by position");
      const prompts = await rows(`select "to", status from outbox where kind = 'prompt' order by "to"`);
      t.check_(issues.length === 1 && issues[0].status === "open", "Expected exactly one open issue");
      t.check_(snapshot.length === 2, "Expected a snapshot of both questions");
      t.check_(prompts.length === 3, "Expected one prompt per contributor");
      await t.say("One issue, a snapshot of its questions, one prompt per contributor");
      await t.panel("Database after the sweep", [
        `issues: ${issues.length} (round ${issues[0].number}, ${issues[0].status})`,
        "issue_questions:", ...snapshot.map((row) => `  ${row.text}`),
        "outbox, kind = prompt:", ...prompts.map((row) => `  ${row.to}  ${row.status}`),
      ].join("\n"), { hold: 4500 });
      await t.say("The round is open on the owner's page");
      await t.reload();
      await t.see("Round 1 is open now");
      await t.waitForMail({ subject: PROMPT_SUBJECT }, { count: 3 });
      await t.say("All three contributors got an email");
      await t.openMail({ to: ALICE, subject: PROMPT_SUBJECT });
      t.mailLink("/r/");
      mailSays(t, "is open");
      await t.pause(800);
    } },

  D2: { title: "Do not open early or twice", area: AREA,
    staged: "The cron endpoint is called directly at chosen instants. Reports and counts are real.",
    seed: async () => ({ loop: await seedLoop() }),
    run: async (t, { loop }) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/issues`);
      await t.say("Thursday 07:59, the day before the slot: the sweep opens nothing");
      const early = await t.sweep(new Date(BEFORE_FIRST_SLOT));
      t.check_(early.opened === 0, "Nothing should open before the slot");
      await t.reload();
      await t.see("Nothing open right now");
      await t.say("Past the slot: exactly one round opens");
      const first = await t.sweep(new Date(AFTER_FIRST_SLOT));
      t.check_(first.opened === 1, "The slot should open one round");
      await t.say("The same slot again: nothing new");
      const second = await t.sweep(new Date(AFTER_FIRST_SLOT));
      t.check_(second.opened === 0, "A second sweep must not open a round");
      const issues = await count("group_id = $1", [loop.groupId], "issues");
      const prompts = await count("kind = 'prompt'");
      t.check_(issues === 1 && prompts === 3, `Expected 1 issue and 3 prompts, got ${issues} and ${prompts}`);
      await t.panel("Database after both sweeps", `issues: ${issues}\nprompt emails in outbox: ${prompts}`);
      await t.reload();
      await t.see("Round 1 is open now");
      await t.say("Mailpit holds three emails, not six");
      await t.waitForMail({ subject: PROMPT_SUBJECT }, { count: 3 });
      t.check_(await t.mailCount({ subject: PROMPT_SUBJECT }) === 3, "Expected exactly 3 prompt emails");
      await t.open(`${t.stack.mailpit}/`);
      await t.see(PROMPT_SUBJECT);
      await t.pause(1200);
    } },

  D3: { title: "Start an issue manually", area: AREA,
    staged: "The later sweep is the cron endpoint called directly, with the clock set past the scheduled slot.",
    seed: async () => ({ loop: await seedLoop() }),
    run: async (t, { loop }) => {
      await t.clock(new Date(BEFORE_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}`);
      await t.say("The owner doesn't wait for Friday");
      await t.see("Next round");
      await t.button("Send now");
      await t.say("The round opens at once");
      await t.see("Round 1 is open and everyone");
      await t.say("Every contributor is emailed");
      await t.waitForMail({ subject: PROMPT_SUBJECT }, { count: 3 });
      await t.openMail({ to: BOB, subject: PROMPT_SUBJECT });
      await t.say("Friday's slot arrives and the scheduled sweep runs");
      const report = await t.sweep(new Date(AFTER_FIRST_SLOT));
      const issues = await count("group_id = $1", [loop.groupId], "issues");
      const prompts = await count("kind = 'prompt'");
      const duplicated = report.opened !== 0 || issues !== 1 || prompts !== 3;
      await t.panel("Database after the scheduled slot", `sweep opened: ${report.opened}\nissues: ${issues}\nprompt emails in outbox: ${prompts}`, { hold: 4500 });
      t.check_(!duplicated, `Send now did not prevent a duplicate: the sweep opened ${report.opened}, leaving ${issues} issues and ${prompts} prompt emails`);
      await t.say("The rounds page shows what the owner now has");
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.open(`/g/${loop.groupId}/issues`);
      await t.see("Round 1");
      await t.pause(2000);
      await t.say("And what reached the inbox");
      await t.open(`${t.stack.mailpit}/`);
      await t.see(PROMPT_SUBJECT);
      await t.pause(2000);
      t.check_(!duplicated, `Send now did not prevent a duplicate: the Friday sweep opened ${report.opened}, leaving ${issues} issues and ${prompts} prompt emails`);
    } },

  D4: { title: "Draft autosaves", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedOpenIssue(loop, { openedAt: new Date(AFTER_FIRST_SLOT) });
      return { loop, issue, alice: member(loop, "alice") };
    },
    run: async (t, { alice, issue }) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.open(`/r/${alice.token}`);
      await waitForSheet(t);
      await t.say("Alice starts answering and doesn't press anything");
      await t.see(LAUGH);
      await t.see("Closes Friday 9:05 AM");
      await answer(t, 0, "The dog, the baguette, the whole thing.");
      await t.say("Her words save themselves");
      await t.see("Draft saved");
      await answer(t, 1, "Soup season, finally.");
      await t.see("2 of 2 answered");
      await t.pause(1200);
      const drafts = await rows("select body, status from replies where issue_id = $1 and membership_id = $2 and body <> '' order by created_at", [issue.issueId, alice.id]);
      t.check_(drafts.length === 2 && drafts.every((row) => row.status === "draft"), "Expected two draft rows");
      await t.panel("replies table", drafts.map((row) => `${row.status}  ${row.body}`).join("\n"));
      await t.say("She reloads the page, and every draft is still there");
      await t.reload();
      await waitForSheet(t);
      const values = await t.eval(`[...document.querySelectorAll("textarea")].map((el) => el.value)`);
      t.check_(values.includes("The dog, the baguette, the whole thing.") && values.includes("Soup season, finally."), `Drafts were not restored: ${JSON.stringify(values)}`);
      await t.see("2 of 2 answered");
      await t.pause(1000);
    } },

  D5: { title: "Submit answers", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedOpenIssue(loop, { openedAt: new Date(AFTER_FIRST_SLOT) });
      return { loop, issue, alice: member(loop, "alice") };
    },
    run: async (t, { loop, issue, alice }) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}`);
      await t.say("The owner's page: nobody has answered yet");
      await t.see("0 of 3 people in");
      await t.signInAs(null);
      await t.say("Alice answers both questions");
      await t.open(`/r/${alice.token}`);
      await waitForSheet(t);
      await answer(t, 0, "A cat fist bump.");
      await answer(t, 1, "Friday, obviously.");
      await t.button("Send answers");
      await t.say("A screen of its own confirms it, and names when it goes out");
      await t.see("Your answers are in for Round 1.");
      await t.see("It goes out to everyone Friday 9:05 AM");
      const focused = await t.eval(`document.activeElement?.tagName + ":" + document.activeElement?.textContent`);
      t.check_(/^H\d:\s*Sent/.test(focused), `Focus should be on the Sent heading, was ${focused}`);
      const saved = await rows("select status, submitted_at from replies where issue_id = $1 and membership_id = $2", [issue.issueId, alice.id]);
      t.check_(saved.length === 2 && saved.every((row) => row.status === "submitted" && row.submitted_at), `Replies should be submitted with a timestamp: ${JSON.stringify(saved)}`);
      await t.panel("replies table", saved.map((row) => `${row.status}  submitted_at ${new Date(row.submitted_at).toISOString()}`).join("\n"));
      await t.say("\"Edit my answers\" brings the sheet back, answers intact");
      await t.button("Edit my answers");
      await waitForSheet(t);
      const values = await t.eval(`[...document.querySelectorAll("textarea")].map((el) => el.value)`);
      t.check_(values.includes("A cat fist bump.") && values.includes("Friday, obviously."), "Answers should survive");
      await t.see("Sent. You can change these until Friday 9:05 AM");
      await t.see("Save changes");
      await t.say("A later visit opens the sheet itself, with its quiet Sent note");
      await t.reload();
      await waitForSheet(t);
      await t.see("Sent. You can change these until Friday 9:05 AM");
      await t.say("And the owner's count went up");
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}`);
      await t.see("1 of 3 people in");
      await t.pause(800);
    } },

  D6: { title: "Edit a submitted answer", area: AREA,
    staged: "The clock moves forward an hour between the two sends, so the changed timestamp is visible.",
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedOpenIssue(loop, { openedAt: new Date(AFTER_FIRST_SLOT) });
      return { issue, alice: member(loop, "alice") };
    },
    run: async (t, { issue, alice }) => {
      const answered = () => rows("select id, body, status, submitted_at from replies where issue_id = $1 and membership_id = $2 and body <> ''", [issue.issueId, alice.id]);
      const total = () => count("issue_id = $1 and membership_id = $2", [issue.issueId, alice.id], "replies");
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.open(`/r/${alice.token}`);
      await waitForSheet(t);
      await t.say("Alice sends a first version");
      await answer(t, 0, "First version.");
      await t.button("Send answers");
      await t.see("Your answers are in for Round 1.");
      const [before] = await answered();
      const rowsBefore = await total();
      await t.panel("replies table", `${before.status}  "${before.body}"\nsubmitted_at ${new Date(before.submitted_at).toISOString()}\nrows for Alice: ${rowsBefore}`);
      await t.say("An hour later she thinks of the good detail");
      await t.clock(new Date(AFTER_FIRST_SLOT.getTime() + HOUR));
      await t.button("Edit my answers");
      await waitForSheet(t);
      await answer(t, 0, "Second version, with the good detail.");
      await t.button("Save changes");
      await t.say("The confirmation calls it a change this time");
      await t.see("Changes sent");
      const after = await answered();
      const rowsAfter = await total();
      t.check_(after.length === 1 && after[0].id === before.id, "The same row should be updated");
      t.check_(after[0].body === "Second version, with the good detail.", `The answer should be the new text, was: ${after[0].body}`);
      t.check_(rowsAfter === rowsBefore, `No duplicate rows: ${rowsBefore} became ${rowsAfter}`);
      t.check_(new Date(after[0].submitted_at) > new Date(before.submitted_at), "submitted_at should move forward");
      await t.panel("Same row, updated in place", `${after[0].status}  "${after[0].body}"\nsubmitted_at ${new Date(after[0].submitted_at).toISOString()}\nrows for Alice: ${rowsAfter}`, { hold: 4500 });
      await t.say("Coming back, the sheet holds the new answer");
      await t.reload();
      await waitForSheet(t);
      await t.see("Save changes");
      const values = await t.eval(`[...document.querySelectorAll("textarea")].map((el) => el.value)`);
      t.check_(values.includes("Second version, with the good detail."), "The new answer should be on the sheet");
      await t.pause(1000);
    } },

  D7: { title: "Deliver the issue", area: AREA,
    staged: "The answers are seeded and the cron endpoint is called directly at the delivery instant. A second loop is seeded so the separation check has something to catch. The emails are real.",
    seed: async () => {
      const loop = await seedLoop();
      const other = await seedLoop({ name: "Second Loop" });
      const issue = await seedOpenIssue(loop, { openedAt: new Date(AFTER_FIRST_SLOT) });
      const otherIssue = await seedOpenIssue(other, { openedAt: new Date(AFTER_FIRST_SLOT) });
      await seedReplies({ issueId: issue.issueId, membershipId: member(loop, "alice").id, answers: [{ text: LAUGH, body: "The cat fist bump." }] });
      await seedReplies({ issueId: issue.issueId, membershipId: member(loop, "bob").id, answers: [{ text: FORWARD, body: "A very long lunch." }] });
      await seedReplies({ issueId: otherIssue.issueId, membershipId: member(other, "alice").id, answers: [{ text: LAUGH, body: "ONLY-IN-SECOND." }] });
      return { loop, other, issue, otherIssue, alice: member(loop, "alice") };
    },
    run: async (t, { loop, issue, alice }) => {
      await t.clock(new Date(DELIVERY_DAY));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/issues`);
      await t.say("Round 1 is open, and it's delivery day");
      await t.see("Round 1 is open now");
      await t.say("The sweep delivers both loops' rounds");
      const report = await t.sweep(new Date(DELIVERY_DAY));
      t.check_(report.delivered === 2, `Expected 2 delivered, got ${report.delivered}`);
      const [saved] = await rows("select status from issues where id = $1", [issue.issueId]);
      t.check_(saved.status === "delivered", "The issue should be delivered");
      const mails = await rows(`select "to", html, group_id, membership_id from outbox where kind = 'delivery' order by group_id, "to"`);
      const mine = mails.filter((row) => row.group_id === loop.groupId);
      const leaks = mine.filter((row) => row.html.includes("ONLY-IN-SECOND.") || row.html.includes("Second Loop")).length
        + mails.filter((row) => row.group_id !== loop.groupId && row.html.includes("The cat fist bump.")).length;
      t.check_(mine.length === 3, `Expected 3 deliveries for this loop, got ${mine.length}`);
      t.check_(leaks === 0, `${leaks} email(s) carry another loop's answers`);
      t.check_(mine.every((row) => row.html.includes("The cat fist bump.") && row.html.includes("A very long lunch.")), "Every email carries every answer");
      await t.panel("Database after delivery", [
        `issue status: ${saved.status}`,
        "delivery emails for Friday Loop:", ...mine.map((row) => `  ${row.to}`),
        `emails holding another loop's answers: ${leaks}`,
      ].join("\n"), { hold: 4500 });
      await t.say("The email carries every answer");
      await t.waitForMail({ subject: "Friday Loop · Round 1" }, { count: 3 });
      await t.openMail({ to: ALICE, subject: "Friday Loop · Round 1" });
      await t.pause(1500);
      const link = t.mailLink(`/i/${issue.issueId}?m=`);
      t.check_(link.includes(encodeURIComponent(alice.token)), "The link should be Alice's own");
      await t.say("And the link inside is Alice's own");
      await t.signInAs(null);
      await t.open(link);
      await t.see("Round 1");
      await t.see("The cat fist bump.");
      await t.see("You");
      await t.dontSee("ONLY-IN-SECOND.");
      await t.pause(800);
    } },

  D8: { title: "Nothing to deliver", area: AREA,
    staged: "The cron endpoint is called directly at the delivery instant of a round with no answers.",
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedOpenIssue(loop, { openedAt: new Date(AFTER_FIRST_SLOT) });
      return { loop, issue };
    },
    run: async (t, { loop, issue }) => {
      await t.clock(new Date(DELIVERY_DAY));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}`);
      await t.say("Delivery day, and nobody answered");
      await t.see("0 of 3 people in");
      await t.say("The sweep runs");
      const report = await t.sweep(new Date(DELIVERY_DAY));
      t.check_(report.skipped === 1 && report.delivered === 0, "The round should be skipped, not delivered");
      const [saved] = await rows("select status from issues where id = $1", [issue.issueId]);
      const [group] = await rows("select paused_at from groups where id = $1", [loop.groupId]);
      const deliveries = await count("kind = 'delivery'");
      t.check_(saved.status === "skipped" && group.paused_at && deliveries === 0, "Skipped, paused, and no delivery email");
      await t.panel("Database after the sweep", `issue status: ${saved.status}\nloop paused_at: ${new Date(group.paused_at).toISOString()}\ndelivery emails: ${deliveries}`);
      await t.say("The owner hears about it, with the reason");
      await t.openMail({ to: OWNER, subject: "paused itself" });
      mailSays(t, "Nobody answered this round");
      t.check_(await t.mailCount({ subject: "Friday Loop · Round" }) === 0, "No delivery email goes to anyone");
      const after = await rows("select number, status from issues where group_id = $1 order by number", [loop.groupId]);
      const prompts = await count("kind = 'prompt'");
      t.check_(!after.some((row) => row.status === "open") && prompts === 0, "A loop that paused itself opens no new round");
      await t.say("The loop itself says it's paused");
      await t.open(`/g/${loop.groupId}`);
      await t.see("Paused");
      await t.see("Nothing goes out until you resume it.");
      await t.pause(800);
    } },

  D9: { title: "Nudge the stragglers", area: AREA,
    staged: "Alice's answer is seeded. The cron endpoint is called directly a day before delivery, inside the 48-hour reminder window.",
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
      await seedReplies({ issueId: issue.issueId, membershipId: member(loop, "alice").id, answers: [{ text: LAUGH, body: "Already answered." }] });
      return { loop, issue };
    },
    run: async (t, { loop, issue }) => {
      const at = new Date(issue.deliversAt.getTime() - 24 * HOUR);
      await t.clock(at);
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}`);
      await t.say("A day to go: Alice has answered, Sam and Bob haven't");
      await t.see("1 of 3 people in");
      await t.say("The sweep reminds the stragglers");
      const first = await t.sweep(at);
      t.check_(first.reminded === 2, `Expected 2 reminders, got ${first.reminded}`);
      await t.say("The second sweep sends none");
      const second = await t.sweep(at);
      t.check_(second.reminded === 0, `A second sweep must not remind again, got ${second.reminded}`);
      const reminders = await rows(`select "to" from outbox where kind = 'reminder' order by "to"`);
      t.check_(reminders.map((row) => row.to).join() === `${BOB},${OWNER}`, `Unexpected reminders: ${reminders.map((row) => row.to).join()}`);
      await t.panel("outbox, kind = reminder", reminders.map((row) => row.to).join("\n"));
      await t.say("One reminder each, and none for Alice");
      await t.waitForMail({ subject: REMINDER_SUBJECT }, { count: 2 });
      t.check_(await t.mailCount({ subject: REMINDER_SUBJECT }) === 2, "Exactly 2 reminder emails");
      t.check_(await t.mailCount({ to: ALICE }) === 0, "Alice gets no reminder");
      await t.open(`${t.stack.mailpit}/`);
      await t.see(REMINDER_SUBJECT);
      await t.pause(800);
      await t.openMail({ to: BOB, subject: REMINDER_SUBJECT }, { inbox: false });
      mailSays(t, "Finish my answers");
    } },

  D10: { title: "Nudge by hand", area: AREA,
    staged: "Alice's answer is seeded, and the last two answers are written directly to the database so the dashboard's final state can be shown.",
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
      await seedReplies({ issueId: issue.issueId, membershipId: member(loop, "alice").id, answers: [{ text: LAUGH, body: "Done already." }] });
      return { loop, issue };
    },
    run: async (t, { loop, issue }) => {
      const reminders = () => rows("select \"to\", dedupe_key from outbox where kind = 'reminder' order by created_at");
      const waitForReminders = async (n) => {
        for (let i = 0; i < 60; i++) {
          if ((await reminders()).length >= n) return;
          await t.pause(150);
        }
        t.check_(false, `Expected ${n} reminder rows, got ${(await reminders()).length}`);
      };
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}`);
      await t.say("The owner sees who hasn't answered");
      await t.see("Waiting on");
      await t.see("Bob");
      await t.say("One tap nudges them");
      await t.button("Send a nudge");
      await t.see("2 nudges sent.");
      await waitForReminders(2);
      await t.say("Sam and Bob get it. Alice, who answered, doesn't.");
      const first = await reminders();
      t.check_(first.every((row) => row.to !== ALICE), "Alice already answered");
      await t.waitForMail({ subject: REMINDER_SUBJECT }, { count: 2 });
      await t.open(`${t.stack.mailpit}/`);
      await t.see(REMINDER_SUBJECT);
      await t.pause(800);
      await t.say("A day later, the owner nudges again");
      await t.clock(new Date(AFTER_FIRST_SLOT.getTime() + 24 * HOUR));
      await t.open(`/g/${loop.groupId}`);
      await t.button("Send a nudge");
      await t.see("2 nudges sent.");
      await waitForReminders(4);
      const all = await reminders();
      t.check_(new Set(all.map((row) => row.dedupe_key)).size === 4, "Each nudge is its own email");
      t.check_(all.every((row) => row.to !== ALICE), "Alice is never nudged");
      await t.waitForMail({ subject: REMINDER_SUBJECT }, { count: 4 });
      await t.panel("outbox, kind = reminder", `rows: ${all.length}, distinct dedupe keys: ${new Set(all.map((row) => row.dedupe_key)).size}\n${[...new Set(all.map((row) => row.to))].join("\n")}\nemails in Mailpit: ${await t.mailCount({ subject: REMINDER_SUBJECT })}`);
      await t.say("Once everyone has answered, there's no one left to nudge");
      await rows(`insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at)
        select $1, iq.id, m.id, 'Answered.', 'submitted', now() from issue_questions iq cross join memberships m
        where iq.issue_id = $1 and iq.position = 0 and m.group_id = $2 and m.email <> $3`, [issue.issueId, loop.groupId, ALICE]);
      await t.reload();
      await t.see("Everyone's in.");
      await t.dontSee("Send a nudge");
      await t.pause(800);
    } },

  D11: { title: "Two triggers at once", area: AREA,
    staged: "Each pair of sweeps is two real, simultaneous requests to the cron endpoint. Alice's answer is written to the database, and the mail goes to Mailpit through the real provider path.",
    seed: async () => ({ loop: await seedLoop() }),
    run: async (t, { loop }) => {
      const both = async (at) => {
        const [a, b] = await Promise.all([t.sweep(at, { show: false }), t.sweep(at, { show: false })]);
        return { a, b };
      };
      const brief = ({ opened, delivered, reminded, retried, busy }) => JSON.stringify({ opened, delivered, reminded, retried, busy });
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/issues`);
      await t.see("Nothing open right now");
      await t.say("Two triggers fire the sweep at the same moment");
      const open = await both(new Date(AFTER_FIRST_SLOT));
      t.check_(open.a.opened + open.b.opened === 1, `Expected one round opened, got ${open.a.opened + open.b.opened}`);
      const issues = await count("group_id = $1", [loop.groupId], "issues");
      const prompts = await count("kind = 'prompt'");
      await t.waitForMail({ subject: PROMPT_SUBJECT }, { count: 3 });
      const promptMail = await t.mailCount({ subject: PROMPT_SUBJECT });
      t.check_(issues === 1 && prompts === 3 && promptMail === 3, `Expected 1/3/3, got ${issues}/${prompts}/${promptMail}`);
      await t.panel("Two sweeps, same instant", `A: ${brief(open.a)}\nB: ${brief(open.b)}\nissues: ${issues}\nprompt rows: ${prompts}\nprompt emails in Mailpit: ${promptMail}`, { hold: 4500 });
      await t.reload();
      await t.see("Round 1 is open now");

      await t.say("Two days before delivery, both fire again: reminders");
      const [issue] = await rows("select id from issues where group_id = $1", [loop.groupId]);
      const [question] = await rows("select id from issue_questions where issue_id = $1 order by position limit 1", [issue.id]);
      await rows(`insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at) values ($1, $2, $3, 'One answer.', 'submitted', $4)`,
        [issue.id, question.id, member(loop, "alice").id, new Date(AFTER_FIRST_SLOT).toISOString()]);
      const remind = await both(new Date("2026-01-07T09:00:00Z"));
      const reminders = await count("kind = 'reminder'");
      await t.waitForMail({ subject: REMINDER_SUBJECT }, { count: 2 });
      const reminderMail = await t.mailCount({ subject: REMINDER_SUBJECT });
      t.check_(remind.a.reminded + remind.b.reminded === 2 && reminders === 2 && reminderMail === 2, `Expected 2 reminders, got ${remind.a.reminded + remind.b.reminded}/${reminders}/${reminderMail}`);
      await t.panel("Two sweeps, reminder window", `A: ${brief(remind.a)}\nB: ${brief(remind.b)}\nreminder rows: ${reminders}\nreminder emails in Mailpit: ${reminderMail}`, { hold: 4500 });

      await t.say("Delivery day, both fire once more");
      const deliver = await both(new Date("2026-01-09T08:05:00Z"));
      const deliveries = await count("kind = 'delivery'");
      await t.waitForMail({ subject: "Friday Loop · Round 1" }, { count: 3 });
      const deliveryMail = await t.mailCount({ subject: "Friday Loop · Round 1" });
      t.check_(deliver.a.delivered + deliver.b.delivered === 1 && deliveries === 3 && deliveryMail === 3, `Expected 1 delivery and 3 emails, got ${deliver.a.delivered + deliver.b.delivered}/${deliveries}/${deliveryMail}`);
      await t.panel("Two sweeps, delivery", `A: ${brief(deliver.a)}\nB: ${brief(deliver.b)}\ndelivery rows: ${deliveries}\ndelivery emails in Mailpit: ${deliveryMail}`, { hold: 4500 });
      await t.say("Every email exactly once");
      await t.open(`${t.stack.mailpit}/`);
      await t.see("Friday Loop · Round 1");
      await t.pause(1200);
    } },

  D12: { title: "Provider rejects a send", area: AREA,
    staged: "This stack's provider stub can't be switched off, so an outage isn't shown as one. The real rejection is produced by giving two members addresses Mailpit refuses (the 400 returns through the real SDK into the outbox). The rate limit is simulated: a SQL update, shown on screen, writes the 429 text and a good address onto Bob's failed row. Only the retry that follows, the row counts and the resulting email are real.",
    seed: async () => {
      const loop = await seedLoop({ members: [
        { email: ALICE, name: "Alice" },
        { email: "bob@@friendloop.test", name: "Bob" },
        { email: "carol@@friendloop.test", name: "Carol" },
      ] });
      return { loop };
    },
    run: async (t, { loop }) => {
      const failedRows = () => rows(`select id, "to", status, attempts, error, provider_id from outbox where kind = 'prompt' and ("to" like '%@@%' or "to" = $1) order by "to"`, [BOB]);
      const show = (list) => list.map((row) => `${row.id.slice(0, 8)} ${row.to}\n  ${row.status}, attempts ${row.attempts}${row.provider_id ? `, provider id ${row.provider_id.slice(0, 18)}` : ""}${row.error ? `\n  ${row.error.slice(0, 110)}` : ""}`).join("\n");
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/members`);
      await t.say("Two members' addresses are ones the provider will refuse");
      await t.see("bob@@friendloop.test");
      await t.say("The sweep opens a round, and the provider rejects those two");
      const first = await t.sweep(new Date(AFTER_FIRST_SLOT));
      t.check_(first.opened === 1, "The round should open anyway");
      const rejected = await failedRows();
      t.check_(rejected.length === 2 && rejected.every((row) => row.status === "failed" && row.attempts === 2), `Expected two failed rows with two attempts: ${show(rejected)}`);
      t.check_(rejected.every((row) => /invalid To address/.test(row.error ?? "")), `The provider's reason should be kept: ${show(rejected)}`);
      await t.say("Each row is failed, attempts counted, with the provider's reason");
      await t.panel("outbox, the two rejected rows", show(rejected), { hold: 5500 });
      await t.say("The next sweep retries the same rows and queues nothing new");
      const second = await t.sweep(new Date(AFTER_FIRST_SLOT.getTime() + 60_000));
      t.check_(second.opened === 0 && second.retried === 2, `Expected two retries, got ${second.retried}`);
      const retried = await failedRows();
      t.check_(retried.length === 2 && retried.every((row, i) => row.id === rejected[i].id && row.attempts === 3), `Same rows, one more attempt: ${show(retried)}`);
      t.check_(await count("kind = 'prompt'") === 4, "No new prompt rows");
      await t.panel("Same row ids, one more attempt", `${show(retried)}\ntotal prompt rows: ${await count("kind = 'prompt'")}`, { hold: 5500 });

      await t.say("Simulated: Bob's row becomes a rate limit, with a good address");
      await rows(`update outbox set "to" = $1, error = 'Too many requests. Please try again later.' where id = $2`, [BOB, retried[0].id]);
      const throttled = await failedRows();
      await t.panel("STAGED by SQL, not sent by a provider", show(throttled.filter((row) => row.to === BOB)), { hold: 3500 });
      await t.say("The provider recovers: the retry clears the error and the email goes");
      const third = await t.sweep(new Date(AFTER_FIRST_SLOT.getTime() + 120_000));
      t.check_(third.retried === 2, `Expected two retries, got ${third.retried}`);
      const final = await failedRows();
      const bob = final.find((row) => row.to === BOB);
      const carol = final.find((row) => row.to === "carol@@friendloop.test");
      t.check_(bob?.status === "sent" && bob.error === null && bob.provider_id, `Bob's row should clear: ${show(final)}`);
      t.check_(carol?.status === "failed" && /invalid To address/.test(carol.error ?? ""), `Carol's rejection should stay: ${show(final)}`);
      await t.panel("Rate limit cleared, rejection kept", show(final), { hold: 5500 });
      await t.say("Bob's email arrives in Mailpit, from the row that failed");
      await t.openMail({ to: BOB, subject: PROMPT_SUBJECT });
      mailSays(t, "is open");
      t.check_(await t.mailCount({ to: BOB, subject: PROMPT_SUBJECT }) === 1, "Exactly one email for Bob");
      await t.pause(800);
    } },
};
