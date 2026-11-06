import { seedLoop } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { hashToken } from "../../src/lib/tokens.ts";
import { AFTER_FIRST_SLOT, DAY } from "../../e2e/support/clock.ts";
import { seedConversation } from "../../e2e/support/comments.ts";
import { LIMITS } from "../../src/lib/rate-limit-policy.ts";

const AREA = "A · Auth";
const SAM = "sam@friendloop.test";

/** Every request from the tab now comes from this network, at the pinned time. */
const fromNetwork = (t, ip) => t.page("Network.setExtraHTTPHeaders", { headers: { "x-e2e-now": t.now.toISOString(), "x-forwarded-for": ip } });
const signInMail = async (t, to) => (await t.sql(`select count(*)::int as n from outbox where kind = 'signin' and "to" = $1`, [to]))[0].n;
const askForLink = async (t, email) => {
  await t.open("/signin");
  await t.fillLabel("Your email", email);
  await t.button("Email me a link");
};

export const flows = {
  A1: { title: "Request a magic link", area: AREA, run: async (t) => {
    await t.open("/signin");
    await t.say("Someone asks for a sign-in link");
    await t.fillLabel("Your email", SAM);
    await t.button("Email me a link");
    await t.expectUrl(/\/signin\/check-email$/);
    await t.say("The app says to check the inbox");
    await t.see("Check your inbox");
    await t.say("The email arrives in Mailpit");
    await t.openMail({ to: SAM });
    t.mailLink("/signin/confirm");
    await t.tour();
  } },

  A2: { title: "Sign in with a valid link", area: AREA, run: async (t) => {
    await t.say("Request a link");
    await t.open("/signin");
    await t.fillLabel("Your email", SAM);
    await t.button("Email me a link");
    await t.expectUrl(/\/signin\/check-email$/);
    await t.say("Open the email in Mailpit");
    await t.openMail({ to: SAM });
    await t.say("Follow the link it carries");
    await t.followMailLink("/signin/confirm");
    await t.see(SAM);
    await t.say("Confirm, and land on your own page");
    await t.button("Sign in");
    await t.expectUrl(/\/you$/);
    await t.see("Your loops");
    await t.see(`Signed in as ${SAM}`);
  } },

  A3: { title: "Expired or reused link", area: AREA, run: async (t) => {
    await t.open("/signin");
    await t.say("Use a link once");
    await t.fillLabel("Your email", SAM);
    await t.button("Email me a link");
    await t.expectUrl(/\/signin\/check-email$/);
    await t.openMail({ to: SAM }, { inbox: false });
    const link = await t.followMailLink("/signin/confirm");
    await t.button("Sign in");
    await t.expectUrl(/\/you$/);
    await t.say("Open the very same link a second time");
    await t.open(link);
    await t.see("already used");
    await t.say("A recoverable screen, with a way to get a new link");
    await t.see("Send me a new link");
    await t.pause(1000);
    await t.say("A link past its 15 minutes says it expired");
    await rows("insert into magic_links (email, token_hash, expires_at) values ($1, $2, now() - interval '1 minute')", [SAM, hashToken("expired-link-token")]);
    await t.signInAs(null);
    await t.open("/signin/confirm?token=expired-link-token");
    await t.see("expired");
    await t.say("Asking for a new link goes back to sign-in");
    await t.link("Send me a new link");
    await t.expectUrl(/\/signin$/);
    await t.see("Sign in");
  } },

  A4: { title: "Unknown email", area: AREA, run: async (t) => {
    const stranger = "nobody-yet@friendloop.test";
    await t.open("/signin");
    await t.say("An address with no account");
    await t.fillLabel("Your email", stranger);
    await t.button("Email me a link");
    await t.expectUrl(/\/signin\/check-email$/);
    await t.say("The same screen as a known address");
    await t.see("Check your inbox");
    const before = await rows("select id from users where email = $1", [stranger]);
    t.check_(before.length === 0, "Account should not exist until the link is used");
    await t.panel("users table", `rows for ${stranger}: 0`);
    await t.say("The same email too");
    await t.openMail({ to: stranger });
    await t.followMailLink("/signin/confirm");
    await t.button("Sign in");
    await t.expectUrl(/\/you$/);
    const after = await rows("select id from users where email = $1", [stranger]);
    t.check_(after.length === 1, "Account should exist once the link is used");
    await t.panel("users table", `rows for ${stranger}: 1 (created by using the link)`);
  } },

  A5: { title: "Sign out", area: AREA, run: async (t) => {
    await t.signInAs(SAM);
    await t.open("/you");
    await t.see("Your loops");
    await t.say("Sign out");
    await t.button("Sign out");
    await t.expectUrl(/\/signin$/);
    await t.say("Going back to /you returns to sign-in");
    await t.open("/you");
    await t.expectUrl(/\/signin$/);
    await t.see("Sign in");
  } },

  A6: { title: "Revoked reply token", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      const alice = loop.members.find((member) => member.email.startsWith("alice"));
      await rows("update memberships set reply_token = 'rotated-token-value' where id = $1", [alice.id]);
      return { old: alice.token };
    },
    run: async (t, { old }) => {
      await t.say("Alice opens an old reply link that has since been rotated");
      await t.open(`/r/${old}`);
      await t.see("replaced");
      await t.say("No form and no loop data, only an explanation");
      await t.dontSee("Friday Loop");
      await t.dontSee("What made you laugh");
      await t.pause(1500);
    } },

  A7: { title: "Expired session", area: AREA, staged: "The clock is pinned to Jan 2026 and the session rows are seeded, so the 30-day expiry can be shown without waiting.",
    run: async (t) => {
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.say("A session still inside its 30 days is accepted");
      await t.signInAs(SAM, { expiresIn: 5 * DAY });
      await t.open("/you");
      await t.see(`Signed in as ${SAM}`);
      await t.say("A session past its 30 days: the cookie is there, the server refuses it");
      await t.signInAs(SAM, { expiresIn: -1 * DAY });
      await t.open("/you");
      await t.expectUrl(/\/signin$/);
      await t.see("Sign in");
      await t.pause(1200);
    } },

  A8: { title: "Abuse limits", area: AREA,
    staged: "The clock is pinned and each person's network address is set with a request header. The network's spent hour is seeded as a counter; the feedback and comment floods are real requests made off camera, then the next one is made in the real UI.",
    seed: async () => {
      const { issue, alice } = await seedConversation();
      return { issueId: issue.issueId, alice };
    },
    run: async (t, { issueId, alice }) => {
      const NOW = new Date("2026-11-02T10:00:00Z");
      await t.clock(NOW);

      // One address, flooded through the real form.
      const target = "target@friendloop.test";
      await fromNetwork(t, "198.51.100.10");
      await t.open("/signin");
      const asks = LIMITS.signInEmail.max + 2;
      await t.say(`One address asks for a sign-in link ${asks} times in a row. The limit is ${LIMITS.signInEmail.max}.`);
      for (let i = 1; i <= asks; i++) {
        await askForLink(t, target);
        await t.expectUrl(/\/signin\/check-email$/);
        await t.see("Check your inbox", { hold: 200 });
      }
      await t.say(`The ${asks}th ask looks the same as the first, so nothing is given away`);
      await t.see("Check your inbox");
      await t.say(`But Mailpit only received ${LIMITS.signInEmail.max} emails`);
      await t.waitForMail({ to: target }, { count: LIMITS.signInEmail.max });
      await t.open(`${t.stack.mailpit}/`);
      await t.pause(1500);
      t.check_(await t.mailCount({ to: target }) === LIMITS.signInEmail.max, "A flooded address should get exactly the capped mail");
      await t.panel("outbox, kind = signin", `rows for ${target}: ${await signInMail(t, target)} (asked ${asks} times)`);

      // A whole network, past its hour.
      const blocked = "blocked@friendloop.test";
      const ip = "203.0.113.50";
      const windowStart = Math.floor(NOW.getTime() / LIMITS.signInIp.windowMs) * LIMITS.signInIp.windowMs;
      await rows("insert into rate_limits (key, window_start, count, expires_at) values ($1, $2, $3, $4)",
        [`signin:ip:${ip}`, new Date(windowStart).toISOString(), LIMITS.signInIp.max, new Date(windowStart + LIMITS.signInIp.windowMs).toISOString()]);
      await fromNetwork(t, ip);
      await t.open("/signin");
      await t.say(`A network that already spent its ${LIMITS.signInIp.max} requests this hour is told plainly to wait`);
      await askForLink(t, blocked);
      await t.see("Lots of sign-in requests are coming from your network");
      await t.expectUrl(/\/signin$/);
      const refused = await signInMail(t, blocked);
      t.check_(refused === 0, "A flooded network should queue no mail");
      await t.panel("outbox, kind = signin", `rows for ${blocked}: ${refused}`, { hold: 2500 });

      await fromNetwork(t, "198.51.100.11");
      await t.say("The same address from another network is unaffected");
      await askForLink(t, blocked);
      await t.expectUrl(/\/signin\/check-email$/);
      await t.see("Check your inbox");

      // A stranger's notes, per network.
      const notesFrom = "203.0.113.60";
      const headers = { "x-e2e-now": NOW.toISOString(), "x-forwarded-for": notesFrom };
      for (let i = 0; i < LIMITS.feedbackAnonymous.max; i++) {
        const sent = await t.request("POST", "/api/feedback", { headers, body: { message: "Broken!", path: "/", viewport: "1x1" }, show: false });
        t.check_(sent.status === 200, `Note ${i + 1} should be accepted, got ${sent.status}`);
      }
      await fromNetwork(t, notesFrom);
      await t.open("/signin");
      await t.say(`A stranger has already sent ${LIMITS.feedbackAnonymous.max} notes this hour. One more is refused kindly.`);
      await t.button("Send feedback");
      await t.fillLabel("Your message", "Broken again!");
      await t.button("Send", { exact: true });
      await t.see("a lot of notes for one hour");
      const note = await t.request("POST", "/api/feedback", { headers, body: { message: "Broken!", path: "/", viewport: "1x1" }, title: "The same request, its real response" });
      t.check_(note.status === 429, `Feedback flood should get 429, got ${note.status}`);
      await t.press("Escape");

      // A member's comments, per member.
      const comment = () => {
        const form = new FormData();
        form.set("body", "Ha!");
        form.set("viewerToken", alice.token);
        return form;
      };
      for (let i = 0; i < LIMITS.comment.max; i++) {
        const response = await fetch(t.url(`/api/issue/${issueId}/comments`), { method: "POST", headers: { "x-e2e-now": NOW.toISOString() }, body: comment() });
        t.check_(response.ok, `Comment ${i + 1} should be accepted, got ${response.status}`);
      }
      await t.clock(NOW);
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.say(`Alice has posted ${LIMITS.comment.max} comments in ten minutes. The next one is refused kindly.`);
      await t.fill('textarea[placeholder="Say something nice."]', "One more thing!");
      await t.button("Post", { exact: true });
      await t.see("commenting faster than we can keep up");
      const flood = await fetch(t.url(`/api/issue/${issueId}/comments`), { method: "POST", headers: { "x-e2e-now": NOW.toISOString() }, body: comment() });
      t.check_(flood.status === 429, `Comment flood should get 429, got ${flood.status}`);
      await t.panel(`POST /api/issue/…/comments`, `HTTP ${flood.status}\n${await flood.text()}`);
    } },
};
