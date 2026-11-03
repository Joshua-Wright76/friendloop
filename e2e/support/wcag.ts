import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { RunOptions } from "axe-core";

/**
 * The WCAG 2.2 AA checks axe cannot make, as helpers a spec composes.
 *
 * axe reads the DOM and computed styles. It cannot tell whether a focus ring is
 * actually visible, whether a fixed button covers the control you just tabbed to,
 * whether the page survives 400% zoom, or whether widening letter spacing clips
 * text. Each helper here measures what a person would see instead of what the
 * stylesheet claims, and returns a list of problems rather than throwing, so one
 * run reports every failure on a screen.
 */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * axe files these under "best-practice", outside the WCAG tags, but each one
 * catches a real 2.4.x / 1.3.1 / 4.1.2 problem on this site, so they are enforced.
 */
const EXTRA_RULES = new Set([
  "heading-order",
  "page-has-heading-one",
  "landmark-one-main",
  "landmark-unique",
  "empty-heading",
  "skip-link",
  "aria-dialog-name",
  "tabindex",
  "meta-viewport-large",
  "region",
]);

/**
 * 400% zoom of a 1280x1024 window: the viewport 1.4.10 asks the page to survive.
 * Phones are wider than this, so the short height is the demanding part (fixed
 * bars and sticky headers leave very little of it).
 */
export const ZOOM_400 = { width: 320, height: 256 } as const;

/** axe reads `options.checks[id]` at run time; its own type for RunOptions just does not list it. */
const IGNORE_PSEUDO = { checks: { "color-contrast": { options: { ignorePseudo: true } } } } as unknown as RunOptions;

export type Problems = string[];

type AxeNode = { target: unknown[]; any: Array<{ message?: string }> };

function describeNodes(nodes: AxeNode[]): string {
  return nodes
    .slice(0, 3)
    .map((node) => `${node.target.join(" ")}${node.any[0]?.message ? ` [${node.any[0].message}]` : ""}`)
    .join(" | ");
}

export async function axeProblems(page: Page, label: string): Promise<Problems> {
  // ignorePseudo: a 1.5px decorative ::before line (the margin rule on `.paper` cards) must not make axe give
  // up on every text node near it; the contrast is then really measured.
  const result = await new AxeBuilder({ page })
    .withTags([...AXE_TAGS, "best-practice"])
    .options(IGNORE_PSEUDO)
    .analyze();
  const out: Problems = [];
  for (const violation of result.violations) {
    const wcag = violation.tags.some((tag) => AXE_TAGS.includes(tag));
    if (!wcag && !EXTRA_RULES.has(violation.id)) continue;
    out.push(`${label}: axe ${violation.id} (${violation.nodes.length}) — ${describeNodes(violation.nodes)}`);
  }
  // "Incomplete" means axe could not decide (text over an image or a gradient). For contrast
  // that is exactly where a real failure hides, so it is not allowed to pass silently.
  for (const incomplete of result.incomplete) {
    if (incomplete.id !== "color-contrast") continue;
    // Text on the gingham page is the one case checked elsewhere: src/lib/theme.test.ts computes every
    // token against the page where its two stripe layers cross (busiestPage). Any OTHER reason axe gives
    // (an image, an overlapping element, a pseudo-element) is still unverified and still fails.
    // Likewise for reasons that are not about a colour pair at all: a glyph with no text in it, an empty
    // input (its placeholder colour is a token, tested), and decoration drawn by a pseudo-element.
    // (The sticky reply bars are deliberately layered over the page, which axe reports as "overlapped".)
    const KNOWN = /background gradient|only non-text characters|has no value/;
    const unverified = incomplete.nodes.filter((node) => !node.any.some((check) => KNOWN.test(check.message ?? "")));
    if (!unverified.length) continue;
    // Text under or over the page's fixed chrome (feedback/theme buttons, sticky reply bars) is
    // "overlapped" to axe. Measure it again with that chrome out of the way before calling it unverified.
    const overlapped = unverified.filter((node) => node.any.some((check) => /overlap|obscured/.test(check.message ?? "")));
    if (overlapped.length === unverified.length) {
      const handle = await page.addStyleTag({ content: ".feedback-button, .theme-switch, .reply-topbar, .reply-actionbar { visibility: hidden !important; }" });
      try {
        const again = await new AxeBuilder({ page })
          .withRules(["color-contrast"])
          .options(IGNORE_PSEUDO)
          .include(overlapped.map((node) => node.target.join(" ")).slice(0, 25))
          .analyze();
        for (const violation of again.violations) out.push(`${label}: axe ${violation.id} (${violation.nodes.length}, with fixed bars hidden) — ${describeNodes(violation.nodes)}`);
        for (const remaining of again.incomplete) {
          const left = remaining.nodes.filter((node) => !node.any.some((check) => KNOWN.test(check.message ?? "")));
          if (left.length) out.push(`${label}: axe could not verify contrast even with fixed bars hidden (${left.length}) — ${describeNodes(left)}`);
        }
      } finally {
        await handle.evaluate((node) => (node as Element).remove());
      }
      continue;
    }
    incomplete.nodes = unverified;
    out.push(`${label}: axe could not verify contrast (${incomplete.nodes.length}) — ${describeNodes(incomplete.nodes)}`);
  }
  return out;
}

