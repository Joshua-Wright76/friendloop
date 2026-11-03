import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

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

export type Problems = string[];

export async function axeProblems(page: Page, label: string): Promise<Problems> {
  const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return result.violations.map(
    (violation) =>
      `${label}: axe ${violation.id} (${violation.nodes.length}) — ${violation.nodes
        .slice(0, 3)
        .map((node) => `${node.target.join(" ")}${node.any[0]?.message ? ` [${node.any[0].message}]` : ""}`)
        .join(" | ")}`,
  );
}

/* ----------------------------- 1.4.10 reflow ----------------------------- */

/**
 * At 320 CSS pixels (1280px at 400% zoom) nothing may force the page to scroll
 * sideways. Content inside its own scroller (a tab strip, a table) is fine.
 */
export async function reflowProblems(page: Page, label: string): Promise<Problems> {
  const width = page.viewportSize()!.width;
  return (await wideElements(page)).map((name) => `${label}: reflow at ${width}px — ${name}`);
}

/** What makes the page wider than its viewport: elements poking out of it, outside any scroller of their own. */
async function wideElements(page: Page): Promise<string[]> {
  const width = page.viewportSize()!.width;
  return page.evaluate((viewportWidth) => {
    const scrolls = document.documentElement.scrollWidth - viewportWidth;
    if (scrolls <= 0) return [] as string[];
    const names: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= viewportWidth + 1) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" || style.visibility === "hidden" || style.display === "none") continue;
      let inScroller = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p);
        if (o.overflowX !== "visible") { inScroller = true; break; }
      }
      if (inScroller) continue;
      const klass = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
      names.push(`${el.tagName.toLowerCase()}${klass ? "." + klass : ""} right=${Math.round(rect.right)} “${(el.textContent ?? "").trim().slice(0, 30)}”`);
      if (names.length >= 4) break;
    }
    return names.length ? names : [`page is ${scrolls}px wider than the viewport`];
  }, width);
}

/* --------------------------- 1.4.12 text spacing -------------------------- */

const TEXT_SPACING_CSS = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

/**
 * Apply the 1.4.12 override stylesheet and report text that was readable before
 * and is clipped, or pushed off the page, after.
 */
export async function textSpacingProblems(page: Page, label: string): Promise<Problems> {
  const before = await page.evaluate(measureClipping);
  const handle = await page.addStyleTag({ content: TEXT_SPACING_CSS });
  const after = await page.evaluate(measureClipping);
  const width = page.viewportSize()!.width;
  const problems: Problems = [];
  const was = new Set(before.clipped);
  for (const name of after.clipped) if (!was.has(name)) problems.push(`${label}: text spacing clips ${name}`);
  if (after.scrollWidth > Math.max(before.scrollWidth, width) + 1) {
    problems.push(`${label}: text spacing makes the page scroll sideways (${after.scrollWidth}px in ${width}px): ${(await wideElements(page)).join("; ")}`);
  }
  await handle.evaluate((node) => (node as Element).remove());
  return problems;
}

