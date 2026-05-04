/**
 * Route-guard coverage for edge-case navigation paths that frequently regress
 * when auth/public-route matching is implemented with string-prefix checks.
 */
import { expect, test } from "@playwright/test";
import { TEST_USER, loginAs, logout } from "./helpers/auth";

test.describe("Public route boundaries", () => {
  test("non-public lookalike auth paths do not bypass the auth gate", async ({ page }) => {
    await page.goto("/login-anything");

    // Lookalike paths should not inherit public access just because they share
    // a prefix with a real auth route like /login.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("non-public lookalike forgot-password paths do not bypass the auth gate", async ({ page }) => {
    await page.goto("/forgot-password-anything");

    // This closes the same prefix-matching hole for account-recovery routes.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("non-public lookalike privacy paths do not bypass the auth gate", async ({ page }) => {
    await page.goto("/privacy-anything");

    // Privacy is public, but only on the exact route. Prefix-matched lookalike
    // paths should still be treated as protected app routes.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("non-public lookalike signup paths do not bypass the auth gate", async ({ page }) => {
    await page.goto("/signup-anything");

    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("non-public lookalike verify-email paths do not bypass the auth gate", async ({ page }) => {
    await page.goto("/verify-email-anything");

    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });
});

test.describe("Post-logout protection", () => {
  test("logging out restores the protected-route guard", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await logout(page);
    await page.goto("/jobs");

    // A fresh logout should prevent stale client state from leaving protected
    // routes visible to a signed-out user.
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
