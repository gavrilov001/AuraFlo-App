import { test, expect } from "@playwright/test";
import { signUpFresh } from "../support/auth";

const NEUTRAL_MESSAGE = /if an account exists for that email/i;

test.describe("Forgot / reset password", () => {
  test("login page links to forgot-password", async ({ page }) => {
    await page.goto("/login");
    const link = page.getByRole("link", { name: "Forgot password?" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test("requesting a reset for an unknown email shows the neutral message", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.invalid`);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(NEUTRAL_MESSAGE)).toBeVisible();
  });

  test("requesting a reset for a known email shows the SAME neutral message, with a cooldown", async ({ page }) => {
    const owner = await signUpFresh(page);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(owner.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(NEUTRAL_MESSAGE)).toBeVisible();
    await expect(page.getByText(/request another link in/i)).toBeVisible();
  });

  test("an invalid auth callback link redirects to login with a friendly error", async ({ page }) => {
    await page.goto("/auth/callback?code=not-a-real-code&next=/update-password");
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(
      page.getByText(/that link is invalid or has expired/i),
    ).toBeVisible();
  });

  test("an expired recovery token_hash redirects to login with a friendly error", async ({ page }) => {
    await page.goto("/auth/callback?token_hash=garbage123&type=recovery&next=/update-password");
    await expect(page).toHaveURL(/\/login\?error=/);
    await expect(
      page.getByText(/that link is invalid or has expired/i),
    ).toBeVisible();
  });

  test("auth callback redirects use our trusted site URL, never a spoofed Host header (regression)", async ({
    request,
  }) => {
    // Confirmed root cause of a real production bug: the callback route
    // used to build its redirect from request.nextUrl.origin, which on AWS
    // Amplify reflected the app's own internal origin rather than the
    // public domain the browser actually requested — sending real
    // recovery-link clicks to an unreachable localhost URL. Fixed to build
    // every redirect from getSiteUrl() (our own trusted config) instead of
    // anything request-derived. This sends a forged Host/X-Forwarded-Host
    // — exactly what a misbehaving proxy (or an attacker) could present —
    // and asserts the redirect never reflects it back, regardless of
    // whether the platform happens to behave itself on any given request.
    const res = await request.get(
      "/auth/callback?code=not-a-real-code&next=/update-password",
      {
        headers: {
          Host: "evil.example.invalid",
          "X-Forwarded-Host": "evil.example.invalid",
          "X-Forwarded-Proto": "https",
        },
        maxRedirects: 0,
      },
    );

    expect([301, 302, 303, 307, 308]).toContain(res.status());
    const location = res.headers()["location"];
    expect(location).toBeTruthy();
    expect(location).not.toContain("evil.example.invalid");
    // Our own test baseURL (PLAYWRIGHT_BASE_URL, default http://127.0.0.1:3000
    // per playwright.config.ts) is what NEXT_PUBLIC_SITE_URL resolves to for
    // this run — the redirect must be absolute against that, not the
    // spoofed host above.
    expect(location).toMatch(/^https?:\/\/(127\.0\.0\.1|localhost):3000\//);
  });

  test("visiting /update-password with no session shows the expired state, not the form", async ({ page }) => {
    await page.goto("/update-password");
    await expect(
      page.getByRole("heading", { name: "This link is no longer valid." }),
    ).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).not.toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request a new reset link" }),
    ).toBeVisible();
  });

  test("an existing authenticated user can update their password, is signed out, then logs in with the new password", async ({ page }) => {
    const owner = await signUpFresh(page);

    // A logged-in user visiting /update-password directly is the exact
    // same code path a real recovery-link session takes once exchanged by
    // /auth/callback: both are just "a valid session calling updateUser()".
    await page.goto("/update-password");
    await expect(
      page.getByRole("heading", { name: "Choose a new password." }),
    ).toBeVisible();

    const newPassword = "New-E2E-Fresh-Password-9999!";
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();

    // Success state, not an automatic carry-into-the-app redirect.
    await expect(
      page.getByRole("heading", { name: "Password updated successfully!" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/update-password\?reset=success/);
    await expect(
      page.getByRole("link", { name: "Sign in to AuraFlo" }),
    ).toBeVisible();

    // The recovery session was actually signed out server-side, not just
    // hidden client-side — a protected route should bounce to /login.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/login");

    // Old password no longer works.
    await page.getByLabel("Email").fill(owner.email);
    await page.getByRole("textbox", { name: "Password" }).fill(owner.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/email or password/i)).toBeVisible();

    // New password works.
    await page.getByLabel("Email").fill(owner.email);
    await page.getByRole("textbox", { name: "Password" }).fill(newPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app\/capture/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the 'Sign in to AuraFlo' button after a successful reset navigates to /login", async ({ page }) => {
    await signUpFresh(page);
    await page.goto("/update-password");

    const newPassword = "Another-Fresh-Password-5555!";
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();

    await page.getByRole("link", { name: "Sign in to AuraFlo" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("password mismatch on update-password shows a field error, not a crash", async ({ page }) => {
    await signUpFresh(page);
    await page.goto("/update-password");
    await page.getByLabel("New password", { exact: true }).fill("Mismatch-Password-1!");
    await page.getByLabel("Confirm new password").fill("Different-Password-2!");
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test("login/logout still work normally (regression)", async ({ page }) => {
    const owner = await signUpFresh(page);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(owner.email);
    await page.getByRole("textbox", { name: "Password" }).fill(owner.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app\/capture/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
