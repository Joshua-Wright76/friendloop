import { addMember, seedDeliveredIssue, seedLoop, seedOpenIssue } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { card, postServerAction, serverActionId } from "../lib/flow-helpers.mjs";

const AREA = "F · Loop settings";
const OWNER = "owner@friendloop.test";
const count = async (t, table) => (await t.sql(`select count(*)::int as n from ${table}`))[0].n;

export const flows = {
  F1: { title: "Change cadence or timezone", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
      return { loop, issue };
    },
    run: async (t, { loop, issue }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.say("The loop goes out on Fridays at 09:00, and a round is already open");
      await t.open(`/g/${loop.groupId}`);
      await t.see("Friday at 9:00");
      await t.say("The owner moves it in settings");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.pick("Day", "Monday");
      await t.pick("Time", "18:00");
      await t.pick("Every", "Every 2 weeks");
      await t.button("Save changes");
      await t.see("Saved.");
      await t.say("The next send time on the dashboard follows the new schedule");
      await t.open(`/g/${loop.groupId}`);
      await t.see("Monday at 18:00");
      await t.see("Every 2 weeks");
      const [row] = await t.sql("select delivers_at from issues where id = $1", [issue.issueId]);
      t.check_(new Date(row.delivers_at).getTime() === issue.deliversAt.getTime(), "The open round's deadline moved");
      await t.say("The round already open keeps its deadline");
      await t.panel("issues.delivers_at, open round", `before the change: ${issue.deliversAt.toISOString()}\nafter the change:  ${new Date(row.delivers_at).toISOString()}`);
    } },

  F2: { title: "Pause and resume", area: AREA,
    staged: "The clock is pinned and the cron sweep is triggered by hand, so weeks pass in seconds.",
    seed: async () => ({ loop: await seedLoop() }),
    run: async (t, { loop }) => {
      await t.clock(BEFORE_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}`);
      await t.say("The owner pauses the loop from the dashboard");
      await t.button("Pause");
      await t.say("The dashboard says nothing is scheduled");
      await t.see("Nothing scheduled");
      await t.say("Friday's slot passes while paused: the sweep opens nothing");
      const paused = await t.sweep(AFTER_FIRST_SLOT);
      t.check_(paused.opened === 0, `A paused loop opened ${paused.opened} rounds`);
      const resumedAt = new Date("2026-01-21T10:00:00Z");
      await t.clock(resumedAt);
      await t.say("Almost three weeks later the owner resumes in settings");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.button("Resume");
      await t.see("Pause this loop");
      await t.say("The next round counts from the resume moment, with no catch-up");
      await t.open(`/g/${loop.groupId}`);
      await t.dontSee("Nothing scheduled");
      await t.see("Next round");
      const after = await t.sweep(resumedAt);
      t.check_(after.opened === 0, `Resuming opened ${after.opened} missed rounds`);
    } },

  F3: { title: "Remove a member", area: AREA,
    staged: "The clock is pinned and the cron sweep is triggered by hand; Bob's old answer is seeded.",
    seed: async () => {
      const loop = await seedLoop();
      const bob = loop.members.find((member) => member.email.startsWith("bob"));
      const delivered = await seedDeliveredIssue(loop, {
        deliveredAt: new Date("2026-01-01T06:00:00Z"),
        answers: [{ email: "bob@friendloop.test", body: "Something Bob said." }],
      });
      return { loop, bob, delivered };
    },
    run: async (t, { loop, bob, delivered }) => {
      await t.clock(BEFORE_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.say("The owner removes Bob from the loop");
      await t.open(`/g/${loop.groupId}/members`);
      const bobCard = await card(t, "bob@friendloop.test");
      await t.click(`${bobCard} button[aria-label^="Remove"]`);
      await t.say("Removing asks first");
      await t.button("Yes, remove");
      await t.see("They're out of the loop.");
      await t.say("Bob's old link no longer works");
      await t.signInAs(null);
      await t.open(`/r/${bob.token}`);
      await t.see("doesn't work anymore");
      await t.say("The next round's prompts go to everyone else");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.waitForMail({ to: "alice@friendloop.test" });
      await t.open(`${t.stack.mailpit}/`);
      await t.see("alice@friendloop.test");
      const toBob = await t.mailCount({ to: "bob@friendloop.test" });
      t.check_(toBob === 0, `Bob still got ${toBob} emails`);
      await t.panel("Mailpit", `to alice: ${await t.mailCount({ to: "alice@friendloop.test" })}\nto owner: ${await t.mailCount({ to: OWNER })}\nto bob:   ${toBob}`);
      await t.say("What Bob already wrote stays in the delivered round");
      await t.signInAs(OWNER);
      await t.open(`/i/${delivered.issueId}`);
      await t.see("Something Bob said.");
    } },

  F4: { title: "Delete a loop", area: AREA,
    seed: async (t) => {
      const loop = await seedLoop();
      await seedDeliveredIssue(loop, {
        deliveredAt: new Date("2026-01-01T06:00:00Z"),
        answers: [{ email: "alice@friendloop.test", body: "Soon to be gone." }],
      });
      await t.sweep(AFTER_FIRST_SLOT, { show: false });
      return { loop };
    },
    run: async (t, { loop }) => {
      const tally = async () => {
        const out = [];
        for (const table of ["groups", "memberships", "issues", "replies", "outbox"]) out.push(`${table.padEnd(12)}${await count(t, table)}`);
        return out.join("\n");
      };
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/settings`);
      await t.panel("rows before", await tally());
      await t.say("The delete button waits for the loop's exact name");
      await t.fill('input[name="confirm"]', "Friday");
      await t.button("Delete forever");
      await t.expectUrl(/\/settings/);
      const blocked = await t.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Delete forever")).getAttribute("aria-disabled")`);
      t.check_(blocked === "true", "Delete should stay blocked on a partial name");
      await t.say("With the full name typed, it goes through");
      await t.fill('input[name="confirm"]', " Loop");
      await t.button("Delete forever");
      await t.expectUrl(/\/you(\?.*)?$/);
      await t.dontSee("Friday Loop");
      await t.say("The loop and everything in it is gone");
      const after = await tally();
      t.check_(/groups\s+0/.test(after) && /memberships\s+0/.test(after) && /issues\s+0/.test(after) && /replies\s+0/.test(after) && /outbox\s+0/.test(after), `Rows survived:\n${after}`);
      await t.panel("rows after", after);
      await t.say("Its address now answers with a 404");
      await t.open(`/g/${loop.groupId}`);
      await t.see("This page isn't here");
    } },

  F5: { title: "Non-owner is refused", area: AREA,
    staged: "The forged POST is sent from the page with the member's own cookies, using the delete action's real id. The same POST from the owner, with a wrong name, is the control that shows it reaches the action.",
    seed: async () => {
      const loop = await seedLoop();
      await addMember(loop, { email: "member@friendloop.test", access: "member" });
      return { loop };
    },
    run: async (t, { loop }) => {
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/settings`);
      const deleteId = await serverActionId(t, "deleteAction");
      const settings = `/g/${loop.groupId}/settings`;
      // Control: the same POST from the owner reaches the action, stopped only by the wrong confirmation.
      const control = await postServerAction(t, settings, deleteId, { groupId: loop.groupId, name: "Friday Loop", confirm: "wrong" });
      t.check_(control.landed.includes("error=confirm"), `The control POST did not reach the action: ${JSON.stringify(control)}`);
      await t.signInAs("member@friendloop.test");
      await t.say("A plain member tries the settings address");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.say("They are sent back to the dashboard");
      await t.expectUrl(new RegExp(`/g/${loop.groupId}$`));
      await t.dontSee("Delete forever");
      await t.dontSee("Send now");
      await t.say("On the people page: no invite form, no remove buttons");
      await t.open(`/g/${loop.groupId}/members`);
      await t.see("alice@friendloop.test");
      await t.dontSee("Email addresses");
      const removes = await t.eval(`[...document.querySelectorAll("button")].filter((b) => b.textContent.includes("Remove")).length`);
      t.check_(removes === 0, "A member should have no Remove buttons");
      await t.say("The same request as a POST: the member forges the delete form");
      const response = await postServerAction(t, settings, deleteId, { groupId: loop.groupId, name: "Friday Loop", confirm: "Friday Loop" });
      t.check_(response.landed === `/g/${loop.groupId}`, `A member's POST landed on ${response.landed}`);
      const [{ n }] = await t.sql("select count(*)::int as n from groups where id = $1", [loop.groupId]);
      t.check_(n === 1, "A member's POST deleted the loop");
      await t.panel("POST deleteAction", `as the owner, wrong name: sent to ${control.landed.replace(loop.groupId, "<id>")}\nas a member, right name:  sent to ${response.landed.replace(loop.groupId, "<id>")}\nloop rows afterwards: ${n}`, { hold: 4500 });
      await t.say("The loop is untouched");
      await t.open(`/g/${loop.groupId}`);
      await t.see("Friday Loop");
    } },

  F6: { title: "Reset share links", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
      const issue = await seedDeliveredIssue(loop, {
        deliveredAt: new Date("2026-01-01T06:00:00Z"),
        answers: [{ email: "alice@friendloop.test", body: "Still here after the reset." }],
        shareToken: "old-share-token",
      });
      return { loop, issue };
    },
    run: async (t, { loop, issue }) => {
      await t.say("A share link handed out earlier opens for anyone");
      await t.open("/s/old-share-token");
      await t.see("Still here after the reset.");
      await t.say("The owner resets share links in settings");
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/settings`);
      await t.button("Reset share links");
      await t.say("Resetting asks first");
      await t.button("Yes, reset share links");
      await t.see("New share links. Old ones no longer work.");
      await t.say("The old link now answers with a 404");
      await t.open("/s/old-share-token");
      await t.see("This page isn't here");
      const [{ share_token: token }] = await t.sql("select share_token from issues where id = $1", [issue.issueId]);
      t.check_(token !== "old-share-token", "The share token did not change");
      await t.say("The round has a new link that works");
      await t.open(`/s/${token}`);
      await t.see("Still here after the reset.");
      await t.say("Now the owner turns sharing off");
      await t.open(`/g/${loop.groupId}/settings`);
      await t.clickRole("checkbox", "share link");
      await t.button("Save changes");
      await t.see("Saved.");
      await t.say("Every existing link stops working");
      await t.open(`/s/${token}`);
      await t.see("This page isn't here");
      await t.dontSee("Still here after the reset.");
    } },
};
