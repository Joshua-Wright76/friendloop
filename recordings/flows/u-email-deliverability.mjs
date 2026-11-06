import { createHmac } from "node:crypto";
import { seedLoop } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, HOUR } from "../../e2e/support/clock.ts";

const AREA = "U · Email deliverability";
const REMINDER_DAY = new Date(DELIVERY_DAY.getTime() - 24 * HOUR);
const ALICE = "alice@friendloop.test";
const BOB = "bob@friendloop.test";
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? "whsec_ZTJlLXJlc2VuZC13ZWJob29rLXNlY3JldA==";

/** Sign a body the way Svix does for Resend. */
function signed(body, { id, at = new Date(), secret = WEBHOOK_SECRET }) {
  const timestamp = String(Math.floor(at.getTime() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "content-type": "application/json", "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` };
}
async function postEvent(t, event, options, title) {
  const body = JSON.stringify(event);
  return t.request("POST", "/api/webhooks/resend", { body, headers: signed(body, options), title });
}

export const flows = {
  U1: { title: "Stop emails from a loop", area: AREA,
    staged: "The sweep runs with a pinned clock. The local mail shim drops custom headers, so the List-Unsubscribe headers are read from the outbox row the app sent.",
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      const alice = loop.members.find((member) => member.email === ALICE);
      const bob = loop.members.find((member) => member.email === BOB);
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.open("/");
      await t.say("The round opens and prompts go out");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.say("Every loop email has a stop link in its footer");
      await t.openMail({ to: ALICE });
      t.check_(t.lastMail.HTML.includes("Stop emails from this loop"), "The HTML should carry the stop link");
      await t.pause(600);
      t.check_((t.lastMail.Text ?? "").includes("Stop emails from this loop:"), "The plain text should carry the stop link too");
      const [row] = await rows(`select headers from outbox where kind = 'prompt' and "to" = $1`, [ALICE]);
      await t.panel("outbox.headers for this email", JSON.stringify(row.headers, null, 1).replaceAll(t.stack.app, ""));
      t.check_(row.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "Prompt should carry one-click headers");

      await t.say("Opening the link only asks");
      await t.followMailLink("/u/");
      await t.see("Stop emails from Friday Loop?");
      const unmuted = await rows("select muted_at from memberships where id = $1", [alice.id]);
      t.check_(unmuted[0].muted_at === null, "Opening the link must not mute");
      await t.say("Confirming mutes");
      await t.button("Stop emails");
      await t.see("Emails from Friday Loop are off");

      await t.say("Bob's mail client uses the one-click POST: no confirmation");
      const [{ unsubscribe_token: bobToken }] = await rows("select unsubscribe_token from memberships where id = $1", [bob.id]);
      const click = await t.request("POST", `/api/unsubscribe/${bobToken}`, {
        title: "POST /api/unsubscribe/<bob's token>", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      t.check_(click.status === 200, `One-click should be 2xx, got ${click.status}`);
      const asGet = await t.request("GET", `/api/unsubscribe/${bobToken}`, { title: "GET of the same URL: a redirect to the page that asks" });
      t.check_(asGet.status === 303, `GET should redirect, got ${asGet.status}`);

      await t.say("Alice is still in the loop. Her link works and offers the way back");
      await t.open(`/r/${alice.token}`);
      await t.see("You've turned off emails from this loop.");
      await t.see("What made you laugh this week?");

      await t.say("The reminder is recorded for her, but never sent");
      await t.sweep(REMINDER_DAY, { show: false });
      const held = await rows(`select "to", status, suppressed_reason from outbox where kind = 'reminder' order by "to"`);
      await t.panel("reminders in the outbox", held.map((m) => `${m.to}: ${m.status} (${m.suppressed_reason ?? "-"})`).join("\n"));
      t.check_(held.some((m) => m.to === ALICE && m.status === "suppressed" && m.suppressed_reason === "muted"), "Alice's reminder should be suppressed");
      const sent = await t.mailCount({ to: ALICE, subject: "reminder" });
      t.check_(sent === 0, "No reminder should reach Mailpit for Alice");

      await t.say("The owner sees it on the people tab");
      await t.signInAs("owner@friendloop.test");
      await t.open(`/g/${loop.groupId}/members`);
      await t.see("Emails off");
      await t.signInAs(null);

      await t.say("Alice turns emails back on from the reply page");
      await t.open(`/r/${alice.token}`);
      await t.button("Turn emails back on");
      await t.pause(800);
      await t.dontSee("You've turned off emails from this loop.");
      const [after] = await rows("select muted_at from memberships where id = $1", [alice.id]);
      t.check_(after.muted_at === null, "She should be unmuted");

      await t.say("The next email reaches her again");
      const before = await t.mailCount({ to: ALICE });
      await t.signInAs("owner@friendloop.test");
      await t.open(`/g/${loop.groupId}`);
      await t.button("Send a nudge");
      await t.see("nudge");
      await t.waitForMail({ to: ALICE }, { count: before + 1 });
      await t.signInAs(null);
      await t.openMail({ to: ALICE });
    } },

  U2: { title: "Bouncing addresses", area: AREA,
    staged: "Webhooks are signed here the way Resend's Svix signs them and posted to the real endpoint. The recording stack's app is started with the webhook secret the e2e suite uses.",
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.open("/");
      await t.say("Prompts go out through the provider path");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.openMail({ to: BOB });
      const [{ provider_id: emailId }] = await rows(`select provider_id from outbox where kind = 'prompt' and "to" = $1`, [BOB]);
      const event = { type: "email.delivered", data: { email_id: emailId, to: [BOB] } };

      await t.say("A forged signature gets 401");
      const forged = await postEvent(t, event, { id: "msg_forged", secret: "whsec_bm90IHRoZSBzZWNyZXQ=" }, "POST webhook, wrong secret");
      t.check_(forged.status === 401, `Forged should be 401, got ${forged.status}`);
      await t.say("A correct signature from an hour ago gets 401");
      const old = await postEvent(t, event, { id: "msg_old", at: new Date(Date.now() - HOUR) }, "POST webhook, signed an hour ago");
      t.check_(old.status === 401, `Replay should be 401, got ${old.status}`);
      const none = await rows("select id from email_events");
      await t.panel("email_events", `rows: ${none.length}`, { hold: 1800 });
      t.check_(none.length === 0, "Refused events must record nothing");

      await t.say("A good one is recorded once, however often it's redelivered");
      const good = await postEvent(t, event, { id: "msg_good" }, "POST webhook, signed");
      t.check_(good.status === 200, `Good webhook should be 200, got ${good.status}`);
      const again = await postEvent(t, event, { id: "msg_good" }, "POST webhook, the same delivery again");
      t.check_(again.text.includes('"duplicate":true'), "Redelivery should be a duplicate");
      const one = await rows("select type, outbox_id from email_events");
      await t.panel("email_events", `rows: ${one.length}\ntype: ${one[0].type}\nlinked to outbox row: ${one[0].outbox_id ? "yes" : "no"}`);
      t.check_(one.length === 1 && one[0].outbox_id, "One event, linked to its outbox row");

      await t.say("Then Bob's address hard-bounces");
      const bounced = await postEvent(t, { type: "email.bounced", data: { email_id: emailId, to: [BOB], bounce: { type: "Permanent" } } }, { id: "msg_bounce" }, "POST webhook, email.bounced");
      t.check_(bounced.status === 200, `Bounce should be 200, got ${bounced.status}`);
      const suppressed = await rows("select email, reason from email_suppressions");
      await t.panel("email_suppressions", suppressed.map((s) => `${s.email}: ${s.reason}`).join("\n"));
      t.check_(suppressed[0]?.reason === "bounce", "Bob should be suppressed");

      await t.say("The next loop email to him is recorded, not sent");
      await t.sweep(REMINDER_DAY, { show: false });
      const [reminder] = await rows(`select status, suppressed_reason from outbox where kind = 'reminder' and "to" = $1`, [BOB]);
      await t.panel("Bob's reminder in the outbox", `${reminder.status} (${reminder.suppressed_reason})`);
      t.check_(reminder.status === "suppressed" && reminder.suppressed_reason === "bounce", "Bob's reminder should be suppressed");

      await t.say("The owner sees Bouncing, and how to fix it");
      await t.signInAs("owner@friendloop.test");
      await t.open(`/g/${loop.groupId}/members`);
      await t.see("Bouncing");
      await t.see("Remove them and invite the right address");

      await t.say("A sign-in link still goes to him");
      await t.signInAs(null);
      await t.clock(null);
      await t.open("/signin");
      await t.fillLabel("Your email", BOB);
      await t.button("Email me a link");
      await t.expectUrl(/\/signin\/check-email$/);
      await t.openMail({ to: BOB, subject: "sign" });
      t.mailLink("/signin/confirm");
    } },
};
