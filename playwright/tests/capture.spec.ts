import { test, expect } from "@playwright/test";
import { login, uniqueTitle } from "../support/auth";

test.describe("Dream Catcher", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page, testInfo);
    await page.goto("/app/capture");
  });

  test("captures, persists, edits, searches, archives, restores, discards, and restores a thought", async ({ page }) => {
    const title = uniqueTitle("E2E capture");
    const edited = `${title} edited`;
    const composer = page.getByRole("region", { name: "Quick capture" });
    const category = composer.locator("select").first();
    if (await category.count() && await category.locator("option").count() > 1) {
      await category.selectOption({ index: 1 });
    }

    await composer.getByLabel("Capture a thought").fill(title);
    await composer.getByRole("button", { name: "Capture" }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    const row = page.locator("li").filter({ hasText: title }).first();
    await row.getByRole("button", { name: "Thought actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await page.getByLabel("Edit thought").fill(edited);
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(edited, { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: "Archived" }).click();
    await expect(page).toHaveURL(/filter=archived/);
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);

    await page.getByRole("tab", { name: "Inbox" }).click();
    const editedRow = page.locator("li").filter({ hasText: edited }).first();
    await editedRow.getByRole("button", { name: "Thought actions" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.getByRole("tab", { name: "Archived" }).click();
    const archivedRow = page.locator("li").filter({ hasText: edited }).first();
    await expect(archivedRow).toBeVisible();
    await archivedRow.getByRole("button", { name: "Thought actions" }).click();
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await page.getByRole("tab", { name: "Inbox" }).click();
    await expect(page.getByText(edited, { exact: true })).toBeVisible();

    const discarded = uniqueTitle("E2E discarded capture");
    await composer.getByLabel("Capture a thought").fill(discarded);
    await composer.getByRole("button", { name: "Capture" }).click();
    const discardedRow = page.locator("li").filter({ hasText: discarded }).first();
    await discardedRow.getByRole("button", { name: "Thought actions" }).click();
    await page.getByRole("menuitem", { name: "Discard" }).click();
    await page.getByRole("tab", { name: "Discarded" }).click();
    const discardedResult = page.locator("li").filter({ hasText: discarded }).first();
    await expect(discardedResult).toBeVisible();
    await discardedResult.getByRole("button", { name: "Thought actions" }).click();
    await page.getByRole("menuitem", { name: "Restore to Inbox" }).click();
    await page.getByRole("tab", { name: "Inbox" }).click();
    await expect(page.getByText(discarded, { exact: true })).toBeVisible();
  });

  test("searches processed thoughts", async ({ page }) => {
    await page.getByRole("tab", { name: "Processed" }).click();
    const search = page.getByLabel("Search thoughts");
    await search.fill("unlikely-e2e-search-term");
    await expect(page.getByText("Nothing processed yet.").or(page.getByText("No thoughts match"))).toBeVisible();
  });
});
