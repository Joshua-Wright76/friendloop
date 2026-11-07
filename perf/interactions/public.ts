import type { Interaction } from "../lib/types";
import { live, open, signInAs, stash } from "./helpers";

const confirmLink = stash<string>();
const addressFor = (unique: string) => `perf-${unique}@friendloop.test`;

export const publicInteractions: Interaction[] = [
  {
    id: "public.landing.load",
    label: "Open the landing page for the first time",
    surface: "public", kind: "page-load", viewer: "anon", cache: "empty",
    flows: [], routes: ["/"],
    act: (c) => c.visit("/"),
    done: () => ({ selector: "h1" }),
  },
  {
    id: "public.landing.warm",
    label: "Come back to the landing page",
    surface: "public", kind: "page-load", viewer: "anon", cache: "warm",
    flows: [], routes: ["/"],
    act: (c) => c.visit("/"),
    done: () => ({ selector: "h1" }),
  },
  {
    id: "public.terms.load",
    label: "Read the terms",
    surface: "public", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["V1"], routes: ["/terms"],
    act: (c) => c.visit("/terms"),
    done: () => ({ selector: "h1", text: "The ground rules" }),
  },
  {
    id: "public.privacy.load",
    label: "Read the privacy page",
    surface: "public", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["V1"], routes: ["/privacy"],
    act: (c) => c.visit("/privacy"),
    done: () => ({ selector: "h1", text: "What we keep, and why" }),
  },
  {
    id: "public.goodbye.load",
    label: "Land on the goodbye page",
    surface: "public", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["V2"], routes: ["/goodbye"],
    act: (c) => c.visit("/goodbye"),
    done: () => ({ selector: "h1", text: "It's all gone." }),
  },
  {
    id: "public.notfound.load",
    label: "Follow a link to a page that isn't there",
    surface: "public", kind: "page-load", viewer: "anon", cache: "empty",
    flows: [], routes: ["/not-found"],
    act: (c) => c.visit("/no-such-page-here"),
    done: () => ({ selector: "h1", text: "This page isn't here" }),
  },
  {
    id: "signin.page.load",
    label: "Open the sign-in page",
    surface: "sign-in", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["A1"], routes: ["/signin"],
    act: (c) => c.visit("/signin"),
    done: () => ({ selector: `input[type="email"]` }),
  },
  {
    id: "signin.email.submit",
    label: "Ask for a sign-in link",
    surface: "sign-in", kind: "write", viewer: "anon",
    flows: ["A1", "A4"], routes: ["/signin", "/signin/check-email"],
    prepare: async (c) => {
      await open(c, "/signin", `input[type="email"]`);
      await c.page.getByLabel("Your email").fill(addressFor(c.unique));
    },
    act: (c) => c.page.getByRole("button", { name: "Email me a link" }).click(),
    done: () => ({ selector: "h1", text: "Check your inbox", path: "^/signin/check-email" }),
  },
  {
    id: "signin.confirm.load",
    label: "Open the sign-in link from the email",
    surface: "sign-in", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["A2"], routes: ["/signin/confirm"],
    prepare: async (c) => { confirmLink.put(c, await c.world.magicLink(addressFor(c.unique))); },
    act: (c) => c.visit(confirmLink.take(c)),
    done: (c) => ({ selector: "strong", text: addressFor(c.unique) }),
  },
  {
    id: "signin.confirm.submit",
    label: "Press Sign in and land on your loops",
    surface: "sign-in", kind: "write", viewer: "anon",
    flows: ["A2"], routes: ["/signin/confirm", "/you"],
    prepare: async (c) => {
      await open(c, await c.world.magicLink(addressFor(c.unique)), "form button");
    },
    act: (c) => c.page.getByRole("button", { name: "Sign in" }).click(),
    done: (c) => ({ selector: "h1 + p", text: `Signed in as ${addressFor(c.unique)}`, path: "^/you$" }),
  },
  {
    id: "signin.confirm.expired",
    label: "Open a sign-in link that no longer works",
    surface: "sign-in", kind: "page-load", viewer: "anon", cache: "empty",
    flows: ["A3"], routes: ["/signin/confirm"],
    act: (c) => c.visit("/signin/confirm?token=not-a-token-we-ever-sent"),
    done: () => ({ selector: `a.btn[href="/signin"]` }),
  },
  {
    id: "signin.signout.submit",
    label: "Sign out from your loops",
    surface: "sign-in", kind: "write", viewer: "anon",
    flows: ["A5"], routes: ["/you", "/signin"],
    prepare: async (c) => {
      const person = await c.world.throwawayUser();
      await signInAs(c, person.sessionToken);
      await c.page.goto("/you");
      await live(c.page.getByRole("button", { name: "Sign out" }));
    },
    act: (c) => c.page.getByRole("button", { name: "Sign out" }).click(),
    done: () => ({ selector: `input[type="email"]`, path: "^/signin$" }),
  },
];
