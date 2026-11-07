/**
 * Does the catalog still cover the app? Every page and route a person can drive must
 * appear in some interaction's `routes`, or be in EXEMPT with a reason. Flows are
 * listed for reading, and most of what is left has no gesture to time.
 *
 *   npm run perf:check
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { INTERACTIONS } from "../interactions/index";
import type { Interaction } from "./types";

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, "src", "app");
const FLOWS_FILE = path.join(ROOT, "specs", "flows.md");

/** Files that answer a request, besides `page.tsx` and `route.ts`. */
const OTHER_ROUTE_FILES = new Set(["not-found.tsx", "robots.ts", "manifest.ts", "opengraph-image.tsx"]);

export const EXEMPT: Record<string, string> = {
  "/api/cron/sweep": "Scheduler entry point: the cron calls it, nobody presses anything.",
  "/api/webhooks/resend": "Resend's delivery webhook: machine to machine.",
  "/api/health": "Uptime probe for monitors.",
  "/api/healthz": "Uptime probe for monitors.",
  "/api/version": "Deploy check for scripts.",
  "/uploads/[file]": "Local stand-in for Blob storage. Production never hits it; it is timed as part of the pages that show photos.",
  "/dev/emails": "Developer preview, not linked from the site.",
  "/dev/feedback": "Key-locked notes reader for the people who build Friendloop.",
  "/dev/outbox": "Developer preview, not linked from the site.",
  "/dev/stats": "Key-locked usage numbers for the people who build Friendloop.",
  "/dev/screens": "Developer preview, not linked from the site.",
  "/dev/ui": "Developer preview unlock, not linked from the site.",
  "/dev/ui/signout": "Developer preview, not linked from the site.",
  "/dev/ui/wear": "Developer preview, not linked from the site.",
  "/robots.txt": "Read by crawlers.",
  "/manifest.webmanifest": "Read by the browser in the background.",
  "/opengraph-image": "Read by link previews in other apps.",
};

export type Coverage = {
  ok: boolean;
  interactions: number;
  bySurface: Record<string, number>;
  routes: {
    total: number;
    covered: Array<{ route: string; interactions: string[] }>;
    exempt: Array<{ route: string; reason: string }>;
    uncovered: string[];
    /** Named by an interaction but not a route in src/app: a typo or a renamed route. */
    unknown: Array<{ route: string; interaction: string }>;
    /** An exemption for a route that no longer exists. */
    staleExemptions: string[];
  };
  flows: {
    total: number;
    covered: Array<{ flow: string; title: string; interactions: string[] }>;
    uncovered: Array<{ flow: string; title: string }>;
    /** Named by an interaction but not in specs/flows.md. */
    unknown: Array<{ flow: string; interaction: string }>;
  };
};

/** The name Next gives a route file: src/app/g/[id]/page.tsx is /g/[id]. */
function routeName(file: string): string {
  const relative = path.relative(APP_DIR, file).split(path.sep);
  const base = relative.pop()!;
  const segments = relative.filter((segment) => !/^\(.*\)$/.test(segment));
  const prefix = `/${segments.join("/")}`.replace(/\/$/, "") || "/";
  if (base === "not-found.tsx") return "/not-found";
  if (base === "robots.ts") return "/robots.txt";
  if (base === "manifest.ts") return "/manifest.webmanifest";
  if (base === "opengraph-image.tsx") return "/opengraph-image";
  return prefix;
}

export function appRoutes(directory: string = APP_DIR): string[] {
  const found = readdirSync(directory, { withFileTypes: true }).flatMap((entry): string[] => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return appRoutes(full);
    const isRoute = entry.name === "page.tsx" || entry.name === "route.ts" || (directory === APP_DIR && OTHER_ROUTE_FILES.has(entry.name));
    return isRoute ? [routeName(full)] : [];
  });
  return [...new Set(found)].sort();
}

