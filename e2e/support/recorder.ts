import { expect, type Page } from "@playwright/test";

/**
 * Headless Chromium has no microphone here — getUserMedia pends forever even
 * with the fake-device flags — so, like the outbox replaces the mail provider,
 * these specs replace the capture layer with an in-page double that resolves
 * getUserMedia immediately and emits real webm bytes. Everything past the
 * recording itself (upload, storage, snapshot, email) runs for real.
 */
const FAKE_RECORDER_SCRIPT = `
  const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00,
    ...new Array(1200).fill(0)]);
  class FakeRecorder {
    constructor(stream) {
      this.stream = stream;
      this.chunks = [];
      this.mimeType = "audio/webm;codecs=opus";
      this.state = "inactive";
      this.ondataavailable = null;
      this.onstop = null;
    }
    static isTypeSupported(candidate) {
      return candidate === "audio/webm" || candidate === "audio/webm;codecs=opus";
    }
    start() {
      this.state = "recording";
    }
    stop() {
      if (this.state === "inactive") return;
      this.state = "inactive";
      if (this.ondataavailable) this.ondataavailable({ data: new Blob([WEBM_BYTES], { type: "audio/webm" }) });
      if (this.onstop) this.onstop();
    }
  }
  Object.defineProperty(window, "MediaRecorder", { value: FakeRecorder, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: () => Promise.resolve(new MediaStream()) },
    configurable: true,
  });
`;

/** Install the capture double before any app script runs. */
export async function installFakeRecorder(page: Page): Promise<void> {
  await page.addInitScript(FAKE_RECORDER_SCRIPT);
}

/** Record a short note on the first question's card. */
export async function recordOnFirstQuestion(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Record a voice note" }).first().click();
  await expect(page.getByText(/Recording… 0:0/)).toBeVisible();
  await page.getByRole("button", { name: "Stop recording" }).click();
}

export { expect };
