import type { Ctx, Interaction } from "../lib/types";
import { live, open, stash } from "./helpers";

const unsubscribe = stash<string>();

async function tokenOf(c: Ctx, membershipId: string): Promise<string> {
  const [row] = await c.world.query<{ unsubscribe_token: string }>(`select unsubscribe_token from memberships where id = '${membershipId}'`);
  return row.unsubscribe_token;
}

async function openFeedback(c: Ctx) {
  await open(c, "/", ".feedback-button");
  await c.page.locator(".feedback-button").click();
  await c.page.locator("#feedback-message").waitFor();
}

export const siteInteractions: Interaction[] = [
  {
    id: "site.theme.toggle",
    label: "Switch between light and dark",
    surface: "site-wide", kind: "instant", viewer: "anon",
    flows: [], routes: ["/"],
    prepare: async (c) => {
      // Starts dark and ends light, so the shared browser profile stays as later samples expect.
      await c.page.goto("/");
      await c.page.evaluate(() => localStorage.setItem("friendloop-theme", "dark"));
      await open(c, "/", ".theme-switch");
      await c.page.locator(`html[data-theme="dark"]`).waitFor({ state: "attached" });
    },
    act: (c) => c.page.locator(".theme-switch").click(),
    done: () => ({ selector: `html[data-theme="light"]` }),
  },
  {
    id: "site.feedback.open",
    label: "Open the feedback sheet",
    surface: "site-wide", kind: "instant", viewer: "anon",
    flows: ["S1"], routes: ["/"],
    prepare: (c) => open(c, "/", ".feedback-button"),
    act: (c) => c.page.locator(".feedback-button").click(),
    done: () => ({ selector: "dialog.feedback-dialog textarea" }),
  },
  {
    id: "site.feedback.send",
    label: "Send feedback and see the thank-you",
    surface: "site-wide", kind: "write", viewer: "anon",
    flows: ["S1"], routes: ["/", "/api/feedback"],
    prepare: async (c) => {
      await openFeedback(c);
      await c.page.locator("#feedback-message").fill(`A note from the lab, ${c.unique}.`);
    },
    act: (c) => c.page.locator("dialog.feedback-dialog").getByRole("button", { name: "Send", exact: true }).click(),
    done: () => ({ selector: "#feedback-title", text: "Thanks, we got it." }),
  },
  {
    id: "site.unsubscribe.load",
    label: "Open the stop-emails link from an email",
    surface: "site-wide", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["U1"], routes: ["/u/[token]"],
    prepare: async (c) => { unsubscribe.put(c, await tokenOf(c, c.world.people[6].membershipId)); },
    act: (c) => c.visit(`/u/${unsubscribe.take(c)}`),
    done: () => ({ selector: "h1", text: "Stop emails from" }),
  },
  {
    id: "site.unsubscribe.confirm",
    label: "Confirm you want the emails to stop",
    surface: "site-wide", kind: "write", viewer: "anon",
    flows: ["U1"], routes: ["/u/[token]", "/api/unsubscribe/[token]"],
    prepare: async (c) => {
      const loop = await c.world.throwawayLoop();
      await c.page.goto(`/u/${await tokenOf(c, loop.members[0].id)}`);
      await live(c.page.getByRole("button", { name: "Stop emails" }));
    },
    act: (c) => c.page.getByRole("button", { name: "Stop emails" }).click(),
    done: () => ({ selector: "h1", text: "are off" }),
  },
];
