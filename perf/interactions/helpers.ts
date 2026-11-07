import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { DoneSpec } from "../lib/probe";
import type { Ctx } from "../lib/types";

const FIXTURES = path.join(process.cwd(), "recordings", "fixtures");
export const PHOTO = path.join(FIXTURES, "photo1.jpg");
export const WALL_PHOTO = path.join(FIXTURES, "photo2.jpg");
export const HEADER = path.join(FIXTURES, "header.jpg");
export const AVATAR = path.join(FIXTURES, "avatar.jpg");
export const VOICE = path.join(FIXTURES, "note.mp3");

const SESSION_COOKIE = "fl_session";

/** Hands a value from `prepare` to `act`: one sample, one page. */
export function stash<T>() {
  const values = new WeakMap<Page, T>();
  return {
    put(c: Ctx, value: T) { values.set(c.page, value); },
    take(c: Ctx): T {
      const value = values.get(c.page);
      if (value === undefined) throw new Error("prepare did not stash a value for this page");
      return value;
    },
  };
}

/**
 * Wait until React has this element. A press or a fill that lands before hydration
 * is silently lost, and on the throttled phone hydration can trail `load` by seconds.
 */
export async function live(target: Locator): Promise<void> {
  await target.waitFor({ state: "attached" });
  await target.evaluate((node) => new Promise<void>((resolve) => {
    const ready = () => Object.keys(node).some((key) => key.startsWith("__reactProps"));
    if (ready()) return resolve();
    const timer = setInterval(() => {
      if (ready()) { clearInterval(timer); resolve(); }
    }, 25);
  }));
}

/** Open a page and wait until `anchor` (the thing about to be touched) is hydrated. */
export async function open(c: Ctx, target: string, anchor: string = "main"): Promise<void> {
  await c.page.goto(target);
  await live(c.page.locator(anchor).first());
}

/** One part of a page split by a segmented control: "The pool", "Paper", and so on. */
export async function part(c: Ctx, name: string): Promise<void> {
  const button = c.page.getByRole("button", { name, exact: true });
  await live(button);
  await button.click();
  await c.page.locator(`button[aria-pressed="true"]`, { hasText: name }).waitFor();
}

/** The app's custom Picker, up to the point where its options are showing. */
export async function openPicker(c: Ctx, label: string, scope: Locator | Page = c.page): Promise<void> {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const trigger = scope.getByRole("button", { name: new RegExp(`^${escaped}:`) }).first();
  await live(trigger);
  await trigger.click();
}

export const option = (c: Ctx, name: string) => c.page.getByRole("option", { name, exact: true });

/** Choose in a Picker as part of getting ready: both taps, untimed. */
export async function pick(c: Ctx, label: string, name: string): Promise<void> {
  await openPicker(c, label);
  await option(c, name).click();
}

/** Open a row's "More" menu, where its less common actions live. */
export async function rowMenu(c: Ctx, label: string): Promise<void> {
  const summary = c.page.getByLabel(`More for: ${label}`, { exact: true }).first();
  await live(summary);
  await summary.click();
  await summary.locator("xpath=ancestor::details[1]").locator("div").first().waitFor();
}

/** The whole-round "something changed" notice that arrives with a server redirect. */
export const notice = (text: string, extra: Partial<DoneSpec> = {}): DoneSpec => ({ selector: `.notice[role="status"]`, text, ...extra });

export const quote = (value: string) => value.replaceAll("'", "''");

/** Sign this sample's browser in as someone else, for flows that end the session. */
export async function signInAs(c: Ctx, sessionToken: string): Promise<void> {
  await c.context.addCookies([{ name: SESSION_COOKIE, value: sessionToken, url: c.world.app }]);
}

/**
 * A download leaves nothing on the page to time. So the link's own click is caught,
 * fetched the way the browser would, and a marker appears once the last byte is in:
 * the clock runs from the press to the whole file having arrived.
 */
export async function catchDownload(c: Ctx, href: string): Promise<void> {
  await c.page.evaluate((target) => {
    document.addEventListener("click", (event) => {
      const link = (event.target as Element).closest?.(`a[href="${target}"]`);
      if (!link) return;
      event.preventDefault();
      void fetch(target).then((response) => response.blob()).then(() => {
        const marker = document.createElement("div");
        marker.setAttribute("data-perf-downloaded", "");
        marker.textContent = "downloaded";
        document.body.append(marker);
      });
    }, { capture: true });
  }, href);
}
export const DOWNLOADED: DoneSpec = { selector: "[data-perf-downloaded]" };
