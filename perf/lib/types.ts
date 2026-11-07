import type { BrowserContext, Page } from "@playwright/test";
import type { DoneSpec } from "./probe";
import type { Profile } from "./profiles";
import type { World } from "./world";

export type Surface =
  | "public" | "sign-in" | "your loops" | "new loop" | "overview" | "people"
  | "questions" | "rounds" | "settings" | "reply" | "reading" | "album" | "site-wide";

/**
 * - page-load: a whole document, usually from an email link or a typed address
 * - navigation: following a link inside the app
 * - write: a change the server has to accept
 * - instant: a change the browser can answer alone (menus, sheets, typing)
 */
export type Kind = "page-load" | "navigation" | "write" | "instant";

export type Viewer = "anon" | "owner" | "member";

export type Ctx = {
  page: Page;
  context: BrowserContext;
  world: World;
  profile: Profile;
  viewer: Viewer;
  /** Different on every repetition, so writes never collide. */
  unique: string;
  /** A page load's `act`: go, and do not wait for anything. */
  visit(path: string): Promise<void>;
  /** For a gesture with no input event of its own. */
  startClock(): Promise<void>;
};

export type Interaction = {
  /** Stable forever: history is joined on it. Rename only with a very good reason. */
  id: string;
  /** What the person is doing, in their words. */
  label: string;
  surface: Surface;
  kind: Kind;
  viewer: Viewer;
  /** Flow ids from specs/flows.md this exercises. */
  flows: string[];
  /** The route files this exercises, as Next names them: "/g/[id]/members". */
  routes: string[];
  /** Page loads only: "empty" is a first visit, "warm" a return with cached assets. */
  cache?: "empty" | "warm";
  /** Get to the starting state. Not timed. */
  prepare?(ctx: Ctx): Promise<void>;
  /** The one gesture the clock starts on. */
  act(ctx: Ctx): Promise<void>;
  /** What the person is waiting to see, and nothing earlier: never a skeleton. */
  done(ctx: Ctx): DoneSpec;
};

export type RequestRecord = {
  path: string;
  type: string;
  role: "document" | "rsc" | "action" | "prefetch" | "asset";
  status: number;
  bytes: number;
  startMs: number;
  waitMs: number;
  endMs: number;
};

export type Sample = {
  doneMs: number;
  feedbackMs: number | null;
  interactiveMs: number | null;
  confirmedMs: number;
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number;
  longTaskMs: number;
  serverMs: number;
  networkMs: number;
  browserMs: number;
  requests: number;
  bytes: number;
  bytesByRole: Record<string, number>;
  dbQueries: number;
  dbMs: number;
  detail?: { requests: RequestRecord[]; queries: Array<{ sql: string; ms: number }> };
};

export type Measured = {
  id: string;
  label: string;
  surface: Surface;
  kind: Kind;
  viewer: Viewer;
  flows: string[];
  routes: string[];
  cache?: "empty" | "warm";
  profile: Profile["id"];
  failures: string[];
  samples: Sample[];
};

export type Run = {
  id: string;
  label: string;
  createdAt: string;
  git: { sha: string; dirtyFiles: number };
  partial: boolean;
  config: {
    reps: number;
    dbRoundTripMs: number;
    profiles: Array<Pick<Profile, "id" | "label" | "cpuSlowdown" | "latencyMs" | "downKbps" | "upKbps">>;
  };
  machine: { cpus: number; loadBefore: number; loadAfter: number };
  durationSec: number;
  results: Measured[];
};
