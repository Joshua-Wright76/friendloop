/** The same capture double the e2e suite uses: headless Chrome has no microphone. */
export const FAKE_RECORDER = String.raw`
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