export function flowInventory(): Array<{ flow: string; title: string }> {
  return readFileSync(FLOWS_FILE, "utf8")
    .split("\n")
    .flatMap((line) => {
      const row = /^\|\s*([A-Z]\d+)\s*\|\s*([^|]+?)\s*\|/.exec(line);
      return row ? [{ flow: row[1], title: row[2] }] : [];
    });
}

/** The coverage as data, for the dashboard. */
export function coverage(interactions: Interaction[] = INTERACTIONS): Coverage {
  const routes = appRoutes();
  const known = new Set(routes);
  const flows = flowInventory();
  const knownFlows = new Set(flows.map((entry) => entry.flow));

  const byRoute = new Map<string, string[]>();
  const byFlow = new Map<string, string[]>();
  const bySurface: Record<string, number> = {};
  const unknownRoutes: Coverage["routes"]["unknown"] = [];
  const unknownFlows: Coverage["flows"]["unknown"] = [];

  for (const interaction of interactions) {
    bySurface[interaction.surface] = (bySurface[interaction.surface] ?? 0) + 1;
    for (const route of interaction.routes) {
      if (!known.has(route)) unknownRoutes.push({ route, interaction: interaction.id });
      byRoute.set(route, [...(byRoute.get(route) ?? []), interaction.id]);
    }
    for (const flow of interaction.flows) {
      if (!knownFlows.has(flow)) unknownFlows.push({ flow, interaction: interaction.id });
      byFlow.set(flow, [...(byFlow.get(flow) ?? []), interaction.id]);
    }
  }

  const covered = routes.filter((route) => byRoute.has(route));
  const uncovered = routes.filter((route) => !byRoute.has(route) && !(route in EXEMPT));
  const exempt = routes.filter((route) => !byRoute.has(route) && route in EXEMPT);
  const staleExemptions = Object.keys(EXEMPT).filter((route) => !known.has(route));

  return {
    ok: uncovered.length === 0 && unknownRoutes.length === 0 && unknownFlows.length === 0,
    interactions: interactions.length,
    bySurface,
    routes: {
      total: routes.length,
      covered: covered.map((route) => ({ route, interactions: byRoute.get(route)! })),
      exempt: exempt.map((route) => ({ route, reason: EXEMPT[route] })),
      uncovered,
      unknown: unknownRoutes,
      staleExemptions,
    },
    flows: {
      total: flows.length,
      covered: flows.filter(({ flow }) => byFlow.has(flow)).map(({ flow, title }) => ({ flow, title, interactions: byFlow.get(flow)! })),
      uncovered: flows.filter(({ flow }) => !byFlow.has(flow)),
      unknown: unknownFlows,
    },
  };
}

function report(data: Coverage) {
  const { routes, flows } = data;
  console.log(`${data.interactions} interactions: ${Object.entries(data.bySurface).map(([surface, count]) => `${surface} ${count}`).join(", ")}`);
  console.log(`\nRoutes: ${routes.covered.length} covered, ${routes.exempt.length} exempt, ${routes.uncovered.length} uncovered, of ${routes.total}`);
  for (const route of routes.uncovered) console.log(`  UNCOVERED ${route}`);
  for (const { route, interaction } of routes.unknown) console.log(`  UNKNOWN   ${route} (named by ${interaction})`);
  for (const route of routes.staleExemptions) console.log(`  STALE     ${route} is exempt but no longer exists`);
  for (const { route, reason } of routes.exempt) console.log(`  exempt    ${route}: ${reason}`);
  console.log(`\nFlows: ${flows.covered.length} covered, ${flows.uncovered.length} not covered, of ${flows.total}`);
  for (const { flow, title } of flows.uncovered) console.log(`  not covered ${flow}: ${title}`);
  for (const { flow, interaction } of flows.unknown) console.log(`  UNKNOWN     ${flow} (named by ${interaction})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = coverage();
  report(data);
  process.exit(data.ok ? 0 : 1);
}
