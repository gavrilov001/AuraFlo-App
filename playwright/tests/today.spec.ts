import { test, expect, type Page } from "@playwright/test";
import { login, uniqueTitle } from "../support/auth";

async function prepareToday(page: Page, title: string): Promise<void> {
  await page.goto("/app/capture");
  const composer = page.getByRole("region", { name: "Quick capture" });
  await composer.getByLabel("Capture a thought").fill(title);
  await composer.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await page.goto("/app/start");
  await page.getByRole("button", { name: "Do now" }).click();
  await page.getByRole("button", { name: "Shape my day" }).click();
  await page.getByRole("button", { name: "Review my plan" }).click();
  await page.getByRole("button", { name: "Start my day" }).click();
  await expect(page).toHaveURL(/\/app\/today/);
}

test.describe("Today", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await login(page, testInfo);
  });

  test("shows planned work and separates Top priorities from other tasks", async ({ page }) => {
    const title = uniqueTitle("E2E today");
    await prepareToday(page, title);
    await expect(page.getByRole("heading", { name: "Other tasks" })).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test("completes and reopens a planned task", async ({ page }) => {
    const title = uniqueTitle("E2E complete");
    await prepareToday(page, title);
    const row = page.locator("li").filter({ hasText: title }).first();
    await row.getByRole("button", { name: /Complete|Mark complete/ }).click();
    await expect(page.getByText(/completed/i).first()).toBeVisible();
    await page.getByRole("button", { name: /Completed today/ }).click();
    await row.getByRole("button", { name: /Reopen/ }).click();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test("quick capture and adjust plan are available", async ({ page }) => {
    const title = uniqueTitle("E2E quick capture");
    await prepareToday(page, uniqueTitle("E2E plan"));
    const quick = page.getByRole("region", { name: "Quick capture" });
    await quick.getByLabel("Capture a thought").fill(title);
    await quick.getByRole("button", { name: "Capture" }).click();
    await expect(page.getByText("Captured to your Dream Catcher.")).toBeVisible();
    await page.getByRole("link", { name: "Adjust plan" }).click();
    await expect(page).toHaveURL(/\/app\/start\?mode=adjust/);
  });

  test("Reset Today requires confirmation", async ({ page }) => {
    await prepareToday(page, uniqueTitle("E2E reset"));
    await page.getByRole("button", { name: /Day actions/ }).click();
    await page.getByRole("menuitem", { name: /Reset today/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("button", { name: /Reset/i })).toBeVisible();
  });
});