/* ----------------------------- 1.4.10 reflow ----------------------------- */

/**
 * At 320 CSS pixels (1280px at 400% zoom) nothing may force the page to scroll
 * sideways, and nothing may be cut off by a wrapper that hides its overflow.
 * Content inside its own scroller (a tab strip) is fine.
 */
export async function reflowProblems(page: Page, label: string): Promise<Problems> {
  const width = page.viewportSize()!.width;
  return (await wideElements(page)).map((name) => `${label}: reflow at ${width}px — ${name}`);
}

async function wideElements(page: Page): Promise<string[]> {
  const width = page.viewportSize()!.width;
  return page.evaluate((viewportWidth) => {
    const names: string[] = [];
    const describe = (el: Element) => {
      const klass = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
      return `${el.tagName.toLowerCase()}${klass ? "." + klass : ""}`;
    };
    const scrolls = document.documentElement.scrollWidth - viewportWidth;
    // The one place content may scroll sideways: the loop's tab strip. Anything else that scrolls
    // sideways (a dialog, a list) is two-dimensional scrolling, which 1.4.10 does not allow.
    const ALLOWED = ".loop-nav";
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (!p.matches(ALLOWED)) continue;
        const o = getComputedStyle(p);
        if (o.overflowX === "auto" || o.overflowX === "scroll") return true;
      }
      return false;
    };
    for (const el of document.body.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (inScroller(el)) continue;
      // Poking out to the right (or left) of the viewport, including from a fixed bar.
      if (rect.right > viewportWidth + 1 || rect.left < -1) {
        if (style.position !== "fixed" && scrolls <= 0 && rect.left >= -1) continue; // clipped away by an ancestor: reported below
        names.push(`${describe(el)} spans ${Math.round(rect.left)}–${Math.round(rect.right)} “${(el.textContent ?? "").trim().slice(0, 30)}”`);
      }
      // A scroller of its own that scrolls sideways is 2-D scrolling (the tab strip is the exception).
      if (rect.width > 2 && (style.overflowX === "auto" || style.overflowX === "scroll") && !el.matches(ALLOWED) && el.scrollWidth > el.clientWidth + 1) {
        names.push(`${describe(el)} scrolls sideways by ${el.scrollWidth - el.clientWidth}px`);
      }
      // A wrapper that hides its overflow makes whatever is cut off unreachable.
      // (a 1px wrapper is a visually-hidden label, which hides its text on purpose)
      if (rect.width > 2 && (style.overflowX === "hidden" || style.overflowX === "clip") && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim() && style.textOverflow !== "ellipsis") {
        names.push(`${describe(el)} hides ${el.scrollWidth - el.clientWidth}px of its content`);
      }
      if (names.length >= 4) break;
    }
    if (!names.length && scrolls > 0) names.push(`page is ${scrolls}px wider than the viewport`);
    return names;
  }, width);
}

/* --------------------------- 1.4.12 text spacing -------------------------- */

