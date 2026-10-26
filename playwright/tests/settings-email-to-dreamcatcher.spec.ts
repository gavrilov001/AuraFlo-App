import { readFileSync } from "fs";
import { join } from "path";
import { test, expect, type Page } from "@playwright/test";
import { signUpFresh } from "../support/auth";

/**
 * Playwright's own test process doesn't load .env.local the way Next's dev
 * server does (confirmed: no dotenv dependency, no global-setup file in
 * this repo) — but it's a plain Node process, so nothing stops reading the
 * file directly. CI environments that inject these at the process level are
 * covered by the process.env check first.
 */
function readDotEnvLocal(): Record<string, string> {
  try {
    const content = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const out: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match) out[match[1]] = match[2].trim();
    }
    return out;
  } catch {
    return {};
  }
}

function getPublicSupabaseConfig(): { url: string; anonKey: string } | null {
  const fileEnv = readDotEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? fileEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? fileEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

/**
 * /app/settings has a loading.tsx skeleton (Suspense boundary around the
 * async server component), so content streams in after `page.goto()`
 * resolves — a bare, non-retrying `locator.isVisible()` called right after
 * navigation can sample the skeleton and read as "not ready" even when it
 * will be. Waits for the section's heading (present in every state) before
 * checking which state it resolved to.
 */
async function emailToDreamcatcherAvailable(page: Page): Promise<boolean> {
  await page
    .getByRole("heading", { name: "Email to Dream Catcher" })
    .waitFor({ timeout: 10_000 });
  const notSetUp = await page
    .getByText("Not set up on this environment yet.")
    .isVisible()
    .catch(() => false);
  return !notSetUp;
}

/**
 * supabase/migrations/20261026120000_email_to_dreamcatcher.sql adds the
 * schema this section depends on (user_sender_emails,
 * primary_email_verified_*). Until that migration is applied to whatever
 * database these tests run against, the Settings page degrades to the
 * "Not set up" message instead of rendering the section — this file's first
 * test covers exactly that (and should pass today, unmigrated). Every other
 * test here requires the migration applied first; they're written against
 * the post-migration UI and will fail with a clear assertion message
 * ("Not set up on this environment yet." visible) rather than a timeout if
 * run before that.
 *
 * The random-hex per-user inbound_alias address (and its Regenerate button)
 * that used to also live in this section was decommissioned by
 * 20261102000000_remove_legacy_inbound_alias.sql — the readable
 * dream_handle address from 20261101000000_dream_catcher_handles.sql is now
 * the only personal address shown here, so there is exactly one `<code>`
 * element in this section, not two.
 *
 * Verifying an address (clicking the emailed link) can't be driven through
 * the UI without a real inbox — that path is covered by the RPC-level
 * procedure in supabase/tests/email_to_dreamcatcher_test_procedure.md
 * instead. These tests cover everything reachable without receiving mail.
 */

test.describe("Settings — Email to Dream Catcher", () => {
  test("degrades to a quiet message when the migration isn't applied yet (current baseline)", async ({
    page,
  }) => {
    await signUpFresh(page);
    await page.goto("/app/settings");

    const notSetUp = page.getByText("Not set up on this environment yet.");
    const addressCode = page.locator("code");
    // Whichever state this environment is actually in, the section must
    // render one of these two things — never a blank gap or a crash.
    await expect(notSetUp.or(addressCode.first())).toBeVisible();
  });

  test("shows the primary email, a copyable dream_handle address, and Pending primary status", async ({
    page,
  }) => {
    const owner = await signUpFresh(page);
    await page.goto("/app/settings");

    // The <section> wrapper, not just the heading's own title/description
    // div — Section() renders `<section><div>h2+p</div><div>{children}</div></section>`,
    // so `.locator("..")` from the heading lands one level too shallow to
    // reach the children div at all.
    const section = page
      .getByRole("heading", { name: "Email to Dream Catcher" })
      .locator("xpath=ancestor::section[1]");
    test.skip(
      !(await emailToDreamcatcherAvailable(page)),
      "Requires supabase/migrations/20261026120000_email_to_dreamcatcher.sql applied.",
    );

    // Scoped to the section rather than a bare getByText(email) — the page
    // header's "Signed in as <email>" subtitle contains the same text,
    // which would otherwise make this ambiguous.
    await expect(section.getByText(owner.email, { exact: true })).toBeVisible();
    await expect(page.getByText("Primary")).toBeVisible();
    // A brand-new account's primary email has never been verified.
    await expect(section.getByText("Pending").first()).toBeVisible();
    await expect(page.locator("code")).toContainText("@");
  });

  test("adding an address shows it as Pending and sends a verification email", async ({ page }) => {
    await signUpFresh(page);
    await page.goto("/app/settings");
    test.skip(
      !(await emailToDreamcatcherAvailable(page)),
      "Requires supabase/migrations/20261026120000_email_to_dreamcatcher.sql applied.",
    );

    const additional = `extra-${Date.now()}@example.invalid`;
    await page.getByLabel("Add another address").fill(additional);
    await page.getByRole("button", { name: /Add & send verification/ }).click();

    await expect(page.getByText(additional)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Verification email sent.")).toBeVisible();
  });

  test("rejects a duplicate additional address", async ({ page }) => {
    await signUpFresh(page);
    await page.goto("/app/settings");
    test.skip(
      !(await emailToDreamcatcherAvailable(page)),
      "Requires supabase/migrations/20261026120000_email_to_dreamcatcher.sql applied.",
    );

    const additional = `dup-${Date.now()}@example.invalid`;
    await page.getByLabel("Add another address").fill(additional);
    await page.getByRole("button", { name: /Add & send verification/ }).click();
    await expect(page.getByText(additional)).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Add another address").fill(additional);
    await page.getByRole("button", { name: /Add & send verification/ }).click();
    await expect(page.getByText(/can't be added/i)).toBeVisible();
  });

  test("rejects adding another user's primary email (no enumeration detail)", async ({
    page,
    browser,
  }) => {
    const other = await signUpFresh(page);
    await page.getByRole("button", { name: "Log out" }).click();

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await signUpFresh(secondPage);
    await secondPage.goto("/app/settings");
    test.skip(
      !(await emailToDreamcatcherAvailable(secondPage)),
      "Requires supabase/migrations/20261026120000_email_to_dreamcatcher.sql applied.",
    );

    await secondPage.getByLabel("Add another address").fill(other.email);
    await secondPage.getByRole("button", { name: /Add & send verification/ }).click();
    // Same generic message as the plain-duplicate case above — never reveals
    // that this specific address belongs to someone else's account.
    await expect(secondPage.getByText(/can't be added/i)).toBeVisible();
    await secondContext.close();
  });

  test("enforces the 2-additional-address limit", async ({ page }) => {
    await signUpFresh(page);
    await page.goto("/app/settings");
    test.skip(
      !(await emailToDreamcatcherAvailable(page)),
      "Requires supabase/migrations/20261026120000_email_to_dreamcatcher.sql applied.",
    );

    const stamp = Date.now();
    for (const n of [1, 2]) {
      await page.getByLabel("Add another address").fill(`limit-${stamp}-${n}@example.invalid`);
      await page.getByRole("button", { name: /Add & send verification/ }).click();
      await expect(page.getByText(`limit-${stamp}-${n}@example.invalid`)).toBeVisible({
        timeout: 10_000,
      });
    }

    await expect(
      page.getByText(/You've reached the limit of 2 additional addresses/i),
    ).toBeVisible();
    await expect(page.getByLabel("Add another address")).toBeDisabled();
  });

  test("removing an address frees up a slot", async ({ page }) => {
    await signUpFresh(page);
    await page.goto("/app/settings");
    test.skip(
      !(await emailToDreamcatcherAvailable(page)),
      "Requires supabase/migrations/20261026120000_email_to_dreamcatcher.sql applied.",
    );

    const additional = `removable-${Date.now()}@example.invalid`;
    await page.getByLabel("Add another address").fill(additional);
    await page.getByRole("button", { name: /Add & send verification/ }).click();
    await expect(page.getByText(additional)).toBeVisible({ timeout: 10_000 });

    const row = page.getByText(additional).locator("..").locator("..");
    await row.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();

    await expect(page.getByText(additional)).not.toBeVisible();
  });

  test("there is no Regenerate option for the dream_handle address (it's permanent)", async ({
    page,
  }) => {
    await signUpFresh(page);
    await page.goto("/app/settings");
    test.skip(
      !(await emailToDreamcatcherAvailable(page)),
      "Requires supabase/migrations/20261026120000_email_to_dreamcatcher.sql applied.",
    );

    await expect(page.getByRole("button", { name: /Regenerate/ })).not.toBeVisible();
  });

  test("a direct RPC call cannot retrieve a verification token (trust-boundary security regression)", async ({
    page,
    request,
  }) => {
    // The actual exploit this guards against: sender_email_add,
    // sender_email_resend, and primary_email_request_verification all mint
    // and return a raw verification token. If any of them were callable by
    // `authenticated`, a user could skip the app entirely, call the RPC
    // directly via Supabase's REST API with their own session token, and
    // self-verify an email address they don't control. This test performs
    // exactly that attack — signs in against Supabase Auth directly
    // (bypassing the Next.js app's Server Actions completely) and calls
    // each RPC over raw HTTP — and asserts it never gets a token back.
    const config = getPublicSupabaseConfig();
    test.skip(
      !config,
      "Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (.env.local) to run this check.",
    );

    const owner = await signUpFresh(page);

    const tokenRes = await request.post(`${config!.url}/auth/v1/token?grant_type=password`, {
      headers: { apikey: config!.anonKey, "content-type": "application/json" },
      data: { email: owner.email, password: owner.password },
    });
    expect(tokenRes.ok()).toBeTruthy();
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };
    expect(typeof accessToken).toBe("string");

    const attacks: Array<{ name: string; body: Record<string, unknown> }> = [
      { name: "sender_email_add", body: { p_email: "victim@example.invalid" } },
      {
        name: "sender_email_resend",
        body: { p_id: "00000000-0000-0000-0000-000000000000" },
      },
      { name: "primary_email_request_verification", body: {} },
    ];

    for (const attack of attacks) {
      const rpcRes = await request.post(`${config!.url}/rest/v1/rpc/${attack.name}`, {
        headers: {
          apikey: config!.anonKey,
          Authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        data: attack.body,
      });

      // Pre-migration: the function doesn't exist yet (404-ish). Post-
      // migration: it exists but is granted to service_role only, so a
      // plain authenticated caller is rejected before the function body
      // ever runs. Either way, a 200 with a token in the body would mean
      // the vulnerability is back.
      if (rpcRes.status() === 200) {
        const body = (await rpcRes.json().catch(() => null)) as { token?: unknown } | null;
        expect(body?.token, `${attack.name} must never return a token to a direct caller`).toBeUndefined();
      } else {
        expect([401, 403, 404]).toContain(rpcRes.status());
      }
    }
  });

  test("existing Email → Dream Catcher webhook endpoint still answers (regression)", async ({
    request,
  }) => {
    // Unsigned request. In a real deployment this must come back 401 (Svix
    // signature rejected) — confirming the route is live and the legacy
    // signature check wasn't disturbed by the alias-routing changes. Run
    // locally via `npm run start` (production mode, per playwright.config.ts)
    // without AWS credentials, getDreamcatcherSecrets() itself fails first
    // (pre-existing behavior, unrelated to this change — see
    // src/lib/secrets/dreamcatcher.ts) and the route answers 500 instead.
    // Accept either: both prove the endpoint is up and never reaches the
    // insert path on an unverified request, which is what this regression
    // check is actually for.
    const res = await request.post("/api/webhooks/resend", {
      data: { type: "email.received", data: {} },
      headers: { "content-type": "application/json" },
    });
    expect([401, 500]).toContain(res.status());
  });
});
