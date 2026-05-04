/**
 * Admin/auth flow coverage focused on real user-visible regressions.
 *
 * These tests intentionally exercise flows that are easy to break during
 * routing/auth changes and that have already shown bugs during manual review.
 */
import { expect, test } from "@playwright/test";
import { TEST_ADMIN, TEST_USER, loginAs } from "./helpers/auth";

test.describe("Admin auth routing", () => {
  test("unauthenticated admin route redirect preserves admin login mode", async ({ page }) => {
    await page.goto("/admin-users");

    // Functional expectation: deep-linking into an admin route while signed
    // out should land on the admin login flow, not the standard user login.
    await expect(page).toHaveURL(/\/login\?admin=1/, { timeout: 10_000 });
    await expect(page.getByText(/isolated admin cognito pool|admin sign in/i)).toBeVisible();
  });

  test("explicit admin login mode keeps admin forgot-password route", async ({ page }) => {
    await page.goto("/login?admin=1");

    const forgotLink = page.getByRole("link", { name: /forgot password/i });
    await expect(forgotLink).toHaveAttribute("href", "/forgot-password?admin=1");
  });
});

test.describe("Admin access boundaries", () => {
  test("standard user cannot use admin workspace after login", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/admin-users");

    await expect(page.getByText(/admin access required|only available to admin accounts/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("admin login route can authenticate an admin account", async ({ page }) => {
    await loginAs(page, TEST_ADMIN, true);

    await expect(page).toHaveURL("/");
  });
});

test.describe("Public account-recovery UX", () => {
  test("admin forgot-password page keeps admin context in success flow", async ({ page }) => {
    await page.goto("/forgot-password?admin=1");
    await page.getByLabel(/email address/i).fill(TEST_ADMIN.email);
    await page.getByRole("button", { name: /send reset code/i }).click();

    // The reset flow should remain clearly scoped to the admin pool so the
    // operator is not silently moved into the standard user account flow.
    await expect(page.getByText(new RegExp(TEST_ADMIN.email, "i"))).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/admin/i)).toBeVisible();
  });
});