// `:root:root:root *` outranks every `!important` rule in the stylesheet (headings, .home-title).
const TEXT_SPACING_CSS = `
  :root:root:root *, :root:root:root *::before, :root:root:root *::after {
    line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important;
  }
  :root:root:root p { margin-bottom: 2em !important; }
`;

type Clipping = { overflow: Record<string, number>; names: Record<string, string>; scrollWidth: number };

/**
 * Apply the 1.4.12 override stylesheet and report text that was readable before
 * and is cut off, truncated, or pushed off the page after.
 */
export async function textSpacingProblems(page: Page, label: string): Promise<Problems> {
  const before = await page.evaluate(measureClipping);
  const handle = await page.addStyleTag({ content: TEXT_SPACING_CSS });
  const after = await page.evaluate(measureClipping);
  const width = page.viewportSize()!.width;
  const problems: Problems = [];
  for (const [id, amount] of Object.entries(after.overflow)) {
    const was = before.overflow[id] ?? 0;
    if (amount > was + 2) problems.push(`${label}: text spacing hides ${amount - was}px of ${after.names[id]}`);
  }
  if (after.scrollWidth > Math.max(before.scrollWidth, width) + 1) {
    problems.push(`${label}: text spacing makes the page scroll sideways (${after.scrollWidth}px in ${width}px): ${(await wideElements(page)).join("; ")}`);
  }
  await handle.evaluate((node) => (node as Element).remove());
  return problems;
}

/** How much text each clipping element cuts off, keyed by a stable id, so before/after compare the same node. */
function measureClipping(): Clipping {
  const overflow: Record<string, number> = {};
  const names: Record<string, string> = {};
  const w = window as unknown as { __clip?: number };
  for (const el of document.body.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const hides = (v: string) => v === "hidden" || v === "clip";
    if (!hides(style.overflowX) && !hides(style.overflowY)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) continue; // visually-hidden helpers
    // Form controls scroll their own value; that is not lost content.
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !(el.textContent ?? "").trim()) continue;
    let id = el.getAttribute("data-ts-id");
    if (!id) { id = String((w.__clip = (w.__clip ?? 0) + 1)); el.setAttribute("data-ts-id", id); }
    const cutY = hides(style.overflowY) ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
    const cutX = hides(style.overflowX) ? Math.max(0, el.scrollWidth - el.clientWidth) : 0;
    overflow[id] = cutX + cutY;
    const klass = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    names[id] = `${el.tagName.toLowerCase()}${klass ? "." + klass : ""} “${(el.textContent ?? "").trim().slice(0, 40)}”`;
  }
  return { overflow, names, scrollWidth: document.documentElement.scrollWidth };
}

/* ------------------------------ keyboard sweep ---------------------------- */

type Stop = {
  plain: string | null;
  index: number;
  name: string;
  scrollX: number;
  scrollY: number;
  clip: { x: number; y: number; width: number; height: number } | null;
  hidden: boolean;
  offscreen: boolean;
  covered: string | null;
  focused: string | null;
};

/**
 * Put the sequential-focus starting point back at the top of the document. A mouse
 * click (the theme toggle) moves it, and `blur()` does not: without this, the first
 * Tab after a click leaves the document and the sweep would visit nothing and pass.
 */
async function resetTabStart(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    // An open modal dialog owns Tab: start inside it instead of at the page.
    const modal = document.querySelector("dialog[open]");
    const anchor = document.createElement("div");
    anchor.tabIndex = -1;
    (modal ?? document.body).insertBefore(anchor, (modal ?? document.body).firstChild);
    anchor.focus();
    anchor.remove();
  });
}

