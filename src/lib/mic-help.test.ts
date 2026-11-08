import { test } from "node:test";
import assert from "node:assert/strict";
import { micHelp, micPlatform } from "./mic-help.ts";

const UA = {
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 400.0.0.0",
  ipadFirefox: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
};

test("an iPhone browser that names itself is the app whose switch is in Settings", () => {
  assert.deepEqual(micPlatform(UA.iphoneChrome), { kind: "ios", device: "iPhone", app: "Chrome", safari: false });
  assert.deepEqual(micPlatform(UA.iphoneInstagram), { kind: "ios", device: "iPhone", app: "Instagram", safari: false });
  assert.deepEqual(micPlatform(UA.ipadFirefox), { kind: "ios", device: "iPad", app: "Firefox", safari: false });
  assert.deepEqual(micPlatform(UA.iphoneSafari), { kind: "ios", device: "iPhone", app: "Safari", safari: true });
});

test("an iPad asking for the desktop site still counts as an iPad, but a Mac doesn't", () => {
  assert.deepEqual(micPlatform(UA.macSafari, 5), { kind: "ios", device: "iPad", app: "Safari", safari: true });
  assert.deepEqual(micPlatform(UA.macSafari), { kind: "mac-safari" });
  assert.deepEqual(micPlatform(UA.macChrome), { kind: "desktop" });
  assert.deepEqual(micPlatform(UA.android), { kind: "android" });
  assert.deepEqual(micPlatform(UA.windows), { kind: "desktop" });
});

test("Chrome on an iPhone is walked to Settings, Apps, Chrome, Microphone", () => {
  const help = micHelp({ userAgent: UA.iphoneChrome, host: "friendloop.dev" });
  assert.match(help.intro, /Chrome on this iPhone/);
  assert.deepEqual(help.steps.map((step) => step.screen.kind), ["home", "list", "list", "toggle", "retry"]);
  assert.deepEqual(help.steps[2].screen, { kind: "list", title: "Apps", target: "Chrome", back: true });
  assert.match(help.steps[2].text, /Find Chrome/);
  assert.deepEqual(help.steps[3].screen, { kind: "toggle", title: "Chrome", target: "Microphone" });
  assert.match(help.note ?? "", /Chrome/);
});

test("Safari on an iPhone ends on the website setting, set to Allow", () => {
  const help = micHelp({ userAgent: UA.iphoneSafari, host: "friendloop.dev" });
  assert.deepEqual(help.steps.map((step) => step.screen.kind), ["home", "list", "list", "list", "choice", "retry"]);
  assert.deepEqual(help.steps[4].screen, { kind: "choice", title: "Microphone", options: ["Ask", "Deny", "Allow"], pick: 2 });
  assert.match(help.note ?? "", /Website Settings/);
});

test("Safari on a Mac uses its menu for this site", () => {
  const help = micHelp({ userAgent: UA.macSafari, host: "friendloop.dev" });
  assert.deepEqual(help.steps[0].screen, { kind: "list", title: "Safari", target: "Settings for friendloop.dev…" });
  assert.match(help.steps[0].text, /Settings for friendloop\.dev/);
  assert.equal(help.steps.at(-1)?.screen.kind, "retry");
  assert.equal(help.note, undefined);
});

test("Android and desktop browsers start from the icon beside the address", () => {
  const android = micHelp({ userAgent: UA.android, host: "friendloop.dev" });
  assert.deepEqual(android.steps.map((step) => step.screen.kind), ["address", "list", "toggle", "retry"]);
  assert.deepEqual(android.steps[0].screen, { kind: "address", host: "friendloop.dev" });

  const desktop = micHelp({ userAgent: UA.windows, host: "dev.friendloop.dev" });
  assert.deepEqual(desktop.steps.map((step) => step.screen.kind), ["address", "toggle", "retry"]);
  assert.deepEqual(desktop.steps[1].screen, { kind: "toggle", title: "dev.friendloop.dev", target: "Microphone" });
});
