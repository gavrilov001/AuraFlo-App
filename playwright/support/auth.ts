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

/**
 * Ensures a fresh Start My Day ritual is available for "today" before a test
 * walks through it. The E2E owner account is shared and persists across
 * test runs within the same calendar day, so state an earlier test left
 * behind can make a new test's assumptions wrong in two distinct ways this
 * clears, in order:
 *
 * 1. The plan itself already advanced to prioritize/ready/active/completed
 *    (e.g. a previous test finished "Start my day") — Start My Day would
 *    skip straight to "Your day is already planned" instead of the capture
 *    review flow a new test expects. Fixed via the app's own Reset Today
 *    feature; a brand-new day's plan is left untouched.
 * 2. The plan is still in capture review, but an earlier test deliberately
 *    left one of its own captures undecided (e.g. a test that only checks
 *    the initial "Do now" button is present, by design, never clicks it).
 *    A later test's capture then becomes "Thought 2 of 2" instead of
 *    "Thought 1 of 1", and flows that expect the review to finish after
 *    deciding on their own one capture hang waiting for a step that never
 *    comes. Fixed by draining every pre-existing capture via Batch organize
 *    → Select all → Discard — safe here because this runs in `beforeEach`,
 *    strictly before the current test creates its own capture.
 */
export async function resetPlanningDay(page: Page): Promise<void> {
  await page.goto("/app/start");
  // /app/start has a loading.tsx skeleton (no text/buttons at all) that can
  // still be showing when `domcontentloaded` fires, since the real content
  // streams in after that as a Suspense boundary resolves. Checking state
  // against the bare skeleton always reads as "nothing to do" — wait for
  // something only the real page renders (Day actions is present in every
  // actual plan state) before evaluating anything below.
  await page.getByRole("button", { name: /Day actions/ }).waitFor({ timeout: 10_000 });

  const blockedSignals = [
    page.getByText("Your day is already planned."),
    page.getByRole("heading", { name: /Shape your day|Adjust today's plan/ }),
    page.getByRole("button", { name: "Start my day" }),
  ];
  let needsReset = false;
  for (const signal of blockedSignals) {
    if (await signal.isVisible().catch(() => false)) {
      needsReset = true;
      break;
    }
  }

  if (needsReset) {
    await page.getByRole("button", { name: /Day actions/ }).click();
    await page.getByRole("menuitem", { name: /Reset today/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Type RESET to confirm").fill("RESET");
    const resetButton = dialog.getByRole("button", { name: "Reset today" });
    await expect(resetButton).toBeEnabled({ timeout: 10_000 });
    await resetButton.click();
    await expect(page).toHaveURL(/\/app\/start/, { timeout: 15_000 });
    // Same skeleton race as the initial navigation — wait for real content.
    await page.getByRole("button", { name: /Day actions/ }).waitFor({ timeout: 10_000 });
  }

  const batchButton = page.getByRole("button", { name: "Batch organize" });
  if (!(await batchButton.isVisible().catch(() => false))) return; // inbox already clear

  await batchButton.click();
  const selectAllButton = page.getByRole("button", { name: /Select all/ });
  if (!(await selectAllButton.isVisible().catch(() => false))) return;
  await selectAllButton.click();
  const discardButton = page.getByRole("button", { name: /Discard/ });
  await discardButton.click();
  const confirmDialog = page.getByRole("dialog");
  if (await confirmDialog.isVisible().catch(() => false)) {
    await confirmDialog.getByRole("button", { name: /Discard/ }).click();
  }
  // The discard is optimistic client-side, same as everywhere else in this
  // app — the empty-state text (or even the capture disappearing) can show
  // before the server write actually lands. Wait for the confirmation toast,
  // then verify with a hard reload (bypassing any client-side state) that
  // the inbox is genuinely empty server-side before handing back to a test
  // that's about to create its own capture and assume it's the only one.
  await expect(page.getByText(/thoughts? discarded/i)).toBeVisible({ timeout: 10_000 });
  await page.reload();
  // Wait for the real page (not the loading skeleton) to render before
  // checking for "Batch organize" — otherwise toBeHidden() can pass
  // trivially while content is still streaming in, not because it's gone.
  await page.getByRole("button", { name: /Day actions/ }).waitFor({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Batch organize" })).toBeHidden();
}