/** Tab through the whole page once, recording what each stop looks like. */
async function collectStops(page: Page, max: number): Promise<{ stops: Stop[]; problems: Problems }> {
  const problems: Problems = [];
  const stops: Stop[] = [];
  await resetTabStart(page);
  const seen = new Set<number>();
  let repeats = 0;
  let wrapped = false;
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(describeFocus);
    if (!info) { wrapped = true; break; } // focus left the document: one full cycle
    if (stops.length > 0 && stops[stops.length - 1].index === info.index) {
      // <audio controls> keeps document.activeElement on itself while Tab walks its
      // internal buttons, so only a long unbroken run on one element is a trap.
      repeats += 1;
      if (repeats > 12) {
        problems.push(`keyboard trap: Tab stays on ${info.name}`);
        wrapped = true;
        break;
      }
      continue;
    }
    repeats = 0;
    if (seen.has(info.index)) {
      // Back at the first stop is the cycle closing; anywhere else is a loop that never reaches the end.
      if (info.index !== stops[0].index) problems.push(`keyboard trap: focus loops back to ${info.name} without reaching the end of the page`);
      wrapped = true;
      break;
    }
    seen.add(info.index);
    const stop: Stop = { ...info, focused: null, plain: null };
    if (stop.clip) {
      stop.focused = (await page.screenshot({ clip: stop.clip })).toString("base64");
      // The unfocused baseline is taken right here, with the page exactly as it is: capturing it after
      // the sweep would count every lazy image and inner scroll that moved in between as a "focus ring".
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      stop.plain = (await page.screenshot({ clip: stop.clip })).toString("base64");
      await page.evaluate((index) => (document.querySelector(`[data-a11y-stop="${index}"]`) as HTMLElement | null)?.focus({ preventScroll: true }), info.index);
    }
    stops.push(stop);
  }
  if (!wrapped) problems.push(`keyboard sweep stopped at its ${max}-stop cap before the end of the page; later controls were not checked`);
  if (stops.length === 0) problems.push("Tab reached nothing (the sweep would otherwise pass vacuously)");
  else {
    const modal = await page.evaluate(() => Boolean(document.querySelector("dialog[open]")));
    if (!modal && !/skip-link/.test(stops[0].name)) problems.push(`the first Tab stop is ${stops[0].name}, not the skip link`);
    // Every tabbable, visible control must have been reached: a sweep that skips one has not checked it.
    const missed = await page.evaluate(() => {
      const modalOpen = document.querySelector("dialog[open]");
      const scope: ParentNode = modalOpen ?? document;
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") return false;
        for (let p: Element | null = el; p; p = p.parentElement) if (p.hasAttribute("inert") || p.getAttribute("aria-hidden") === "true" && !p.closest("[data-a11y-allow]")) { if (p.hasAttribute("inert")) return false; }
        return r.width > 0 && r.height > 0;
      };
      const list = Array.from(scope.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, audio[controls], [tabindex]:not([tabindex="-1"])'));
      return list
        .filter((el) => visible(el) && !el.closest("details:not([open]) > :not(summary)") && !(el instanceof HTMLInputElement && el.type === "radio") && (el as HTMLElement).tabIndex >= 0)
        .filter((el) => !el.hasAttribute("data-a11y-stop"))
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} “${(el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28)}”`);
    });
    for (const name of missed) problems.push(`Tab never reached ${name}`);
  }
  return { stops, problems };
}

function describeFocus() {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return null;
  const w = window as unknown as { __stop?: number };
  const marked = el.getAttribute("data-a11y-stop");
  const index = marked ? Number(marked) : (w.__stop = (w.__stop ?? 0) + 1);
  if (!marked) el.setAttribute("data-a11y-stop", String(index));

  const klass = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
  const label = (
    el.getAttribute("aria-label") ||
    (el as HTMLInputElement).labels?.[0]?.textContent ||
    el.textContent ||
    (el as HTMLInputElement).name ||
    (el as HTMLInputElement).placeholder ||
    ""
  ).trim().replace(/\s+/g, " ").slice(0, 32);
  const name = `${el.tagName.toLowerCase()}${klass ? "." + klass : ""} “${label}”`;

  const own = el.getBoundingClientRect();
  const hidden = own.width < 4 || own.height < 4;
  // A visually hidden control (a radio inside a styled label) shows its focus on its
  // label or a sibling, so measure that, not an arbitrary ancestor.
  let target: Element = el;
  // A checkbox/radio shows its focus on the row around it; an input inside a `.field` box shows it on the box.
  const isCheck = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
  const row = isCheck ? (el.closest(".poll-option, label") as Element | null) : null;
  const box = !isCheck && el.parentElement?.classList.contains("field") ? el.parentElement : null;
  if (!hidden && (row || box)) target = (row ?? box) as Element;
  if (hidden) {
    const labelled = (el as HTMLInputElement).labels?.[0];
    const sibling = el.nextElementSibling;
    const pick = [labelled, sibling].find((candidate) => {
      if (!candidate) return false;
      const r = candidate.getBoundingClientRect();
      return r.width >= 24 && r.height >= 24;
    });
    if (pick) target = pick;
    else {
      for (let p: Element | null = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const r = p.getBoundingClientRect();
        if (r.width >= 24 && r.height >= 24) { target = p; break; }
      }
    }
  }
  const rect = target.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const inflate = 10;
  const x = Math.max(0, Math.floor(rect.left - inflate));
  const y = Math.max(0, Math.floor(rect.top - inflate));
  const right = Math.min(vw, Math.ceil(rect.right + inflate));
  const bottom = Math.min(vh, Math.ceil(rect.bottom + inflate));
  const visibleW = Math.min(rect.right, vw) - Math.max(rect.left, 0);
  const visibleH = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
  const offscreen = visibleW <= 0 || visibleH <= 0;
  const clip = offscreen || right - x < 2 || bottom - y < 2 ? null : { x, y, width: right - x, height: bottom - y };

  // 2.4.11: the focused control must not be hidden by fixed or sticky content.
  let covered: string | null = null;
  if (!offscreen) {
    const probe = hidden ? target : el;
    const pr = probe.getBoundingClientRect();
    const pw = Math.min(pr.right, vw) - Math.max(pr.left, 0);
    const ph = Math.min(pr.bottom, vh) - Math.max(pr.top, 0);
    const px = [0.5, 0.15, 0.85];
    const samples: Array<[number, number]> = [];
    for (const fx of px) for (const fy of px) {
      samples.push([Math.max(pr.left, 0) + pw * fx, Math.max(pr.top, 0) + ph * fy]);
    }
    const tops = samples.map(([sx, sy]) => document.elementFromPoint(sx, sy));
    const allCovered = tops.every((top) => top && top !== probe && !probe.contains(top) && !top.contains(probe) && !(top as HTMLElement).contains(el));
    if (allCovered) {
      const t = tops[0] as HTMLElement;
      covered = `${t.tagName.toLowerCase()}${typeof t.className === "string" && t.className ? "." + t.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
    }
  }
  return { index, name, scrollX: window.scrollX, scrollY: window.scrollY, clip, hidden, offscreen, covered };
}

