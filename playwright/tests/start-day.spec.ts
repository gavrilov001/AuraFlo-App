import { test, expect, type Page } from "@playwright/test";
import { login, uniqueTitle } from "../support/auth";

async function createCapture(page: Page, title: string): Promise<void> {
  await page.goto("/app/capture");
  const composer = page.getByRole("region", { name: "Quick capture" });
  await composer.getByLabel("Capture a thought").fill(title);
  await composer.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}

async function selectBatchCapture(page: Page, title: string): Promise<void> {
  const checkbox = page.getByLabel(new RegExp(`Select "${title.slice(0, 30)}`));
  await checkbox.check();
}

test.describe("Start My Day", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page, testInfo);
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
    await page.getByRole("button", { name: "Do now" }).click();
    await expect(page.getByText(/Thought \d+ of \d+/)).toBeVisible();
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
    await page.getByRole("button", { name: /Move to Later/ }).click();
    await expect(page.getByText(/moved to Later/i)).toBeVisible();

    await selectBatchCapture(page, discardTitle);
    await page.getByRole("button", { name: /Discard/ }).click();
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible()) {
      await dialog.getByRole("button", { name: /Discard/ }).click();
    }
    await expect(page.getByText(/discarded/i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(discardTitle, { exact: true })).toHaveCount(0);
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
    await expect(page.getByText(/scheduled/i)).toBeVisible();

    await selectBatchCapture(page, delegateTitle);
    await page.getByRole("button", { name: "Delegate" }).click();
    await expect(page.getByLabel("Hand it to")).toBeVisible();
    await page.getByLabel("Hand it to").fill("E2E delegate");
    await page.getByRole("button", { name: "Delegate it" }).click();
    await expect(page.getByText(/delegated/i)).toBeVisible();
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
    for (let index = 0; index < 3; index += 1) {
      await priorityButtons.nth(index).click();
    }
    await expect(priorityButtons.nth(3)).toBeDisabled();
  });
});
