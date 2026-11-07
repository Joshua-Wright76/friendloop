/**
 * Runs inside every document before the app does, and times what a person sees.
 *
 * The clock starts at the input event's own timestamp (or the document's navigation
 * start for a page load) and stops on the frame after the expected content is on
 * screen, so Playwright's own overhead is never part of a number. State lives in
 * sessionStorage so a measurement survives a cross-document navigation.
 */
export type DoneSpec = {
  /** CSS selector for what the person is waiting to see. */
  selector: string;
  /** The element's text must include this. */
  text?: string;
  /** The location (pathname + search) must match this regular expression. */
  path?: string;
  /** Done when nothing matches any more: a sheet closing, a row leaving. */
  gone?: boolean;
};

export type ProbeResult = {
  t0: number | null;
  feedback: number | null;
  done: number | null;
  interactive: number | null;
  timeOrigin: number;
  fcp: number | null;
  lcp: number | null;
  cls: number;
  longTaskMs: number;
};

type State = {
  spec: DoneSpec;
  t0: number | null;
  feedback: number | null;
  done: number | null;
  interactive: number | null;
  pageLoad: boolean;
};

export function probe(coldSpec: DoneSpec | null) {
  type W = typeof window & { __perf?: unknown };
  if ((window as W).__perf) return;

  // In here, not beside the function: only this function's source reaches the page.
  const KEY = "__perf_lab";
  const now = () => performance.timeOrigin + performance.now();
  const load = (): State | null => {
    try { return JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { return null; }
  };
  const save = () => {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* about:blank */ }
  };

  let state: State | null = coldSpec
    ? { spec: coldSpec, t0: performance.timeOrigin, feedback: null, done: null, interactive: null, pageLoad: true }
    : load();
  let matched: Element | null = null;
  let fcp: number | null = null;
  let lcp: number | null = null;
  let cls = 0;
  let longTaskMs = 0;

  const observe = (type: string, onEntry: (entry: PerformanceEntry) => void) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true });
    } catch { /* unsupported entry type */ }
  };
  observe("paint", (entry) => { if (entry.name === "first-contentful-paint") fcp = entry.startTime; });
  observe("largest-contentful-paint", (entry) => { lcp = entry.startTime; });
  observe("layout-shift", (entry) => {
    const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (!shift.hadRecentInput) cls += shift.value;
  });
  observe("longtask", (entry) => {
    const at = performance.timeOrigin + entry.startTime;
    if (state?.t0 && at >= state.t0) longTaskMs += Math.max(0, entry.duration - 50);
  });

  const visible = (element: Element) =>
    element.checkVisibility ? element.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : true;

  // Set while the content is in the page but its opacity is still 0: the first frame of a fade-in.
  // No DOM mutation announces the next frame, so `tick` has to keep looking for itself.
  let fadingIn = false;
  const find = (spec: DoneSpec): Element | null => {
    let elements: Element[];
    try { elements = Array.from(document.querySelectorAll(spec.selector)); } catch { return null; }
    const candidates = elements.filter((element) => !spec.text || (element.textContent ?? "").includes(spec.text));
    const found = candidates.find(visible) ?? null;
    fadingIn = !found && candidates.some((element) => element.checkVisibility?.({ visibilityProperty: true }));
    return found;
  };
  const matches = (spec: DoneSpec) => {
    if (spec.path && !new RegExp(spec.path).test(location.pathname + location.search)) return false;
    if (!document.documentElement) return false;
    matched = find(spec);
    return spec.gone ? !matched : Boolean(matched);
  };
  const hydrated = (element: Element | null) =>
    Boolean(element && Object.keys(element).some((key) => key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")));

  /** After this frame has been handed to the compositor, not merely scheduled. */
  const afterPaint = (stamp: (at: number) => void) => {
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => stamp(now());
      channel.port2.postMessage(0);
    });
  };

  let dirty = true;
  const tick = () => {
    if (state && state.t0 !== null) {
      if (state.done === null && dirty) {
        dirty = false;
        const hit = matches(state.spec);
        if (fadingIn) dirty = true;
        if (hit) {
          afterPaint((at) => {
            if (state && state.done === null) { state.done = at; save(); }
          });
        }
      }
      if (state.done !== null && state.interactive === null) {
        // A client update is interactive when it appears; a page load, once hydrated.
        if (!state.pageLoad || state.spec.gone) state.interactive = state.done;
        else {
          matched = find(state.spec);
          if (hydrated(matched)) { state.interactive = now(); save(); }
        }
      }
    }
    requestAnimationFrame(tick);
  };
  new MutationObserver(() => { dirty = true; }).observe(document, {
    subtree: true, childList: true, characterData: true, attributes: true,
  });
  setInterval(() => { dirty = true; }, 100);
  requestAnimationFrame(tick);

  const begin = (event?: Event) => {
    if (!state || state.t0 !== null) return;
    state.t0 = event ? performance.timeOrigin + event.timeStamp : now();
    dirty = true;
    save();
    afterPaint((at) => {
      if (state && state.feedback === null) { state.feedback = at; save(); }
    });
  };
  for (const name of ["pointerdown", "keydown", "change"]) {
    window.addEventListener(name, begin, { capture: true, passive: true });
  }

  (window as W).__perf = {
    arm(spec: DoneSpec, pageLoad: boolean) {
      state = { spec, t0: null, feedback: null, done: null, interactive: null, pageLoad };
      longTaskMs = 0;
      save();
    },
    /** For a gesture with no input event of its own. */
    start() { begin(); },
    /** Would `done` already hold? Then whatever the clock said afterwards would mean nothing. */
    alreadyDone() { return state ? matches(state.spec) : false; },
    result() {
      return {
        t0: state?.t0 ?? null,
        feedback: state?.feedback ?? null,
        done: state?.done ?? null,
        interactive: state?.interactive ?? null,
        timeOrigin: performance.timeOrigin,
        fcp, lcp, cls, longTaskMs,
      };
    },
  };
  if (coldSpec) save();
}