/**
 * Decode two screenshots in the browser and count the pixels the focus state changed
 * that read as an indicator: either 3:1 against the pixel they replaced, or (for a pixel
 * that was plain background) 3:1 against that surrounding background. A text pixel that
 * merely darkened does not count, which is why "was background" is required for the second route.
 */
async function changedPixels(helper: Page, focused: string, unfocused: string): Promise<{ strong: number; changed: number }> {
  return helper.evaluate(async ([a, b]) => {
    const load = async (b64: string) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    };
    const [fa, fb] = [await load(a), await load(b)];
    const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const lum = (r: number, g: number, bl: number) => 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
    const ratio = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    const W = fb.width;
    const H = fb.height;
    // The surrounding colour: the most common colour on the clip's outermost ring.
    const counts = new Map<string, [number, number]>();
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      if (x > 0 && y > 0 && x < W - 1 && y < H - 1) continue;
      const i = (y * W + x) * 4;
      const key = `${fb.data[i]},${fb.data[i + 1]},${fb.data[i + 2]}`;
      const entry = counts.get(key);
      if (entry) entry[1] += 1; else counts.set(key, [lum(fb.data[i], fb.data[i + 1], fb.data[i + 2]), 1]);
    }
    let around = 0.5, best = 0;
    for (const [l, n] of counts.values()) if (n > best) { best = n; around = l; }

    let strong = 0;
    let changed = 0;
    for (let i = 0; i < fa.data.length; i += 4) {
      const d = Math.abs(fa.data[i] - fb.data[i]) + Math.abs(fa.data[i + 1] - fb.data[i + 1]) + Math.abs(fa.data[i + 2] - fb.data[i + 2]);
      if (d < 12) continue;
      changed += 1;
      const l1 = lum(fa.data[i], fa.data[i + 1], fa.data[i + 2]);
      const l2 = lum(fb.data[i], fb.data[i + 1], fb.data[i + 2]);
      const wasBackground = ratio(l2, around) < 1.25;
      if (ratio(l1, l2) >= 3 || (wasBackground && ratio(l1, around) >= 3)) strong += 1;
    }
    return { strong, changed };
  }, [focused, unfocused] as const);
}

