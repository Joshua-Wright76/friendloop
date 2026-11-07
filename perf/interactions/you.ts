import type { Interaction } from "../lib/types";
import { catchDownload, DOWNLOADED, live, open, signInAs } from "./helpers";

const FIRST_LOOP = "The Friday Loop";

export const youInteractions: Interaction[] = [
  {
    id: "you.page.load",
    label: "Open your loops for the first time on this device",
    surface: "your loops", kind: "page-load", viewer: "owner", cache: "empty",
    flows: ["A2"], routes: ["/you"],
    prepare: (c) => c.world.dropThrowaways(),
    act: (c) => c.visit("/you"),
    done: () => ({ selector: "a.loop-card", text: FIRST_LOOP }),
  },
  {
    id: "you.page.warm",
    label: "Come back to your loops",
    surface: "your loops", kind: "page-load", viewer: "owner", cache: "warm",
    flows: ["A2"], routes: ["/you"],
    prepare: (c) => c.world.dropThrowaways(),
    act: (c) => c.visit("/you"),
    done: () => ({ selector: "a.loop-card", text: FIRST_LOOP }),
  },
  {
    id: "you.card.open",
    label: "Tap a loop and see its overview",
    surface: "your loops", kind: "navigation", viewer: "owner",
    flows: [], routes: ["/you", "/g/[id]"],
    prepare: async (c) => {
      await c.world.dropThrowaways();
      await open(c, "/you", "a.loop-card");
    },
    act: (c) => c.page.locator("a.loop-card", { hasText: FIRST_LOOP }).click(),
    done: (c) => ({ selector: "#this-round", path: `^/g/${c.world.loopId}$` }),
  },
  {
    id: "you.newloop.open",
    label: "Tap New loop and see the first step",
    surface: "your loops", kind: "navigation", viewer: "owner",
    flows: ["B1"], routes: ["/you", "/g/new"],
    prepare: async (c) => {
      await c.world.dropThrowaways();
      await open(c, "/you", "a.loop-card");
    },
    act: (c) => c.page.getByRole("link", { name: "New loop" }).click(),
    done: () => ({ selector: "#wizard-step-heading", path: "^/g/new$" }),
  },
  {
    id: "you.email.confirm.load",
    label: "Open an email-change link that no longer works",
    surface: "your loops", kind: "page-load", viewer: "owner", cache: "empty",
    flows: [], routes: ["/you/email/confirm"],
    // An unknown token: the page and its lookup run, and nobody's address changes.
    act: (c) => c.visit(`/you/email/confirm?token=perf-${c.unique}`),
    done: () => ({ selector: "h1", text: "This link doesn't work" }),
  },
  {
    id: "you.delete.load",
    label: "Open the delete-account page",
    surface: "your loops", kind: "page-load", viewer: "owner", cache: "empty",
    flows: ["V2"], routes: ["/you/delete"],
    prepare: (c) => c.world.dropThrowaways(),
    act: (c) => c.visit("/you/delete"),
    done: () => ({ selector: "h1", text: "Delete your account" }),
  },
  {
    id: "you.delete.submit",
    label: "Delete your account and land on goodbye",
    surface: "your loops", kind: "write", viewer: "anon",
    flows: ["V2"], routes: ["/you/delete", "/goodbye"],
    prepare: async (c) => {
      const person = await c.world.throwawayUser();
      await signInAs(c, person.sessionToken);
      await c.page.goto("/you/delete");
      const field = c.page.locator("#confirm");
      await live(field);
      await field.fill(person.email);
    },
    act: (c) => c.page.getByRole("button", { name: "Delete my account forever" }).click(),
    done: () => ({ selector: "h1", text: "It's all gone.", path: "^/goodbye" }),
  },
  {
    id: "you.export.download",
    label: "Download everything you wrote",
    surface: "your loops", kind: "navigation", viewer: "owner",
    flows: ["V4"], routes: ["/you", "/you/export"],
    prepare: async (c) => {
      await c.world.dropThrowaways();
      await open(c, "/you", "a.loop-card");
      await catchDownload(c, "/you/export");
    },
    act: (c) => c.page.getByRole("link", { name: "Download my data" }).click(),
    done: () => DOWNLOADED,
  },
];
