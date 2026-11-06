import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const exec = promisify(execFile);
const HERE = import.meta.dirname;
export const RECORDINGS = path.resolve(HERE, "..");
const OVERLAY = readFileSync(path.join(HERE, "overlay.js"), "utf8");

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, scale: 1, mobile: false },
  mobile: {
    width: 393, height: 852, scale: 2, mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
};

/** Human pacing, in ms. */
const PACE = { afterAction: 700, afterNav: 1100, afterCaption: 900, keyDelay: 28 };

export class FlowFailure extends Error {}

class Cdp {
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error(`CDP connect failed: ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        this.onEvent?.(message);
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
      else waiter.resolve(message.result);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { this.ws.close(); }
}

/**
 * One recording. Every browser action goes through the agent-browser CLI; a held
 * CDP connection adds only what the CLI can't keep alive on its own: touch
 * emulation, an iPhone user agent, the overlay script and the fake clock.
 */
export class Take {
  constructor({ id, title, viewport, stack, outputDir, session }) {
    Object.assign(this, { id, title, viewport, stack, outputDir, session });
    this.vp = VIEWPORTS[viewport];
    this.isMobile = this.vp.mobile;
    this.steps = [];
    this.notes = [];
    this.started = 0;
    this.now = null;
    this.initScripts = [];
    this.lastMail = null;
  }

  // ── plumbing ──
  /**
   * Chrome sometimes opens a tab of its own (chrome://settings/help) over ours. A hidden
   * tab freezes the video and swallows clicks without an error, so take the front back.
   */
  async keepInFront() {
    if (!this.sessionId) return;
    const { result } = await this.page("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }).catch(() => ({ result: {} }));
    if (result?.value === "hidden") await this.page("Page.bringToFront").catch(() => {});
  }
  async ab(...args) {
    await this.keepInFront();
    try {
      const { stdout } = await exec("agent-browser", ["--session", this.session, ...args], { timeout: 45_000, maxBuffer: 1 << 24 });
      return stdout.trim();
    } catch (error) {
      const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || error.message;
      throw new FlowFailure(`agent-browser ${args.join(" ").slice(0, 160)} → ${detail.slice(0, 500)}`);
    }
  }
  async page(method, params = {}) { return this.cdp.send(method, params, this.sessionId); }

  async applyEmulation() {
    const { width, height, scale, mobile, ua } = this.vp;
    await this.page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile, screenWidth: width, screenHeight: height });
    if (mobile) {
      await this.page("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await this.page("Emulation.setUserAgentOverride", { userAgent: ua, platform: "iPhone" });
    }
  }

  /** Attach to the tab agent-browser is recording. */
  async attach() {
    const url = await this.ab("get", "cdp-url");
    this.cdp = await Cdp.connect(url);
    // Recording opens a fresh tab, so identify it by the marker title it was opened on.
    let targetInfos = [];
    let target;
    for (let attempt = 0; attempt < 30 && !target; attempt++) {
      ({ targetInfos } = await this.cdp.send("Target.getTargets"));
      target = targetInfos.find((item) => item.type === "page" && item.title === this.marker);
      if (!target) await this.pause(100);
    }
    if (!target) throw new FlowFailure(`Recording tab not found among ${targetInfos.map((item) => item.title || item.url).join(", ")}`);
    const { sessionId } = await this.cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    this.sessionId = sessionId;
    await this.page("Page.enable");
    await this.page("Network.enable");
    await this.page("Page.addScriptToEvaluateOnNewDocument", { source: OVERLAY });
    for (const source of this.initScripts) await this.page("Page.addScriptToEvaluateOnNewDocument", { source });
    await this.applyEmulation();
    await this.applyClock();
    await this.page("Runtime.evaluate", { expression: OVERLAY });
  }

  async start() {
    await exec("agent-browser", ["--session", this.session, "close"]).catch(() => {});
    mkdirSync(this.outputDir, { recursive: true });
    await this.ab("set", "viewport", String(this.vp.width), String(this.vp.height), String(this.vp.scale));
    await this.ab("open", "about:blank");
  }
  /**
   * `agent-browser record` stalls after a few frames on some runs, so the video is
   * taken straight from the tab agent-browser is driving: DevTools screencast
   * frames, resampled to a constant rate so the video keeps wall-clock time.
   */
  async record() {
    this.video = path.join(this.outputDir, `${this.id}.mp4`);
    rmSync(this.video, { force: true });
    this.marker = `flrec-${randomBytes(6).toString("hex")}`;
    await this.ab("eval", `document.title = ${JSON.stringify(this.marker)}`);
    await this.attach();
    const FPS = 15;
    this.encoder = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
      "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", this.video],
      { stdio: ["pipe", "ignore", "pipe"] });
    this.encoderErrors = "";
    this.encoder.stderr.on("data", (chunk) => { this.encoderErrors += chunk; });
    this.encoder.stdin.on("error", () => {});
    let latest = null;
    let written = 0;
    this.cdp.onEvent = (message) => {
      if (message.method !== "Page.screencastFrame" || message.sessionId !== this.sessionId) return;
      latest = Buffer.from(message.params.data, "base64");
      this.page("Page.screencastFrameAck", { sessionId: message.params.sessionId }).catch(() => {});
    };
    await this.page("Page.startScreencast", { format: "jpeg", quality: 82, everyNthFrame: 1, maxWidth: this.vp.width * this.vp.scale, maxHeight: this.vp.height * this.vp.scale });
    await this.page("Runtime.evaluate", { expression: `document.body && (document.body.style.background = "#fff")` });
    while (!latest) await this.pause(20);
    this.started = Date.now();
    this.frameTimer = setInterval(() => {
      const due = Math.floor(((Date.now() - this.started) / 1000) * FPS);
      while (written < due) {
        this.encoder.stdin.write(latest);
        written++;
      }
    }, 1000 / FPS);
  }
  async stop() {
    // Page problems the viewer should know about, whatever the flow's own outcome.
    this.consoleErrors = await this.ab("errors").catch(() => "");
    if (this.frameTimer) clearInterval(this.frameTimer);
    if (this.encoder) {
      await this.page("Page.stopScreencast").catch(() => {});
      const finished = new Promise((resolve) => this.encoder.on("close", resolve));
      this.encoder.stdin.end();
      const code = await finished;
      if (code !== 0) throw new FlowFailure(`ffmpeg exited ${code}: ${this.encoderErrors.slice(0, 300)}`);
    }
    this.cdp?.close();
    await exec("agent-browser", ["--session", this.session, "close"]).catch(() => {});
  }

  // ── what a flow script calls ──
  note(text) { this.notes.push(text); }

  /** Add a script before any page script runs. Call before the first `open`. */
  async initScript(source) {
    this.initScripts.push(source);
    if (this.sessionId) await this.page("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  /** Caption the next stretch of video, and add it to the page's seekable step list. */
  async say(message, { hold = 3200 } = {}) {
    this.steps.push({ t: (Date.now() - this.started) / 1000, text: message });
    await this.overlay(message, hold);
    await this.pause(PACE.afterCaption);
  }
  async overlay(message, hold) {
    await this.page("Runtime.evaluate", {
      expression: `window.__flrec && window.__flrec.caption(${JSON.stringify(this.id)}, ${JSON.stringify(message)}, ${hold})`,
    });
  }
  async pause(ms = PACE.afterAction) { await new Promise((resolve) => setTimeout(resolve, ms)); }

  url(pathOrUrl) { return /^https?:/.test(pathOrUrl) ? pathOrUrl : `${this.stack.app}${pathOrUrl}`; }
  async open(pathOrUrl) {
    await this.ab("open", this.url(pathOrUrl));
    await this.pause(PACE.afterNav);
  }
  async reload() { await this.ab("reload"); await this.pause(PACE.afterNav); }
  async back() { await this.ab("back"); await this.pause(PACE.afterNav); }
  currentUrl() { return this.ab("get", "url"); }

  /**
   * Click by role + accessible name via the accessibility snapshot. (`find role link`
   * misses plain anchors, so this reads refs instead.) `name` matches as a
   * case-insensitive substring, or exactly with { exact: true }; `nth` picks among repeats.
   * Retries while the element appears.
   */
  async clickRole(role, name, { exact = false, nth = 0, timeout = 8_000 } = {}) {
    const want = name.toLowerCase();
    const deadline = Date.now() + timeout;
    let seen = [];
    while (true) {
      const tree = await this.ab("snapshot", "-i");
      seen = [...tree.matchAll(/^\s*- (\S+) "((?:[^"\\]|\\.)*)"[^\n]*\[[^\]]*ref=(e\d+)/gm)]
        .map(([, r, label, ref]) => ({ role: r, label: label.replace(/\\"/g, '"'), ref }));
      const hits = seen.filter((item) => item.role === role &&
        (exact ? item.label.toLowerCase() === want : item.label.toLowerCase().includes(want)));
      if (hits[nth]) {
        await this.ab("scrollintoview", `@${hits[nth].ref}`).catch(() => {});
        await this.settle();
        await this.ab("click", `@${hits[nth].ref}`);
        await this.pause();
        return;
      }
      if (Date.now() >= deadline) break;
      await this.pause(250);
    }
    throw new FlowFailure(`No ${role} named "${name}" (nth ${nth}) at ${await this.currentUrl()}. On screen: ${seen.map((item) => `${item.role} "${item.label}"`).join("; ").slice(0, 600)}`);
  }
  button(name, options) { return this.clickRole("button", name, options); }
  link(name, options) { return this.clickRole("link", name, options); }
  async clickText(text, { exact = false } = {}) {
    await this.ab("find", "text", text, "click", ...(exact ? ["--exact"] : []));
    await this.pause();
  }
  /** Wait for a smooth scroll to end: a click during one lands on whatever has moved under the old coordinates. */
  async settle() {
    await this.pause(150);
    let last = null;
    for (let i = 0; i < 25; i++) {
      const y = await this.eval(`scrollY`);
      if (y === last) break;
      last = y;
      await this.pause(120);
    }
  }
  /** Click via CSS selector. Prefer button()/link() when an accessible name exists. */
  async click(selector) {
    await this.ab("scrollintoview", selector).catch(() => {});
    await this.settle();
    await this.ab("click", selector);
    await this.pause();
  }
  async tapAt(x, y) {
    await this.ab("mouse", "move", String(Math.round(x)), String(Math.round(y)));
    await this.ab("mouse", "down");
    await this.ab("mouse", "up");
  }
  async fill(selector, text) {
    await this.ab("scrollintoview", selector).catch(() => {});
    await this.settle();
    await this.ab("click", selector);
    await this.typeKeys(text);
  }
  async fillLabel(label, text) {
    await this.bringFieldIntoView("label", label);
    await this.ab("find", "label", label, "click");
    await this.selectAllAndClear();
    await this.typeKeys(text);
  }
  async fillPlaceholder(placeholder, text) {
    await this.bringFieldIntoView("placeholder", placeholder);
    await this.ab("find", "placeholder", placeholder, "click");
    await this.selectAllAndClear();
    await this.typeKeys(text);
  }
  /** `find ... click` clicks where the element is without scrolling, so a field below the fold silently gets nothing. */
  async bringFieldIntoView(by, value) {
    await this.eval(`(() => {
      const want = ${JSON.stringify(value.toLowerCase())};
      const has = (text) => (text ?? "").toLowerCase().includes(want);
      const field = ${JSON.stringify(by)} === "placeholder"
        ? [...document.querySelectorAll("input, textarea")].find((el) => has(el.placeholder))
        : [...document.querySelectorAll("label")].find((el) => has(el.innerText))?.control
          ?? [...document.querySelectorAll("[aria-label]")].find((el) => has(el.getAttribute("aria-label")));
      field?.scrollIntoView({ block: "center" });
    })()`);
    await this.settle();
  }
  async selectAllAndClear() {
    await this.ab("press", "Meta+a").catch(() => {});
    // Meta+a does nothing on some platforms, so select the field's contents directly too.
    await this.eval(`document.activeElement?.select?.()`).catch(() => {});
    await this.ab("press", "Backspace").catch(() => {});
  }
  /** Real keystrokes at a readable speed, into whatever has focus. */
  async typeKeys(text) {
    await this.ab("keyboard", "type", text);
    await this.pause(450);
  }
  async press(key) { await this.ab("press", key); await this.pause(); }
  async select(selector, value) { await this.ab("select", selector, value); await this.pause(); }
  async check(selector) { await this.ab("check", selector); await this.pause(); }
  async upload(selector, ...files) {
    await this.ab("upload", selector, ...files.map((file) => (path.isAbsolute(file) ? file : path.join(RECORDINGS, "fixtures", file))));
    await this.pause(1200);
  }
  /** The app's custom Picker: trigger labelled "Day: Friday", then the option. */
  async pick(triggerLabel, option) {
    const find = `[...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(${JSON.stringify(triggerLabel + ":")}))`;
    const present = await this.eval(`(() => { const el = ${find}; if (!el) return false; el.scrollIntoView({ block: "center" }); return true; })()`);
    if (!present) throw new FlowFailure(`No picker labelled "${triggerLabel}"`);
    await this.settle();
    const hit = await this.eval(`(() => { const r = (${find}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await this.tapAt(hit.x, hit.y);
    await this.pause(500);
    await this.clickRole("option", option, { exact: true });
  }
  async eval(expression) {
    const result = await this.page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new FlowFailure(`eval failed: ${result.exceptionDetails.text}`);
    return result.result.value;
  }

  /** Assert that text is on screen. Fails the take if it never shows. */
  async see(text, { timeout = 10_000, hold = 900 } = {}) {
    const deadline = Date.now() + timeout;
    const expression = `(() => { const t = ${JSON.stringify(text)}; const walker = document.body && document.body.innerText; return Boolean(walker && walker.toLowerCase().includes(t.toLowerCase())); })()`;
    while (Date.now() < deadline) {
      if (await this.eval(expression)) {
        await this.reveal(text);
        await this.pause(hold);
        return;
      }
      await this.pause(150);
    }
    const here = await this.currentUrl();
    throw new FlowFailure(`Never saw "${text}" at ${here}`);
  }
  async dontSee(text, { hold = 500 } = {}) {
    const found = await this.eval(`Boolean(document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())}))`);
    if (found) throw new FlowFailure(`Expected not to see "${text}" at ${await this.currentUrl()}`);
    await this.pause(hold);
  }
  async expectUrl(pattern, { timeout = 10_000 } = {}) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
    const deadline = Date.now() + timeout;
    let here = "";
    while (Date.now() < deadline) {
      here = await this.currentUrl();
      if (regex.test(here)) return here;
      await this.pause(150);
    }
    throw new FlowFailure(`URL never matched ${regex}: ${here}`);
  }
  /** Scroll an on-screen string into the middle of the viewport, smoothly. */
  async reveal(text) {
    await this.eval(`(() => {
      const t = ${JSON.stringify(text.toLowerCase())};
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        if (walker.currentNode.textContent.toLowerCase().includes(t) && parent && parent.offsetParent !== null) {
          const r = parent.getBoundingClientRect();
          if (r.top < 60 || r.bottom > innerHeight - 90) parent.scrollIntoView({ behavior: "smooth", block: "center" });
          return true;
        }
      }
      return false;
    })()`);
    await this.pause(450);
  }
  /** Scroll by finger on mobile, by wheel on desktop. */
  async scroll(distance = 500) {
    if (this.isMobile) {
      await this.page("Input.synthesizeScrollGesture", {
        x: Math.round(this.vp.width / 2), y: Math.round(this.vp.height * 0.6), yDistance: -distance, gestureSourceType: "touch", speed: 900,
      });
    } else {
      await this.page("Input.synthesizeScrollGesture", {
        x: Math.round(this.vp.width / 2), y: Math.round(this.vp.height / 2), yDistance: -distance, gestureSourceType: "mouse", speed: 1400,
      });
    }
    await this.pause(500);
  }
  /** Slowly pan through a whole page so the viewer sees everything on it. */
  async tour({ step = 0.75, dwell = 700, max = 14 } = {}) {
    const distance = Math.round(this.vp.height * step);
    for (let i = 0; i < max; i++) {
      const done = await this.eval(`scrollY + innerHeight >= document.documentElement.scrollHeight - 4`);
      if (done) break;
      await this.scroll(distance);
      await this.pause(dwell);
    }
    await this.pause(dwell);
  }
  async toTop() {
    await this.eval(`scrollTo({ top: 0, behavior: "smooth" })`);
    await this.pause(500);
  }

  // ── the clock ──
  /** Pin the server (x-e2e-now) and the page's Date to one instant; null releases. */
  async clock(at) {
    this.now = at;
    if (this.sessionId) await this.applyClock();
  }
  async applyClock() {
    const headers = this.now ? { "x-e2e-now": this.now.toISOString() } : {};
    await this.page("Network.setExtraHTTPHeaders", { headers });
    if (this.clockScript) {
      await this.page("Page.removeScriptToEvaluateOnNewDocument", { identifier: this.clockScript }).catch(() => {});
      this.clockScript = null;
    }
    if (this.now) {
      const { identifier } = await this.page("Page.addScriptToEvaluateOnNewDocument", { source: freezeDateSource(this.now, this.stack.mailpit) });
      this.clockScript = identifier;
    }
  }

  // ── people ──
  /** Switch person off camera: a real session row, the same cookie sign-in sets. */
  async signInAs(email, { expiresIn = 25 * 86_400_000, name } = {}) {
    await this.page("Network.clearBrowserCookies");
    if (email === null) return;
    const token = randomBytes(32).toString("base64url");
    const sql = postgres(this.stack.databaseUrl, { prepare: false, max: 1 });
    const lower = email.toLowerCase();
    const [user] = await sql`insert into users (email${name ? sql`, name` : sql``}) values (${lower}${name ? sql`, ${name}` : sql``})
      on conflict (email) do update set email = excluded.email returning id`;
    const base = this.now ?? new Date();
    // Real sign-in claims the memberships waiting on this address; without this the loop 404s.
    await sql`update memberships set user_id = ${user.id}, accepted_at = coalesce(accepted_at, ${base}) where lower(email) = ${lower} and user_id is null`;
    await sql`insert into sessions (user_id, token_hash, expires_at) values (${user.id}, ${createHash("sha256").update(token).digest("base64url")}, ${new Date(base.getTime() + expiresIn)})`;
    await sql.end({ timeout: 5 });
    await this.page("Network.setCookie", {
      name: "fl_session", value: token, url: this.stack.app, httpOnly: true, sameSite: "Lax", path: "/",
      expires: Math.floor(Date.now() / 1000) + 30 * 86_400,
    });
  }
  async signOutOffCamera() { await this.page("Network.clearBrowserCookies"); }

  /** The real path, on camera: form → Mailpit → link → confirm. */
  async signInByMail(email) {
    await this.open("/signin");
    await this.fillLabel("Your email", email);
    await this.button("Email me a link");
    await this.expectUrl(/\/signin\/check-email$/);
    await this.openMail({ to: email });
    await this.followMailLink("/signin/confirm");
    await this.button("Sign in");
    await this.expectUrl(/\/you$/);
    await this.pause();
  }

  // ── mail ──
  async mailSearch({ to, subject } = {}) {
    const parts = [];
    if (to) parts.push(`to:"${to}"`);
    if (subject) parts.push(`subject:"${subject}"`);
    const query = parts.join(" ");
    const response = await fetch(`${this.stack.mailpit}/api/v1/${query ? `search?query=${encodeURIComponent(query)}` : "messages"}`);
    return (await response.json()).messages ?? [];
  }
  async waitForMail(filter = {}, { timeout = 10_000, count = 1 } = {}) {
    const deadline = Date.now() + timeout;
    let found = [];
    while (Date.now() < deadline) {
      found = await this.mailSearch(filter);
      if (found.length >= count) return found;
      await this.pause(150);
    }
    throw new FlowFailure(`Mailpit never received ${count} message(s) for ${JSON.stringify(filter)}; had ${found.length}`);
  }
  /** Show the real inbox then the real email in Mailpit. */
  async openMail(filter = {}, { inbox = true } = {}) {
    const [message] = await this.waitForMail(filter);
    if (inbox) {
      await this.open(`${this.stack.mailpit}/`);
      await this.pause(1000);
    }
    await this.open(`${this.stack.mailpit}/view/${message.ID}`);
    const full = await (await fetch(`${this.stack.mailpit}/api/v1/message/${message.ID}`)).json();
    this.lastMail = full;
    await this.pause(1400);
    return full;
  }
  /** Follow a link from the email just opened: the address that email really carried. */
  mailLink(pathFragment) {
    const html = this.lastMail?.HTML ?? "";
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
    const href = hrefs.find((candidate) => candidate.includes(pathFragment));
    if (!href) throw new FlowFailure(`The email has no link containing ${pathFragment}. Links: ${hrefs.join(", ").slice(0, 400)}`);
    return href;
  }
  async followMailLink(pathFragment) {
    const href = this.mailLink(pathFragment);
    await this.open(href);
    return href;
  }
  async mailCount(filter = {}) { return (await this.mailSearch(filter)).length; }
  async mailBodyContains(filter, needle) {
    const [message] = await this.waitForMail(filter);
    const full = await (await fetch(`${this.stack.mailpit}/api/v1/message/${message.ID}`)).json();
    if (!full.HTML.includes(needle) && !(full.Text ?? "").includes(needle)) throw new FlowFailure(`Email lacks "${needle}"`);
  }

  // ── things with no pixels of their own ──
  /** Run the scheduled sweep as if it were `at`, and put its report on screen. */
  async sweep(at, { show = true } = {}) {
    const response = await fetch(`${this.stack.app}/api/cron/sweep`, {
      headers: { authorization: "Bearer rec-cron-secret", "x-e2e-now": at.toISOString(), "x-e2e-email-transport": "resend" },
    });
    const body = await response.json();
    if (show) await this.panel(`Cron sweep at ${at.toISOString().slice(0, 16)}Z`, `HTTP ${response.status}\n${JSON.stringify(body, null, 1)}`);
    return body;
  }
  /** A clearly-labelled card for backend behaviour a screen can't show. */
  async panel(title, body, { hold = 3500 } = {}) {
    await this.eval(`(() => {
      const box = document.createElement("div");
      box.setAttribute("data-flrec-panel", "");
      Object.assign(box.style, { position: "fixed", inset: "auto 12px 12px auto", maxWidth: "min(560px, calc(100vw - 24px))", maxHeight: "60vh", overflow: "auto",
        background: "#101018", color: "#d7ffe0", font: "13px/1.45 ui-monospace, Menlo, monospace", padding: "12px 14px", borderRadius: "10px", border: "1px solid #ffd166", zIndex: 2147483646, whiteSpace: "pre-wrap", pointerEvents: "none" });
      const head = document.createElement("div"); head.textContent = "BACKEND · " + ${JSON.stringify(title)};
      Object.assign(head.style, { color: "#ffd166", fontWeight: "700", marginBottom: "6px" });
      const text = document.createElement("div"); text.textContent = ${JSON.stringify(body)};
      box.append(head, text); document.documentElement.append(box);
      setTimeout(() => box.remove(), ${hold});
    })()`);
    await this.pause(hold);
  }
  /** A request made outside the page, with its response shown on screen. */
  async request(method, pathOrUrl, { body, headers = {}, show = true, title } = {}) {
    const response = await fetch(this.url(pathOrUrl), {
      method, redirect: "manual",
      headers: { ...(body && typeof body !== "string" ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    if (show) await this.panel(title ?? `${method} ${pathOrUrl}`, `HTTP ${response.status}\n${text.slice(0, 400)}`);
    return { status: response.status, text };
  }
  /** Direct database read, for confirming an invisible result. */
  async sql(text, params = []) {
    const sql = postgres(this.stack.databaseUrl, { prepare: false, max: 1 });
    const rows = await sql.unsafe(text, params);
    await sql.end({ timeout: 5 });
    return rows;
  }
  check_(condition, message) { if (!condition) throw new FlowFailure(message); }
}

function freezeDateSource(at, mailpit) {
  const fixed = at.getTime();
  return `(() => {
    if (location.origin === ${JSON.stringify(mailpit)}) return; // Mailpit keeps real time.
    const Real = Date;
    class FrozenDate extends Real {
      constructor(...args) { if (args.length === 0) super(${fixed}); else super(...args); }
      static now() { return ${fixed}; }
    }
    window.Date = FrozenDate;
  })();`;
}

export function stackFor(shard) {
  return {
    shard,
    app: `http://localhost:${3190 + shard}`,
    mailpit: `http://127.0.0.1:${8190 + shard}`,
    databaseUrl: `postgresql://postgres@127.0.0.1:55490/friendloop_rec_${shard}`,
  };
}
export { existsSync, writeFileSync };
