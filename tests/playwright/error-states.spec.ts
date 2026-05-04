/**
 * Error state and network failure tests — verifies the app shows graceful
 * degradation instead of blank pages or unhandled JS errors when API calls fail.
 * Uses Playwright route interception to simulate server errors.
 */
import { test, expect } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.describe("API error states — jobs page", () => {
  test("jobs page shows error state when /api/jobs returns 500", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.route("**/api/jobs**", (route) => route.fulfill({ status: 500, body: "Internal Server Error" }));
    await page.goto("/jobs");
    await page.waitForTimeout(3_000);
    // Should show error message or empty state — never a blank page or raw JS error
    const hasError = await page.getByText(/error|failed|unavailable|try again/i).count() > 0;
    const hasEmpty = await page.getByText(/no jobs|no matches/i).count() > 0;
    const hasTable = await page.locator("table").count() > 0;
    expect(hasError || hasEmpty || hasTable).toBeTruthy();
    // Must not show unhandled exception text
    const hasUnhandled = await page.getByText(/unhandled|undefined is not|cannot read/i).count() > 0;
    expect(hasUnhandled).toBeFalsy();
  });

  test("jobs page shows error state when /api/jobs returns 401 (session expired)", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.route("**/api/jobs**", (route) => route.fulfill({ status: 401, body: JSON.stringify({ error: "Unauthorized" }) }));
    await page.goto("/jobs");
    await page.waitForTimeout(3_000);
    // Should either redirect to login or show an auth-related error
    const isRedirected = page.url().includes("/login");
    const hasAuthError = await page.getByText(/sign in|unauthorized|session/i).count() > 0;
    const hasAnyContent = await page.locator("[class*='card'], table, [data-empty]").count() > 0;
    expect(isRedirected || hasAuthError || hasAnyContent).toBeTruthy();
  });
});

test.describe("API error states — dashboard", () => {
  test("dashboard shows graceful error when /api/dashboard returns 500", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.route("**/api/dashboard**", (route) => route.fulfill({ status: 500, body: "Internal Server Error" }));
    await page.goto("/");
    await page.waitForTimeout(3_000);
    const hasError = await page.getByText(/error|failed|unavailable/i).count() > 0;
    const hasContent = await page.locator("[class*='card'], [class*='widget']").count() > 0;
    // No blank page — either error or content renders
    expect(hasError || hasContent).toBeTruthy();
    const hasUnhandled = await page.getByText(/undefined is not|cannot read|unhandled/i).count() > 0;
    expect(hasUnhandled).toBeFalsy();
  });
});

test.describe("API error states — configuration", () => {
  test("configuration page shows error when /api/configuration returns 500", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.route("**/api/configuration**", (route) => route.fulfill({ status: 500, body: "Internal Server Error" }));
    await page.goto("/configuration");
    await page.waitForTimeout(3_000);
    const hasError = await page.getByText(/error|failed|unavailable/i).count() > 0;
    const hasContent = await page.locator("table, [class*='card']").count() > 0;
    expect(hasError || hasContent).toBeTruthy();
  });
});

test.describe("API error states — admin panel", () => {
  test("admin dashboard shows graceful error when /api/admin returns 500", async ({ page }) => {
    await loginAs(page, TEST_USER);
    // Admin routes may redirect non-admin users — test that no crash occurs either way
    await page.route("**/api/admin/**", (route) => route.fulfill({ status: 500, body: "Internal Server Error" }));
    await page.goto("/admin");
    await page.waitForTimeout(3_000);
    const hasUnhandled = await page.getByText(/undefined is not|cannot read|unhandled exception/i).count() > 0;
    expect(hasUnhandled).toBeFalsy();
  });
});

test.describe("Network offline simulation", () => {
  test("app shows offline indicator or error when network is unavailable", async ({ page, context }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/jobs");
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);

    // Take the browser offline
    await context.setOffline(true);

    // Trigger a data refresh (click run scan or navigate)
    const scanBtn = page.getByRole("button", { name: /run scan/i });
    if (await scanBtn.count() > 0 && await scanBtn.isEnabled()) {
      await scanBtn.click();
      await page.waitForTimeout(2_000);
      // Should show an error — not silently succeed or hang forever
      const hasError = await page.getByText(/failed|error|offline|network/i).count() > 0;
      expect(hasError).toBeTruthy();
    }

    // Restore network
    await context.setOffline(false);
  });

  test("previously loaded jobs remain visible after going offline", async ({ page, context }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/jobs");
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);

    const initialRowCount = await page.locator("tbody tr").count();
    if (initialRowCount === 0) return;

    // Go offline — React Query cache should keep rows visible
    await context.setOffline(true);
    await page.waitForTimeout(500);

    const offlineRowCount = await page.locator("tbody tr").count();
    // Cached data should still be visible
    expect(offlineRowCount).toBe(initialRowCount);

    await context.setOffline(false);
  });
});

test.describe("404 and unknown routes", () => {
  test("navigating to an unknown route shows 404 or redirects gracefully", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/this-route-does-not-exist-at-all");
    await page.waitForTimeout(2_000);
    // Should show 404 page, redirect to /, or show nav — never a blank white page
    const has404 = await page.getByText(/404|not found|page doesn't exist/i).count() > 0;
    const isRedirected = page.url().endsWith("/") || page.url().includes("/jobs");
    const hasNav = await page.locator("[class*='sidebar'], [class*='nav'], [class*='topbar']").count() > 0;
    expect(has404 || isRedirected || hasNav).toBeTruthy();
  });

  test("unauthenticated 404 route redirects to login not a blank page", async ({ page }) => {
    await page.goto("/this-route-does-not-exist-at-all");
    await page.waitForTimeout(2_000);
    const isOnLogin = page.url().includes("/login");
    const has404 = await page.getByText(/404|not found/i).count() > 0;
    expect(isOnLogin || has404).toBeTruthy();
  });
});
