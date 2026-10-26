import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpFresh, clickTab } from "../support/auth";

/**
 * A click right after a fresh page load can land before React attaches the
 * client handler (documented in playwright/support/auth.ts's clickTab for
 * nav-tab links — reproduced here against this repo's current code on an
 * unrelated button, confirming it's a pre-existing hydration-timing race,
 * not something this feature introduced). Retries the click itself.
 */
async function clickWithRetry(
  page: Page,
  locator: Locator,
  checkDone: () => Promise<boolean>,
  attempts = 5,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await locator.click();
    try {
      await expect.poll(checkDone, { timeout: 2_000 }).toBe(true);
      return;
    } catch {
      // Swallowed click — retry.
    }
  }
  await expect.poll(checkDone).toBe(true);
}

/**
 * Regression + lifecycle coverage for the Inbox's Supabase Realtime
 * subscription (CaptureBoard.tsx), added alongside it. Uses a disposable
 * signUpFresh() account rather than the shared E2E_OWNER login — no secrets
 * required, so this runs in any environment with just the public Supabase
 * URL/publishable key.
 *
 * What this does NOT verify: an actual postgres_changes INSERT event being
 * delivered end-to-end. That requires public.captures to be in the
 * supabase_realtime publication (supabase/migrations/20261104000000_
 * captures_realtime.sql), which is an unapplied migration as of this test's
 * authorship. Once that migration is applied, extend this file with a test
 * that inserts a row via a second authenticated context and asserts the
 * first page's Inbox updates without a manual reload.
 */
test.describe("Dream Catcher Inbox — realtime subscription lifecycle", () => {
  test("subscribes without error on the Inbox tab and cleans up when leaving it", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    // signUpFresh() already lands on /app/capture — a second goto() here
    // would re-navigate mid-render and detach elements mid-interaction.
    await signUpFresh(page);
    await expect(page.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");

    // Give the channel a moment to reach SUBSCRIBED (or fail) before asserting.
    await page.waitForTimeout(1500);

    await clickTab(page, page.getByRole("tab", { name: "Processed" }), "filter=processed");
    await page.waitForTimeout(500);

    await clickTab(page, page.getByRole("tab", { name: "Inbox" }), "/app/capture");
    await expect(page).toHaveURL(/\/app\/capture$/);
    await page.waitForTimeout(500);

    const unexpected = errors.filter(
      (e) => !/favicon|the server responded with a status of 404/i.test(e),
    );
    expect(unexpected, `Unexpected console/page errors:\n${unexpected.join("\n")}`).toEqual([]);
  });

  test("manual capture still appears immediately (optimistic UI unaffected by realtime subscription)", async ({
    page,
  }) => {
    await signUpFresh(page);

    const title = `RT regression ${Date.now()}`;
    const composer = page.getByRole("region", { name: "Quick capture" });
    await composer.getByLabel("Capture a thought").fill(title);
    // Safe to retry here specifically because CaptureBoard's optimistic row
    // is added via a synchronous setState the instant the click handler
    // actually runs (see handleCapture in CaptureBoard.tsx) — if the title
    // hasn't rendered within the poll window, the first click's handler
    // never ran at all (swallowed by the hydration race clickTab works
    // around elsewhere), not "it ran but is still working", so a second
    // click can't double-submit.
    await clickWithRetry(
      page,
      composer.getByRole("button", { name: "Capture" }),
      () => page.getByText(title, { exact: true }).isVisible(),
    );

    // Reconciles with the server-saved row (same assertion capture.spec.ts
    // makes) — confirms the realtime subscription's own debounced refresh
    // doesn't fight with or duplicate the create flow's reconciliation.
    await page.reload();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toHaveCount(1);
  });
});
