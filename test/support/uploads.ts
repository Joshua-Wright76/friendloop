import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";

export const UPLOADS = path.join(process.cwd(), "public", "uploads");

/** Where a local `/uploads/...` URL lives on disk. */
export const onDisk = (url: string) => path.join(UPLOADS, url.split("/").at(-1)!);

/**
 * Make one local upload refuse to leave by putting a directory where its file
 * was: `unlink` fails on a directory (EISDIR on Linux, EPERM on macOS), so the
 * app's cleanup takes its error path for that one file.
 *
 * Don't take the write bit off the uploads directory itself. The integration
 * files run in parallel processes that all write there, and a read-only
 * directory makes their photo uploads fail with a 500.
 *
 * Returns `release`, which puts the path back to empty; it also runs after the test.
 */
export async function makeUndeletable(t: TestContext, url: string): Promise<() => Promise<void>> {
  const target = onDisk(url);
  const release = () => rm(target, { recursive: true, force: true });
  await release();
  await mkdir(target, { recursive: true });
  t.after(release);
  return release;
}
