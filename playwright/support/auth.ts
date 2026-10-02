import { expect, type Page, type TestInfo } from "@playwright/test";

export function credentials(): { email: string; password: string } | null {
  const email = process.env.E2E_OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD;
  return email && password ? { email, password } : null;
}

export function requireCredentials(testInfo: TestInfo): {
  email: string;
  password: string;
} {
  const values = credentials();
  if (!values) {
    testInfo.skip(true, "Set E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD to run authenticated E2E tests.");
  }
  return values as { email: string; password: string };
}

export async function login(page: Page, testInfo: TestInfo): Promise<void> {
  const values = requireCredentials(testInfo);
  await page.goto("/login");
  await page.getByLabel("Email").fill(values.email);
  await page.getByRole("textbox", { name: "Password" }).fill(values.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/capture/);
}

export function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
