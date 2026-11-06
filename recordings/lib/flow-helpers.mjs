/** Small helpers shared by the settings, roles and identity recordings. */

/** Flip the app's real theme switch until the page is in `scheme`. */
export async function setScheme(t, scheme) {
  const current = await t.eval(`document.documentElement.dataset.theme`);
  if (current !== scheme) await t.click(".theme-switch");
  await t.pause(600);
  t.check_((await t.eval(`document.documentElement.dataset.theme`)) === scheme, `The page never went ${scheme}`);
}

export const cssVar = (t, name) => t.eval(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`);

/** Tag the card holding `text` so a CSS selector can reach inside it. Returns the selector. */
export async function card(t, text, { within = "li.card, .card", tag = "rec" } = {}) {
  const ok = await t.eval(`(() => {
    document.querySelectorAll('[data-rec-card=${JSON.stringify(tag)}]').forEach((el) => el.removeAttribute('data-rec-card'));
    const hit = [...document.querySelectorAll(${JSON.stringify(within)})].find((el) => el.innerText.includes(${JSON.stringify(text)}));
    if (!hit) return false; hit.setAttribute('data-rec-card', ${JSON.stringify(tag)}); return true;
  })()`);
  t.check_(ok, `No card containing "${text}"`);
  return `[data-rec-card="${tag}"]`;
}

/** The current sign-in cookie, so the same session can come back later. */
export async function holdSession(t) {
  const { cookies } = await t.page("Network.getCookies", { urls: [t.stack.app] });
  const cookie = cookies.find((item) => item.name === "fl_session");
  t.check_(cookie, "No session cookie to hold");
  return cookie.value;
}
export async function resumeSession(t, value) {
  await t.page("Network.clearBrowserCookies");
  await t.page("Network.setCookie", { name: "fl_session", value, url: t.stack.app, httpOnly: true, sameSite: "Lax", path: "/" });
}

/** The id Next gave a server action, read from the client chunks the current page loaded. */
export async function serverActionId(t, name) {
  const id = await t.eval(`(async () => {
    const urls = performance.getEntriesByType("resource").map((entry) => entry.name).filter((url) => url.includes(".js"));
    for (const url of new Set([...urls, ...[...document.scripts].map((s) => s.src).filter(Boolean)])) {
      const source = await (await fetch(url)).text();
      const match = source.match(new RegExp('"([0-9a-f]{40,})"[^"]{0,120}"' + ${JSON.stringify(name)} + '"'));
      if (match) return match[1];
    }
    return null;
  })()`);
  t.check_(id, `No server action named ${name} in this page's chunks`);
  return id;
}

/**
 * POST a server action from the page as a plain multipart form, the request a real
 * <form> sends before hydration, with the signed-in person's own cookies.
 * Follows redirects: `landed` is where the server sent them. Always pair this with a
 * positive control (the same request succeeding for someone allowed), since a
 * malformed request also "changes nothing".
 */
export async function postServerAction(t, path, id, fields) {
  return t.eval(`(async () => {
    const form = new FormData();
    form.append("$ACTION_ID_" + ${JSON.stringify(id)}, "");
    for (const [key, value] of Object.entries(${JSON.stringify(fields)})) form.append(key, value);
    const response = await fetch(${JSON.stringify(path)}, { method: "POST", body: form });
    return { status: response.status, landed: new URL(response.url).pathname + new URL(response.url).search };
  })()`);
}
