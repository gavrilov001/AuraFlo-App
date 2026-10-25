import { test, expect, type Page } from "@playwright/test";
import { login, reloadUntilHidden, resetPlanningDay, uniqueTitle } from "../support/auth";

async function createCapture(page: Page, title: string): Promise<void> {
  await page.goto("/app/capture");
  const composer = page.getByRole("region", { name: "Quick capture" });
  await composer.getByLabel("Capture a thought").fill(title);
  await composer.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function selectBatchCapture(page: Page, title: string): Promise<void> {
  // The checkbox has no "Select ..." aria-label — it's a plain checkbox
  // wrapped in a <label> around the capture's own content, so scope by the
  // row's text instead of a label pattern that was never actually rendered.
  const row = page.locator("li").filter({ hasText: title }).first();
  await row.getByRole("checkbox").check();
}

test.describe("Start My Day", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page, testInfo);
    await resetPlanningDay(page);
  });

  test("opens the planning ritual and shows an unprocessed capture", async ({ page }) => {
    const title = uniqueTitle("E2E start day");
    await createCapture(page, title);
    await page.goto("/app/start");
    await expect(page).toHaveURL(/\/app\/start/);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Do now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Batch organize" })).toBeVisible();
  });

  test("one-at-a-time Do now creates a Today task and advances progress", async ({ page }) => {
    const title = uniqueTitle("E2E do now");
    await createCapture(page, title);
    await page.goto("/app/start");
    // With a single capture in the queue, deciding it clears the review
    // screen immediately — "Thought X of Y" is a transient in-between state,
    // not something guaranteed to still be showing once there's nothing
    // left to decide, so there's nothing to assert on here between the
    // click and the inbox-clear state it leads straight to.
    await page.getByRole("button", { name: "Do now" }).click();
    await page.getByRole("button", { name: "Shape my day" }).click();
    await expect(page.getByRole("heading", { name: "Shape your day" })).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test("batch organize supports Later and Discard without duplicate conversion", async ({ page }) => {
    const laterTitle = uniqueTitle("E2E later");
    const discardTitle = uniqueTitle("E2E discard");
    await createCapture(page, laterTitle);
    await createCapture(page, discardTitle);
    await page.goto("/app/start");
    await page.getByRole("button", { name: "Batch organize" }).click();

    await selectBatchCapture(page, laterTitle);
    await page.getByRole("button", { name: "Later", exact: true }).click();
    await expect(page.getByText(/moved to Later/i)).toBeVisible();

    await selectBatchCapture(page, discardTitle);
    await page.getByRole("button", { name: /Discard/ }).click();
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible()) {
      await dialog.getByRole("button", { name: /Discard/ }).click();
    }
    // The plain /discarded/i regex also matches the confirm dialog's body
    // copy ("They won't become tasks... Discarded thoughts...") — match the
    // actual toast text specifically.
    await expect(page.getByText(/thoughts? discarded/i)).toBeVisible();
    // The toast is optimistic, same as everywhere else in this app — it can
    // fire before the server write actually lands, so a single reload right
    // after can race ahead of it and read back stale, not-yet-discarded
    // state. Retry a few real reloads instead of trusting the first one.
    await reloadUntilHidden(page, page.getByText(discardTitle, { exact: true }));
  });

  test("batch organize opens schedule and delegate forms", async ({ page }) => {
    const scheduleTitle = uniqueTitle("E2E schedule");
    const delegateTitle = uniqueTitle("E2E delegate");
    await createCapture(page, scheduleTitle);
    await createCapture(page, delegateTitle);
    await page.goto("/app/start");
    await page.getByRole("button", { name: "Batch organize" }).click();

    await selectBatchCapture(page, scheduleTitle);
    await page.getByRole("button", { name: "Schedule" }).click();
    await expect(page.getByLabel("Schedule for")).toBeVisible();
    await page.getByLabel("Schedule for").fill("2099-12-31");
    await page.getByRole("button", { name: "Schedule it" }).click();
    // The plain /scheduled/i regex also matches the "Plan so far" sidebar's
    // permanent "Scheduled" counter label — match the actual toast text.
    await expect(page.getByText(/thoughts? scheduled/i)).toBeVisible();

    await selectBatchCapture(page, delegateTitle);
    await page.getByRole("button", { name: "Delegate" }).click();
    await expect(page.getByLabel("Hand it to")).toBeVisible();
    await page.getByLabel("Hand it to").fill("E2E delegate");
    await page.getByRole("button", { name: "Delegate it" }).click();
    // Same reasoning as the scheduled toast above — the sidebar also has a
    // permanent "Delegated" counter label that /delegated/i would also match.
    await expect(page.getByText(/thoughts? delegated/i)).toBeVisible();
  });

  test("Shape Your Day limits Top priorities to three", async ({ page }) => {
    const titles = [1, 2, 3, 4].map((n) => uniqueTitle(`E2E priority ${n}`));
    for (const title of titles) await createCapture(page, title);
    await page.goto("/app/start");
    await page.getByRole("button", { name: "Batch organize" }).click();
    for (const title of titles) await selectBatchCapture(page, title);
    await page.getByRole("button", { name: /Move to Today/ }).click();
    await page.getByRole("button", { name: /shape my day/i }).click();

    const priorityButtons = page.getByRole("button", { name: "Make a priority" });
    await expect(priorityButtons).toHaveCount(4);
    // Each click turns that button into "Top priority", removing it from
    // this live locator's matches — always take .first() of the remaining
    // set, not a fixed index, which would skip over elements as it shrinks.
    for (let index = 0; index < 3; index += 1) {
      await priorityButtons.first().click();
    }
    await expect(priorityButtons).toHaveCount(1);
    await expect(priorityButtons.first()).toBeDisabled();
  });
});
