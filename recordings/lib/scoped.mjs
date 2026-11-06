/**
 * Reach one element inside one row of a repeated list: "the Post button on Bob's
 * answer". The harness clicks by page-wide name; these name the row by its text.
 * Elements are tagged with a data attribute and handed back as a CSS selector.
 */
let counter = 0;

export async function find(t, rootCss, hasText, targetCss, name = null, { nth = 0, exact = false } = {}) {
  const mark = `s${++counter}`;
  const found = await t.eval(`(() => {
    const has = ${JSON.stringify(hasText.toLowerCase())};
    const want = ${JSON.stringify(name?.toLowerCase() ?? null)};
    const exact = ${JSON.stringify(exact)};
    const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().toLowerCase();
    const matches = (el) => want === null || (exact ? label(el) === want : label(el).includes(want));
    for (const root of document.querySelectorAll(${JSON.stringify(rootCss)})) {
      if (!root.innerText.toLowerCase().includes(has)) continue;
      const hits = [...root.querySelectorAll(${JSON.stringify(targetCss)})].filter(matches);
      if (hits[${nth}]) { hits[${nth}].setAttribute("data-flrec-scoped", ${JSON.stringify(mark)}); return true; }
    }
    return false;
  })()`);
  t.check_(found, `No ${targetCss}${name ? ` named "${name}"` : ""} in a ${rootCss} containing "${hasText}"`);
  return `[data-flrec-scoped="${mark}"]`;
}

export async function clickIn(t, rootCss, hasText, targetCss, name, options) {
  await t.click(await find(t, rootCss, hasText, targetCss, name, options));
}

/** Replace a field's value with real keystrokes. */
export async function retype(t, selector, value) {
  await t.click(selector);
  await t.selectAllAndClear();
  await t.typeKeys(value);
}

/** A request with a multipart body, made outside the page. The response is the real one. */
export async function postForm(t, path, fields, { at, file } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append(file.field, new Blob([file.bytes], { type: file.type }), file.name);
  const response = await fetch(t.url(path), { method: "POST", body: form, headers: at ? { "x-e2e-now": at.toISOString() } : {} });
  return { status: response.status, text: await response.text() };
}

/** Wait until a condition in the page holds, or fail the take. */
export async function until(t, expression, message, { timeout = 10_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await t.eval(`Boolean(${expression})`)) return;
    await t.pause(120);
  }
  t.check_(false, message);
}
