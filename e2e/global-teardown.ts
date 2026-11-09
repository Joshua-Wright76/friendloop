import { stopFakeResendRemotely } from "./support/fake-resend";

export default async function globalTeardown() {
  // Nothing was started for a deployed probe run (see global-setup.ts).
  if (process.env.E2E_BASE_URL) return;

  await stopFakeResendRemotely();
}
