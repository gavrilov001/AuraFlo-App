import { test, expect } from "@playwright/test";
import { credentials, login } from "../support/auth";

test.describe("authentication", () => {
  test("invalid login displays an error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(`invalid-${Date.now()}@example.invalid`);
    await page.getByRole("textbox", { name: "Password" }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/email or password/i)).toBeVisible();
  });

  test("unauthenticated users are redirected from protected routes", async ({ page }) => {
    await page.goto("/app/capture");
    await expect(page).toHaveURL(/\/login\?redirectTo=/);
  });

  test("owner can sign in and log out", async ({ page }, testInfo) => {
    test.skip(!credentials(), "Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run authenticated E2E tests.");
    await login(page, testInfo);
    await expect(page.getByRole("link", { name: /Dream Catcher/ })).toBeVisible();
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
