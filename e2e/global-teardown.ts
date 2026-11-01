import { stopFakeResendRemotely } from "./support/fake-resend";

export default async function globalTeardown() {
  await stopFakeResendRemotely();
}
