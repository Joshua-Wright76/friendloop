/**
 * Module state for the Next request APIs, so a database-backed unit test can be
 * a request.
 *
 * The library code reads `headers()`, `cookies()`, `notFound()`, and
 * `cacheLife()` out of `next/*`; outside a Next server those throw. Stubbing them
 * here keeps the code under test exactly as it ships while the test plays the
 * part of the framework.
 */
const headerStore = new Map();
const cookieJar = new Map();
let broken = false;

/** Make `headers()` throw, the way it does outside a request scope. */
export function setRequestBroken(value) {
  broken = Boolean(value);
}

export function setRequestHeaders(values) {
  headerStore.clear();
  for (const [name, value] of Object.entries(values ?? {})) {
    headerStore.set(name.toLowerCase(), String(value));
  }
}

export function setRequestCookies(values) {
  cookieJar.clear();
  for (const [name, value] of Object.entries(values ?? {})) cookieJar.set(name, String(value));
}

export function cookieEntries() {
  return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
}

export function clearRequest() {
  headerStore.clear();
  cookieJar.clear();
}

export async function headers() {
  if (broken) throw new Error("headers() was called outside a request scope");
  return {
    get(name) {
      return headerStore.get(name.toLowerCase()) ?? null;
    },
  };
}

function jar() {
  return {
    get(name) {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll(name) {
      const value = cookieJar.get(name);
      return value === undefined ? [] : [{ name, value }];
    },
    has(name) {
      return cookieJar.has(name);
    },
    set(name, value, options = {}) {
      // A real jar deletes on an expired date; `maxAge: 0` is the same intent.
      if (options.maxAge === 0 || options.expires === 0) {
        cookieJar.delete(name);
        return;
      }
      cookieJar.set(name, String(value));
    },
    delete(name) {
      cookieJar.delete(name);
    },
  };
}

export async function cookies() {
  return jar();
}
