import { test, expect } from "@playwright/test";
import { clickTab, login, reloadUntilVisible, uniqueTitle } from "../support/auth";

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
    // Same pattern as the edit flow below — the panel only closes once the
    // create action resolves, so wait for that instead of racing it.
    await expect(panel).toBeHidden();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: title }).click();
    const editPanel = page.getByRole("dialog", { name: "Edit task" });
    await editPanel.getByLabel("Notes").fill("E2E task notes edited");
    await editPanel.getByRole("button", { name: "Save" }).click();
    // Save closes the panel only once the update action resolves — wait for
    // that instead of reloading immediately, or the reload can race ahead of
    // the write and read back the pre-edit value.
    await expect(editPanel).toBeHidden();
    await page.reload();
    await page.getByRole("button", { name: title }).click();
    await expect(page.getByRole("dialog", { name: "Edit task" }).getByLabel("Notes")).toHaveValue("E2E task notes edited");
    await page.getByRole("dialog", { name: "Edit task" }).getByRole("button", { name: "Close" }).click();

    await page.getByLabel("Search tasks").fill(title);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    // The search box only reaches the URL (and from there, every tab's own
    // href via tabHref's `params.q`) after a 280ms debounce. The assertion
    // above can pass on the unfiltered list alone (the task is simply still
    // near the top of it) without proving the debounce actually landed —
    // and the account accumulates enough tasks across a full suite run that
    // relying on that is exactly what intermittently loses this task past
    // the first page once the tabs below stop carrying the search filter.
    await page.waitForFunction(
      (t) => new URLSearchParams(window.location.search).get("q") === t,
      title,
      { timeout: 5_000 },
    );

    // Complete/reopen/move are optimistic — switching tabs right after one
    // navigates to a view whose data is freshly fetched from the server, and
    // that fetch can race ahead of the mutation's own background write
    // landing. reloadUntilVisible retries a few real reloads rather than
    // trusting the first fetch. clickTab separately guards the tab click
    // itself — confirmed directly that a Link click as the first interaction
    // after a fresh load can be swallowed pre-hydration, which a reload of
    // the (never-navigated-to) URL can't fix.
    const row = page.locator("li").filter({ hasText: title }).first();
    await row.getByRole("button", { name: /Complete/ }).click();
    await clickTab(page, page.getByRole("tab", { name: "Completed" }), "view=completed");
    await reloadUntilVisible(page, page.getByText(title, { exact: true }));
    await page.locator("li").filter({ hasText: title }).first().getByRole("button", { name: "Reopen" }).click();
    await clickTab(page, page.getByRole("tab", { name: "Open" }), "view=open");
    await reloadUntilVisible(page, page.getByText(title, { exact: true }));

    await page.locator("li").filter({ hasText: title }).first().getByRole("button", { name: /Task actions/ }).click();
    await page.getByRole("menuitem", { name: "Move to Later" }).click();
    await clickTab(page, page.getByRole("tab", { name: "Later" }), "view=later");
    await reloadUntilVisible(page, page.getByText(title, { exact: true }));
  });

  test("supports the task views", async ({ page }) => {
    const views: Record<string, string> = {
      Open: "view=open",
      Today: "view=today",
      Scheduled: "view=scheduled",
      Delegated: "view=delegated",
      Later: "view=later",
      Completed: "view=completed",
    };
    for (const [view, urlFragment] of Object.entries(views)) {
      // The first tab click right after beforeEach's fresh goto is exactly
      // the pre-hydration-swallow scenario clickTab guards against.
      await clickTab(page, page.getByRole("tab", { name: view }), urlFragment);
      await expect(page.getByRole("tab", { name: view })).toHaveAttribute("aria-selected", "true");
    }
  });
});
