const AREA = "H · Preview";
const KEY = "rec-preview-secret";

/** The locked inbox has an empty 404 body, so the browser shows its own error page: agent-browser reports that as a failed navigation. */
async function lockedInbox(t, code) {
  await t.open("/dev/outbox").catch((error) => {
    if (!String(error.message).includes("ERR_HTTP_RESPONSE_CODE_FAILURE")) throw error;
  });
  await t.pause(900);
  await t.panel("GET /dev/outbox", `HTTP ${code}`, { hold: 2000 });
}

export const flows = {
  H1: { title: "Preview screens and emails", area: AREA,
    staged: "The status checks are real requests from the page; the screens themselves are unlinked from the site.",
    run: async (t) => {
      const status = (path) => t.eval(`fetch(${JSON.stringify(path)}, { redirect: "manual" }).then((r) => r.status)`);
      // A streamed page can say 404 in its body while the status line says 200.
      const answer = (path) => t.eval(`fetch(${JSON.stringify(path)}).then(async (r) => { const html = await r.text(); return { code: r.status, missing: (() => { const doc = new DOMParser().parseFromString(html, "text/html"); doc.querySelectorAll("script, template").forEach((el) => el.remove()); return doc.body.textContent.includes("This page isn"); })() }; })`);
      await t.say("The preview screens open at /dev/screens, with no key");
      await t.open("/dev/screens");
      await t.see("UI preview");
      await t.tour({ dwell: 400 });
      await t.say("Every screen answers. Only the two private inboxes are locked");
      const links = await t.eval(`[...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href")).filter((h) => h.startsWith("/") && !h.startsWith("/dev/ui"))`);
      const open = [];
      const locked = [];
      for (const link of links) {
        const { code, missing } = await answer(link);
        if (code === 404) locked.push(link);
        else if (code === 200 && !missing) open.push(link);
        else t.check_(false, `Preview screen ${link} answered ${code}${missing ? " with a not-found page" : ""}`);
      }
      t.check_(JSON.stringify(locked.sort()) === JSON.stringify(["/dev/feedback", "/dev/outbox"]), `Locked: ${locked}`);
      await t.panel(`${links.length} preview links`, `${open.length} open, HTTP 200\n${locked.length} locked, HTTP 404: ${locked.join(", ")}`);
      await t.toTop();
      await t.say("The email templates are one link away");
      await t.link("Email templates");
      await t.expectUrl(/\/dev\/emails$/);
      await t.see("Sign-in link");
      const frames = await t.eval(`document.querySelectorAll("iframe").length`);
      t.check_(frames === 10, `Expected 10 email previews, saw ${frames}`);
      await t.tour({ dwell: 300, max: 6 });
      await t.see("Empty round, loop paused");
      await t.say("The captured inbox holds live links: it is a 404 without the key");
      const noKey = await status("/dev/outbox");
      t.check_(noKey === 404, `The inbox answered ${noKey} without a key`);
      await lockedInbox(t, noKey);
      await t.say("A wrong key keeps it locked");
      await t.open("/dev/ui?key=not-the-key");
      const wrongKey = await status("/dev/outbox");
      t.check_(wrongKey === 404, `The inbox answered ${wrongKey} with a wrong key`);
      await lockedInbox(t, wrongKey);
      await t.say("The right key opens it");
      await t.open(`/dev/ui?key=${KEY}`);
      await t.expectUrl(/\/dev\/screens$/);
      await t.open("/dev/outbox");
      await t.see("Captured email");
      await t.see("live sign-in links");
    } },
};