function measureClipping() {
  const clipped: string[] = [];
  let index = 0;
  for (const el of document.body.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const hides = (v: string) => v === "hidden" || v === "clip";
    if (!hides(style.overflowX) && !hides(style.overflowY)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) continue; // visually-hidden helpers
    if (!(el.textContent ?? "").trim()) continue;
    if (style.textOverflow === "ellipsis") continue; // truncates by design, before and after alike
    const cut = (hides(style.overflowY) && el.scrollHeight > el.clientHeight + 1) || (hides(style.overflowX) && el.scrollWidth > el.clientWidth + 1);
    if (!cut) continue;
    const klass = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 3).join(".") : "";
    clipped.push(`${el.tagName.toLowerCase()}${klass ? "." + klass : ""}#${index++} “${(el.textContent ?? "").trim().slice(0, 40)}”`);
  }
  return { clipped: clipped.map((name) => name.replace(/#\d+/, "")), scrollWidth: document.documentElement.scrollWidth };
}

/* ------------------------------ keyboard sweep ---------------------------- */

type Stop = {
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

/** Tab through the whole page once, recording what each stop looks like. */
async function collectStops(page: Page, max: number): Promise<{ stops: Stop[]; problems: Problems }> {
  const problems: Problems = [];
  const stops: Stop[] = [];
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const seen = new Set<number>();
  let repeats = 0;
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(describeFocus);
    if (!info) break; // focus left the document: one full cycle
    if (stops.length > 0 && stops[stops.length - 1].index === info.index) {
      // <audio controls> keeps document.activeElement on itself while Tab walks its
      // internal buttons, so only a long unbroken run on one element is a trap.
      repeats += 1;
      if (repeats > 12) {
        problems.push(`keyboard trap: Tab stays on ${info.name}`);
        break;
      }
      continue;
    }
    repeats = 0;
    if (seen.has(info.index)) break; // wrapped around to the start
    seen.add(info.index);
    const stop: Stop = { ...info, focused: null };
    if (stop.clip) stop.focused = (await page.screenshot({ clip: stop.clip })).toString("base64");
    stops.push(stop);
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
  const label = (el.getAttribute("aria-label") ?? el.textContent ?? (el as HTMLInputElement).name ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
  const name = `${el.tagName.toLowerCase()}${klass ? "." + klass : ""} “${label}”`;

  const own = el.getBoundingClientRect();
  const hidden = own.width < 4 || own.height < 4;
  // A visually hidden control (a radio inside a styled label) shows its focus on a
  // wrapper, so measure the nearest wrapper that is actually drawn.
  let target: Element = el;
  if (hidden) {
    for (let p: Element | null = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const r = p.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) { target = p; break; }
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
  if (!hidden && !offscreen) {
    const px = [0.5, 0.15, 0.85];
    const samples: Array<[number, number]> = [];
    for (const fx of px) for (const fy of px) {
      samples.push([Math.max(rect.left, 0) + visibleW * fx, Math.max(rect.top, 0) + visibleH * fy]);
    }
    const tops = samples.map(([sx, sy]) => document.elementFromPoint(sx, sy));
    const allCovered = tops.every((top) => top && top !== el && !el.contains(top) && !top.contains(el));
    if (allCovered) {
      const t = tops[0] as HTMLElement;
      covered = `${t.tagName.toLowerCase()}${typeof t.className === "string" && t.className ? "." + t.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
    }
  }
  return { index, name, scrollX: window.scrollX, scrollY: window.scrollY, clip, hidden, offscreen, covered };
}

/**
 * Decode two screenshots in the browser and count the pixels the focus state
 * changed that stand out by 3:1, either against what they replaced or against the
 * surrounding page (the clip's outer ring), which is what WCAG calls "adjacent colours".
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
      if (ratio(l1, l2) >= 3 || ratio(l1, around) >= 3) strong += 1;
    }
    return { strong, changed };
  }, [focused, unfocused] as const);
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
    const stop: Stop = { ...info, focused: null };
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
    else if (strong < 12) out.push(`${label}: focus indicator is below 3:1 on ${stop.name} (${strong}/${changed} px)`);
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
export async function keyboardProblems(page: Page, label: string, max = 160): Promise<Problems> {
  const helper = await page.context().newPage();
  try {
    const { stops, problems } = await collectStops(page, max);
    const out = problems.map((problem) => `${label}: ${problem}`);
    for (const stop of stops) {
      if (stop.offscreen) { out.push(`${label}: focus lands outside the viewport on ${stop.name}`); continue; }
      if (stop.covered) out.push(`${label}: ${stop.name} is covered by ${stop.covered} when focused`);
      if (!stop.clip || !stop.focused) continue;
      await page.evaluate(([x, y]) => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(x, y);
      }, [stop.scrollX, stop.scrollY] as const);
      const unfocused = (await page.screenshot({ clip: stop.clip })).toString("base64");
      const { strong, changed } = await changedPixels(helper, stop.focused, unfocused);
      const bad = changed === 0 ? "no visible focus indicator on" : strong < 12 ? "focus indicator is below 3:1 on" : null;
      if (bad) {
        out.push(`${label}: ${bad} ${stop.name}${changed ? ` (${strong}/${changed} px)` : ""}`);
        const dir = process.env.WCAG_DEBUG_DIR;
        if (dir) {
          const { mkdirSync, writeFileSync } = await import("node:fs");
          mkdirSync(dir, { recursive: true });
          const slug = `${label}-${stop.index}`.replace(/[^a-z0-9]+/gi, "_");
          writeFileSync(`${dir}/${slug}-focused.png`, Buffer.from(stop.focused, "base64"));
          writeFileSync(`${dir}/${slug}-plain.png`, Buffer.from(unfocused, "base64"));
        }
      }
    }
    return out;
  } finally {
    await helper.close();
  }
}
