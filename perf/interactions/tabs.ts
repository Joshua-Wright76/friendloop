import type { Ctx, Interaction } from "../lib/types";
import type { DoneSpec } from "../lib/probe";
import { open } from "./helpers";

type Tab = {
  key: string;
  noun: string;
  nav: string;
  suffix: string;
  route: string;
  flows: string[];
  surface: Interaction["surface"];
  /** The tab's own content, never its header or skeleton: both come from the layout. */
  content: (c: Ctx) => DoneSpec;
};

const TABS: Record<string, Tab> = {
  overview: {
    key: "overview", noun: "the overview", nav: "Overview", suffix: "", route: "/g/[id]", flows: ["B1"], surface: "overview",
    content: () => ({ selector: "#this-round" }),
  },
  people: {
    key: "people", noun: "People", nav: "People", suffix: "/members", route: "/g/[id]/members", flows: ["B3"], surface: "people",
    content: (c) => ({ selector: "li.card .member-row", text: c.world.member.email }),
  },
  questions: {
    key: "questions", noun: "Questions", nav: "Questions", suffix: "/questions", route: "/g/[id]/questions", flows: ["C1"], surface: "questions",
    content: () => ({ selector: ".question-order-item", text: "What made you laugh this week?" }),
  },
  rounds: {
    key: "rounds", noun: "Rounds", nav: "Rounds", suffix: "/issues", route: "/g/[id]/issues", flows: ["E5"], surface: "rounds",
    content: (c) => ({ selector: "main li.card h2", text: `Round ${c.world.latestIssueNumber}` }),
  },
  album: {
    key: "album", noun: "the Album", nav: "Album", suffix: "/album", route: "/g/[id]/album", flows: ["P1"], surface: "album",
    content: () => ({ selector: ".album-grid .album-tile" }),
  },
  settings: {
    key: "settings", noun: "Settings", nav: "Settings", suffix: "/settings", route: "/g/[id]/settings", flows: ["F1"], surface: "settings",
    content: () => ({ selector: `#settings-details input[name="name"]` }),
  },
};

const at = (c: Ctx, tab: Tab) => `/g/${c.world.loopId}${tab.suffix}`;

const loads: Interaction[] = Object.values(TABS).flatMap((tab) => (["empty", "warm"] as const).map((cache): Interaction => ({
  id: `${tab.key}.page.${cache === "empty" ? "load" : "warm"}`,
  label: cache === "empty" ? `Open ${tab.noun} by address, first time on this device` : `Reopen ${tab.noun} by address`,
  surface: tab.surface, kind: "page-load", viewer: "owner", cache,
  flows: tab.flows, routes: [tab.route],
  act: (c) => c.visit(at(c, tab)),
  done: (c) => tab.content(c),
})));

function tabSwitch(id: string, from: Tab, to: Tab): Interaction {
  return {
    id,
    label: `Switch from ${from.nav} to ${to.nav}`,
    surface: to.surface, kind: "navigation", viewer: "owner",
    flows: to.flows, routes: [from.route, to.route],
    prepare: (c) => open(c, at(c, from), "nav.loop-nav a"),
    act: (c) => c.page.locator("nav.loop-nav").getByRole("link", { name: to.nav, exact: true }).click(),
    done: (c) => ({ ...to.content(c), path: `^${at(c, to)}$` }),
  };
}

export const tabInteractions: Interaction[] = [
  ...loads,
  {
    id: "overview.tab.people",
    label: "Switch from Overview to People",
    surface: "people", kind: "navigation", viewer: "owner",
    flows: ["B3"], routes: ["/g/[id]/members"],
    prepare: (c) => c.page.goto(`/g/${c.world.loopId}`).then(() => undefined),
    act: (c) => c.page.locator("nav.loop-nav").getByRole("link", { name: "People", exact: true }).click(),
    done: (c) => ({ selector: "h1", text: "People", path: `/g/${c.world.loopId}/members` }),
  },
  tabSwitch("people.tab.questions", TABS.people, TABS.questions),
  tabSwitch("questions.tab.rounds", TABS.questions, TABS.rounds),
  tabSwitch("rounds.tab.album", TABS.rounds, TABS.album),
  tabSwitch("album.tab.settings", TABS.album, TABS.settings),
  tabSwitch("settings.tab.overview", TABS.settings, TABS.overview),
  {
    id: "overview.back.you",
    label: "Go from a loop back to your loops",
    surface: "your loops", kind: "navigation", viewer: "owner",
    flows: [], routes: ["/g/[id]", "/you"],
    prepare: async (c) => {
      await c.world.dropThrowaways();
      await open(c, `/g/${c.world.loopId}`, "a.loop-head__home");
    },
    act: (c) => c.page.locator("a.loop-head__home").click(),
    done: () => ({ selector: "a.loop-card", text: "The Friday Loop", path: "^/you$" }),
  },
];
