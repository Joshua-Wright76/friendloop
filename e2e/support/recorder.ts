import { expect, type Page } from "@playwright/test";
import { copy, copyPattern } from "@/lib/copy";
import { showAttachments } from "./harness";

/**
 * Headless browsers have no microphone here (getUserMedia pends forever even
 * with Chromium's fake-device flags), so, like the outbox replaces the mail
 * provider, these specs replace the capture layer with an in-page double that
 * resolves getUserMedia immediately and emits real bytes. It records what that
 * browser's own MediaRecorder would: webm in Chromium, mp4 in Safari. Everything
 * past the recording itself (upload, storage, snapshot, email) runs for real.
 */
function fakeRecorder(format: "webm" | "mp4"): void {
  const header = format === "mp4"
    // An ISO base media box: size, then the "ftyp" brand Safari writes.
    ? [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]
    : [0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00];
  const bytes = new Uint8Array([...header, ...new Array(1200).fill(0)]);
  const supported = format === "mp4" ? ["audio/mp4"] : ["audio/webm", "audio/webm;codecs=opus"];
  class FakeRecorder {
    mimeType = format === "mp4" ? "audio/mp4" : "audio/webm;codecs=opus";
    state = "inactive";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(readonly stream: MediaStream) {}
    static isTypeSupported(candidate: string) {
      return supported.includes(candidate);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob([bytes], { type: supported[0] }) });
      this.onstop?.();
    }
  }
  Object.defineProperty(window, "MediaRecorder", { value: FakeRecorder, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: () => Promise.resolve(new MediaStream()) },
    configurable: true,
  });
}

/** Install the capture double before any app script runs. */
export async function installFakeRecorder(page: Page): Promise<void> {
  const browser = page.context().browser()?.browserType().name();
  const format: "webm" | "mp4" = browser === "webkit" ? "mp4" : "webm";
  await page.addInitScript(fakeRecorder, format);
}

/** Record a short note on the first question's card. */
export async function recordOnFirstQuestion(page: Page): Promise<void> {
  await showAttachments(page);
  await page.getByRole("button", { name: copy.reply.voiceRecord }).first().click();
  await expect(page.getByText(copyPattern(copy.reply.voiceRecording, { values: { elapsed: "0:0" } }))).toBeVisible();
  await page.getByRole("button", { name: copy.reply.voiceStop }).click();
}

export { expect };
