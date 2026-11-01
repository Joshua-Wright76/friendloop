/**
 * The hook that makes `src/lib` testable under `node --test`.
 *
 * Two jobs:
 *   1. `@/…` resolves the way `tsconfig.json` paths do, with the extensionless
 *      imports the Next bundler accepts but Node does not.
 *   2. `next/headers`, `next/cache`, `next/navigation`, and `next/server` map to
 *      stubs, so request-scoped library code runs outside a server.
 *
 * Imported with `--import ./test/register.mjs` before the test files load, so the
 * resolve hook is installed before anything imports a library module.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

const STUBS = new Map([
  ["next/headers", path.join(ROOT, "test", "stubs", "next-headers.mjs")],
  ["next/cache", path.join(ROOT, "test", "stubs", "next-cache.mjs")],
  ["next/navigation", path.join(ROOT, "test", "stubs", "next-navigation.mjs")],
  ["next/server", path.join(ROOT, "test", "stubs", "next-server.mjs")],
  ["@vercel/blob", path.join(ROOT, "test", "stubs", "vercel-blob.mjs")],
  ["@vercel/blob/client", path.join(ROOT, "test", "stubs", "vercel-blob-client.mjs")],
]);

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolve a path without extension, the way the bundler would. */
function resolvePath(base) {
  if (existsSync(base) && path.extname(base)) return base;
  return (
    firstExisting([`${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`]) ??
    firstExisting([path.join(base, "index.ts"), path.join(base, "index.tsx")]) ??
    null
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = STUBS.get(specifier);
    if (stub) return { url: pathToFileURL(stub).href, shortCircuit: true };

    if (specifier.startsWith("@/")) {
      const resolved = resolvePath(path.join(SRC, specifier.slice(2)));
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    // Extensionless relative import (`./auth`, `../db/schema`).
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !path.extname(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      const base = path.resolve(path.dirname(new URL(context.parentURL).pathname), specifier);
      const resolved = resolvePath(base);
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }

    return nextResolve(specifier, context);
  },
});