/** A ring is a band around the control, so it needs at least a short side's worth of strong pixels. */
function enoughPixels(strong: number, clip: { width: number; height: number }): boolean {
  return strong >= Math.max(12, Math.min(clip.width, clip.height));
}

/**
 * The same indicator, visibility and obscuring checks, for whatever currently has
 * focus: an option reached with the arrow keys, a field a script just focused.
 */
export async function focusedProblems(page: Page, label: string): Promise<Problems> {
  const helper = await page.context().newPage();
  try {
    const info = await page.evaluate(describeFocus);
    if (!info) return [`${label}: nothing has focus`];
    const stop: Stop = { ...info, focused: null, plain: null };
    const out: Problems = [];
    if (stop.offscreen) return [`${label}: focus lands outside the viewport on ${stop.name}`];
    if (stop.covered) out.push(`${label}: ${stop.name} is covered by ${stop.covered} when focused`);
    if (!stop.clip) return out;
    const focused = (await page.screenshot({ clip: stop.clip })).toString("base64");
    // The ring may be drawn on a wrapper, so compare with the element truly unfocused,
    // then hand focus back so the caller can keep arrowing through a widget.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const plain = (await page.screenshot({ clip: stop.clip })).toString("base64");
    await page.evaluate((index) => (document.querySelector(`[data-a11y-stop="${index}"]`) as HTMLElement | null)?.focus(), stop.index);
    const { strong, changed } = await changedPixels(helper, focused, plain);
    if (changed === 0) out.push(`${label}: no visible focus indicator on ${stop.name}`);
    else if (!enoughPixels(strong, stop.clip)) out.push(`${label}: focus indicator is below 3:1 on ${stop.name} (${strong}/${changed} px)`);
    return out;
  } finally {
    await helper.close();
  }
}

/** Expand every disclosure so the controls inside are part of the audit. */
export async function openAllDetails(page: Page): Promise<number> {
  return page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("details"));
    all.forEach((details) => { details.open = true; });
    return all.length;
  });
}

/**
 * Every Tab stop must (2.1.2) not trap focus, (2.4.7) show a visible indicator,
 * (1.4.11) one that differs from the unfocused control by at least 3:1, and
 * (2.4.11) not be covered by other content.
 */
export async function keyboardProblems(page: Page, label: string, max = 400): Promise<Problems> {
  const helper = await page.context().newPage();
  try {
    const { stops, problems } = await collectStops(page, max);
    const out = problems.map((problem) => `${label}: ${problem}`);
    for (const stop of stops) {
      if (stop.offscreen) { out.push(`${label}: focus lands outside the viewport on ${stop.name}`); continue; }
      if (stop.covered) out.push(`${label}: ${stop.name} is covered by ${stop.covered} when focused`);
      if (!stop.clip || !stop.focused || !stop.plain) continue;
      const { strong, changed } = await changedPixels(helper, stop.focused, stop.plain);
      const bad = changed === 0 ? "no visible focus indicator on" : !enoughPixels(strong, stop.clip) ? "focus indicator is below 3:1 on" : null;
      if (bad) {
        out.push(`${label}: ${bad} ${stop.name}${changed ? ` (${strong}/${changed} px)` : ""}`);
        const dir = process.env.WCAG_DEBUG_DIR;
        if (dir) {
          const { mkdirSync, writeFileSync } = await import("node:fs");
          mkdirSync(dir, { recursive: true });
          const slug = `${label}-${stop.index}`.replace(/[^a-z0-9]+/gi, "_");
          writeFileSync(`${dir}/${slug}-focused.png`, Buffer.from(stop.focused, "base64"));
          writeFileSync(`${dir}/${slug}-plain.png`, Buffer.from(stop.plain, "base64"));
        }
      }
    }
    return out;
  } finally {
    await helper.close();
  }
}
