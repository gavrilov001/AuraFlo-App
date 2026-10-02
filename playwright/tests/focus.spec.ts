import { test, expect } from "@playwright/test";
import { login, uniqueTitle } from "../support/auth";

async function addFocus(page: import("@playwright/test").Page, heading: string, title: string): Promise<void> {
  const section = page.getByRole("region", { name: new RegExp(heading) });
  await section.getByRole("button", { name: `Add to ${heading}` }).click();
  await section.getByLabel("What do you want to keep in view?").fill(title);
  await section.getByRole("button", { name: "Add focus" }).click();
  await expect(section.getByText(title, { exact: true })).toBeVisible();
}

test.describe("Focus", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page, testInfo);
    await page.goto("/app/focus");
  });

  test("creates short-, medium-, and long-term focus items", async ({ page }) => {
    await addFocus(page, "Now", uniqueTitle("E2E short focus"));
    await addFocus(page, "Next", uniqueTitle("E2E medium focus"));
    await addFocus(page, "Direction", uniqueTitle("E2E long focus"));
  });

  test("edits and archives a focus item", async ({ page }) => {
    const title = uniqueTitle("E2E editable focus");
    const edited = `${title} edited`;
    await addFocus(page, "Now", title);
    const section = page.getByRole("region", { name: "Now" });
    const card = section.locator("li").filter({ hasText: title }).first();
    await card.getByRole("button", { name: "Edit" }).click();
    await card.getByLabel("Title").fill(edited);
    await card.getByRole("button", { name: "Save" }).click();
    await expect(section.getByText(edited, { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Archive" }).click();
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible()) {
      await dialog.getByRole("button", { name: "Archive" }).click();
    }
    await expect(section.getByText(edited, { exact: true })).toHaveCount(0);
  });
});
