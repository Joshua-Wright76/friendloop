import { test, expect } from "@playwright/test";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { uniqueEmail } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const codeFrom = (text: string) => {
  const code = /Or type this code: (\d{6})/.exec(text)?.[1];
  if (!code) throw new Error("No code in the sign-in email");
  return code;
};

test("A9 · someone new types the code, gives their name, and is in", async ({ page }) => {
  const email = uniqueEmail("owner");

  await page.goto("/signin");
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page).toHaveURL(/\/signin\/check-email$/);

  const code = codeFrom((await latestOutbox("signin:")).text);
  await page.getByLabel("Code from the email").fill(`${code.slice(0, 3)} ${code.slice(3)}`);
  await page.getByRole("button", { name: "Sign in with the code" }).click();

  // New here, so the same one-tap page the link opens, where the name goes.
  await expect(page).toHaveURL(/\/signin\/confirm\?token=/);
  // Visible only: navigation keeps the check-email page, which also names the address, mounted.
  await expect(page.getByText(email).filter({ visible: true })).toBeVisible();
  await page.getByLabel("Your name").fill("Nia");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/you$/);
  await expect(page.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible();
});

test("A9 · on a device that never asked, a returning person types address and code and goes straight in", async ({ page }) => {
  const email = uniqueEmail("owner");
  await rows("insert into users (email, name) values ($1, 'Returning')", [email]);

  // The home-screen app: no cookie from the browser that asked.
  await page.goto("/signin");
  await page.getByRole("link", { name: "Already have a code?" }).click();
  await expect(page).toHaveURL(/\/signin\/check-email$/);

  // Asked from somewhere else.
  const other = await page.context().browser()!.newContext();
  const asker = await other.newPage();
  await asker.goto("/signin");
  await asker.getByLabel("Your email").fill(email);
  await asker.getByRole("button", { name: "Email me a link" }).click();
  await expect(asker).toHaveURL(/\/signin\/check-email$/);
  await other.close();
  const code = codeFrom((await latestOutbox("signin:")).text);

  // By role: the sign-in form navigation keeps mounted (hidden) has a "Your email" too.
  const address = page.getByRole("textbox", { name: /Your email/ });
  await address.fill(email);
  await page.getByLabel("Code from the email").fill(code === "000000" ? "000001" : "000000");
  await page.getByRole("button", { name: "Sign in with the code" }).click();
  await expect(page.getByText("That code doesn't match. Check it's from the newest sign-in email.")).toBeVisible();
  await expect(address, "a wrong code keeps the address").toHaveValue(email);

  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Sign in with the code" }).click();
  await expect(page).toHaveURL(/\/you$/);
  await expect(page.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible();
});
