import { test, expect } from "@playwright/test";
import { login, uniqueTitle } from "../support/auth";

test.describe("All Tasks", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page, testInfo);
    await page.goto("/app/tasks");
  });

  test("creates, searches, edits, completes, reopens, and moves a task", async ({ page }) => {
    const title = uniqueTitle("E2E task");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("dialog", { name: "Add task" })).toBeVisible();
    const panel = page.getByRole("dialog", { name: "Add task" });
    await panel.getByLabel("Title").fill(title);
    await panel.getByLabel("Notes").fill("E2E task notes");
    await panel.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: title }).click();
    const editPanel = page.getByRole("dialog", { name: "Edit task" });
    await editPanel.getByLabel("Notes").fill("E2E task notes edited");
    await editPanel.getByRole("button", { name: "Save" }).click();
    await page.reload();
    await page.getByRole("button", { name: title }).click();
    await expect(page.getByRole("dialog", { name: "Edit task" }).getByLabel("Notes")).toHaveValue("E2E task notes edited");
    await page.getByRole("dialog", { name: "Edit task" }).getByRole("button", { name: "Close" }).click();

    await page.getByLabel("Search tasks").fill(title);
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    const row = page.locator("li").filter({ hasText: title }).first();
    await row.getByRole("button", { name: /Complete/ }).click();
    await page.getByRole("tab", { name: "Completed" }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.locator("li").filter({ hasText: title }).first().getByRole("button", { name: "Reopen" }).click();
    await page.getByRole("tab", { name: "Open" }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.locator("li").filter({ hasText: title }).first().getByRole("button", { name: /Task actions/ }).click();
    await page.getByRole("menuitem", { name: "Move to Later" }).click();
    await page.getByRole("tab", { name: "Later" }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test("supports the task views", async ({ page }) => {
    for (const view of ["Open", "Today", "Scheduled", "Delegated", "Later", "Completed"]) {
      await page.getByRole("tab", { name: view }).click();
      await expect(page.getByRole("tab", { name: view })).toHaveAttribute("aria-selected", "true");
    }
  });
});
