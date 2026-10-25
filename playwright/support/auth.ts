import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

/**
 * Many mutations in this app are optimistic client-side, with the actual
 * server write (Server Action / RPC round trip) landing some real,
 * occasionally-not-trivial time after the UI already reflects the change —
 * a toast or an optimistic hide is not proof the write has landed. A single
 * `page.reload()` right after one of those can race ahead of it and read
 * back stale server state. These retry a real reload a bounded number of
 * times — each attempt reflects genuine server state at that instant, so
 * this surfaces a real regression (by still failing after every attempt)
 * rather than papering over one with a blind sleep.
 */
async function reloadUntil(
  page: Page,
  check: () => Promise<boolean>,
  attempts = 10,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await check()) return;
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
  }
}

/**
 * A Link click right after a fresh page load can occasionally be swallowed
 * pre-hydration — React hasn't attached the client router's click handler
 * yet, so the click lands on an inert anchor and nothing navigates
 * (confirmed directly: clicking a tab as the very first interaction on a
 * freshly loaded page, with no other action involved, can silently no-op;
 * a second click on the same tab works). Verifies the URL actually changed
 * as expected and retries the click itself — not a reload — since reloading
 * a URL the first click never left doesn't help.
 */
export async function clickTab(
  page: Page,
  locator: Locator,
  urlIncludes: string,
  attempts = 3,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await locator.click();
    try {
      await page.waitForURL((url) => url.toString().includes(urlIncludes), {
        timeout: 2_000,
      });
      return;
    } catch {
      // Swallowed click — retry.
    }
  }
  await expect(page).toHaveURL(new RegExp(urlIncludes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

export async function reloadUntilVisible(
  page: Page,
  locator: Locator,
  attempts = 10,
): Promise<void> {
  await reloadUntil(page, () => locator.isVisible().catch(() => false), attempts);
  await expect(locator).toBeVisible();
}

export async function reloadUntilHidden(
  page: Page,
  locator: Locator,
  attempts = 10,
): Promise<void> {
  await reloadUntil(
    page,
    async () => !(await locator.isVisible().catch(() => false)),
    attempts,
  );
  await expect(locator).toBeHidden();
}

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
 * Signs up a brand-new, disposable account and returns its credentials.
 * Use this — never the shared E2E_OWNER account via login() — for any test
 * that changes a password: mutating the shared owner's password would break
 * every other spec file's login() call for the rest of the run.
 */
export async function signUpFresh(
  page: Page,
): Promise<{ email: string; password: string }> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const password = "E2E-Fresh-Password-1234!";
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("E2E Fresh");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
  await page.getByRole("textbox", { name: "Confirm password" }).fill(password);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/app\/capture/, { timeout: 15_000 });
  return { email, password };
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
    // The confirm dialog can still be mid-close (e.g. an exit transition)
    // after the URL/content underneath has already moved on — leaving its
    // overlay in the DOM long enough to intercept the very next click this
    // helper makes (the "Batch organize" toggle below). Wait for it to
    // actually detach before treating the reset as finished.
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/app\/start/, { timeout: 15_000 });
    // Same skeleton race as the initial navigation — wait for real content.
    await page.getByRole("button", { name: /Day actions/ }).waitFor({ timeout: 10_000 });
  }

  // A bare `isVisible()` right after navigation/reload races the same
  // Suspense-boundary gap the comments above call out for "Day actions" —
  // "Batch organize" not being visible *yet* looks identical to the inbox
  // genuinely being empty, and the two have very different consequences: the
  // latter is a no-op, the former silently skips discarding an inbox that
  // still has captures in it, leaking them into whichever test runs next.
  // Wait for the review area to resolve into one of its two terminal states
  // (something to review, or none) instead of sampling it at a single instant.
  const batchButton = page.getByRole("button", { name: "Batch organize" });
  // Two different empty-state headings depending on whether this session
  // ever had anything to review (InboxClearState.tsx's `hadNone` branch) —
  // match either.
  const inboxClear = page.getByRole("heading", {
    name: /Nothing waiting in your inbox\.|Your inbox is clear\./,
  });
  await expect(batchButton.or(inboxClear)).toBeVisible({ timeout: 10_000 });
  if (!(await batchButton.isVisible().catch(() => false))) return; // inbox already clear

  await batchButton.click();
  const selectAllButton = page.getByRole("button", { name: /Select all/ });
  await selectAllButton.waitFor({ timeout: 10_000 });
  await selectAllButton.click();
  const discardButton = page.getByRole("button", { name: /Discard/ });
  await discardButton.click();
  const confirmDialog = page.getByRole("dialog");
  if (await confirmDialog.isVisible().catch(() => false)) {
    await confirmDialog.getByRole("button", { name: /Discard/ }).click();
  }
  // The discard is optimistic client-side, same as everywhere else in this
  // app — the toast fires on the client update, not on the server write
  // landing. A single reload right after the toast can race ahead of that
  // write (observed: the server round trip can still be in flight ~500ms
  // after the toast appears) and read back stale, not-yet-discarded state.
  // Verify with real reloads — retried a few times, since each one reflects
  // genuine server state at that instant — rather than trusting one shot.
  await expect(page.getByText(/thoughts? discarded/i)).toBeVisible({ timeout: 10_000 });
  const batchOrganizeStillVisible = page.getByRole("button", { name: "Batch organize" });
  let cleared = false;
  for (let attempt = 0; attempt < 10 && !cleared; attempt++) {
    await page.reload();
    // Wait for the real page (not the loading skeleton) to render before
    // checking for "Batch organize" — otherwise a check can pass trivially
    // while content is still streaming in, not because it's gone.
    await page.getByRole("button", { name: /Day actions/ }).waitFor({ timeout: 10_000 });
    cleared = !(await batchOrganizeStillVisible.isVisible().catch(() => false));
  }
  await expect(batchOrganizeStillVisible).toBeHidden();
}
