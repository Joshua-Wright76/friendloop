import { addMember, seedLoop, seedOpenIssue } from "../../e2e/support/seed.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { holdSession, postServerAction, resumeSession, serverActionId } from "../lib/flow-helpers.mjs";

const AREA = "G · Roles and permissions";
const OWNER = "owner@friendloop.test";

export const flows = {
  G3: { title: "Promote to admin", area: AREA,
    staged: "One tab plays both people. Max's session cookie is set aside and restored unchanged, standing in for his browser staying signed in.",
    seed: async () => {
      const loop = await seedLoop();
      await addMember(loop, { email: "max@friendloop.test", name: "Max", access: "member" });
      return { loop };
    },
    run: async (t, { loop }) => {
      const people = `/g/${loop.groupId}/members`;
      await t.signInAs("max@friendloop.test");
      await t.say("Max is signed in as a plain member: no invite form");
      await t.open(people);
      await t.see("max@friendloop.test");
      await t.dontSee("Email addresses");
      const session = await holdSession(t);
      await t.say("Meanwhile the owner promotes Max to admin");
      await t.signInAs(OWNER);
      await t.open(people);
      await t.button("Role for Max");
      await t.clickRole("option", "Admin", { exact: true });
      await t.see("max@friendloop.test");
      await t.pause(800);
      const [row] = await t.sql("select access from memberships where email = 'max@friendloop.test'");
      t.check_(row.access === "admin", `Max is ${row.access}`);
      await t.say("Back in Max's session, with no new sign-in: the invite form is there");
      await resumeSession(t, session);
      await t.open(people);
      await t.see("Email addresses");
      await t.say("He can manage questions too");
      await t.open(`/g/${loop.groupId}/questions`);
      await t.see("New question");
      await t.say("Owner-only settings still send him back");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.expectUrl(new RegExp(`/g/${loop.groupId}$`));
      await t.dontSee("Delete forever");
      await t.pause(1000);
    } },

  G4: { title: "Reader cannot reply", area: AREA,
    staged: "The POST is made outside the page, since a reader's page has no form to submit.",
    seed: async () => {
      const loop = await seedLoop();
      const reader = await addMember(loop, { email: "reader@friendloop.test", name: "Rae", participation: "reader" });
      const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
      return { reader, issue };
    },
    run: async (t, { reader, issue }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.say("Rae is a reader: her link has no answer form");
      await t.open(`/r/${reader.token}`);
      await t.see("You're a reader");
      await t.dontSee("What made you laugh");
      const [question] = await t.sql("select id from issue_questions where issue_id = $1 order by position limit 1", [issue.issueId]);
      await t.say("She posts straight to the reply endpoint for a real question");
      const response = await t.request("POST", `/api/reply/${reader.token}`, {
        body: { action: "draft", issueQuestionId: question.id, body: "Let me in" },
        title: "POST /api/reply/<Rae's token>",
      });
      t.check_(response.status === 403, `Expected 403, got ${response.status}`);
      const [{ n }] = await t.sql("select count(*)::int as n from replies where issue_id = $1", [issue.issueId]);
      t.check_(n === 0, `${n} replies were written`);
      await t.say("Nothing was written");
      await t.panel("replies for this round", `rows: ${n}`);
    } },

  G6: { title: "from_you mode", area: AREA,
    staged: "The forced POST uses the participation action's real id, sent from the page with the owner's own cookies. The same POST changing someone in an ordinary loop is the control that shows it reaches the action.",
    seed: async () => ({
      loop: await seedLoop({ mode: "from_you" }),
      control: await seedLoop({ name: "Ordinary Loop", members: [{ email: "carol@friendloop.test", name: "Carol" }] }),
    }),
    run: async (t, { loop, control }) => {
      await t.signInAs(OWNER);
      await t.say("In a “from you” loop, the owner invites a fan");
      await t.open(`/g/${loop.groupId}/members`);
      await t.fillLabel("Email addresses", "fan@friendloop.test");
      await t.button("Send invitations");
      await t.see("Invitations sent.");
      await t.dontSee("Invite them as readers");
      const [fan] = await t.sql("select id, participation from memberships where email = 'fan@friendloop.test'");
      t.check_(fan.participation === "reader", `The fan is a ${fan.participation}`);
      await t.say("They join as a reader, and the card offers no way to change that");
      await t.see("fan@friendloop.test");
      const pickers = await t.eval(`[...document.querySelectorAll("button[aria-label^='How ']")].length`);
      t.check_(pickers === 0, `${pickers} participation pickers are on screen`);
      await t.panel("memberships", `fan@friendloop.test  participation = ${fan.participation}`);
      await t.say("Forcing it with a POST changes nothing");
      const id = await serverActionId(t, "participationAction");
      const people = `/g/${loop.groupId}/members`;
      // Control: the same POST in an ordinary loop does change someone, so it reaches the action.
      const carol = control.members.find((member) => member.email.startsWith("carol"));
      await postServerAction(t, people, id, { groupId: control.groupId, membershipId: carol.id, participation: "reader" });
      const [flipped] = await t.sql("select participation from memberships where id = $1", [carol.id]);
      t.check_(flipped.participation === "reader", "The control POST did not reach the action");
      const response = await postServerAction(t, people, id, { groupId: loop.groupId, membershipId: fan.id, participation: "contributor" });
      const [after] = await t.sql("select participation from memberships where id = $1", [fan.id]);
      t.check_(after.participation === "reader", "A from_you member was made a contributor");
      await t.panel("POST participationAction", `ordinary loop, contributor → reader: now ${flipped.participation}\nfrom-you loop, reader → contributor: HTTP ${response.status}, still ${after.participation}`, { hold: 4500 });
      await t.say("The invitation email arrives too");
      await t.openMail({ to: "fan@friendloop.test" });
      t.mailLink("/r/");
    } },
};
