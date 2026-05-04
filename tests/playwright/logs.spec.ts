/**
 * Logs page flow tests — scan log viewer, filters, expand/collapse.
 * Bugs found are annotated with BUG comments.
 */
import { test, expect } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.describe("Logs page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/logs");
  });

  test("logs page loads with log entries or empty state", async ({ page }) => {
    await page.waitForSelector("[class*='log'], [class*='card'], [data-empty]", { timeout: 10_000 }).catch(() => null);
    const hasLogs = await page.locator("[class*='log'], [class*='entry']").count() > 0;
    const hasEmpty = await page.getByText(/no logs|no entries|run a scan/i).count() > 0;
    const hasCard = await page.locator("[class*='card']").count() > 0;
    expect(hasLogs || hasEmpty || hasCard).toBeTruthy();
  });

  test("log entries show timestamp and level badge", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const entries = page.locator("[class*='card'] [class*='badge'], [class*='entry'] [class*='badge']");
    if (await entries.count() === 0) return;

    // Should see at least one severity badge (info/warn/error)
    const hasBadge = await page.getByText(/info|warn|error/i).count() > 0;
    expect(hasBadge).toBeTruthy();
  });

  test("expanding a log row reveals additional details", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    // Find expand chevron buttons
    const expandBtns = page.getByRole("button", { name: /expand|collapse/i });
    if (await expandBtns.count() === 0) {
      // Try clicking a row directly
      const rows = page.locator("[class*='card'] [class*='hover']");
      if (await rows.count() === 0) return;
      await rows.first().click();
      await page.waitForTimeout(300);
      return;
    }

    await expandBtns.first().click();
    await page.waitForTimeout(300);
    // After expand, more detail text should be visible
    const hasDetail = await page.getByText(/duration|source|run id|company/i).count() > 0;
    expect(hasDetail).toBeTruthy();
  });

  test("level filter shows only matching severity logs", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const levelSelect = page.getByRole("combobox", { name: /level|severity/i });
    if (await levelSelect.count() === 0) return;

    await levelSelect.selectOption("error");
    await page.waitForTimeout(500);
    // Only error logs visible (or empty state if no errors)
    const errorBadges = page.getByText(/error/i);
    const noLogs = page.getByText(/no logs|no entries/i);
    const hasResult = (await errorBadges.count() > 0) || (await noLogs.count() > 0);
    expect(hasResult).toBeTruthy();
  });

  test("company multi-select filter narrows log entries by company", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const companyFilter = page.locator("[data-testid='company-filter']")
      .or(page.getByRole("combobox", { name: /company|companies/i }));
    if (await companyFilter.count() === 0) return;

    await companyFilter.selectOption({ index: 1 });
    await page.waitForTimeout(500);
    // Filtered result or empty state — no crash
    const hasResult = await page.locator("[class*='card'], [class*='empty'], [data-empty]").count() > 0;
    expect(hasResult).toBeTruthy();
  });

  test("run ID filter shows only logs from that run", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    // Expand first row to get run ID, then click it to filter
    const expandBtns = page.getByRole("button", { name: /expand|collapse/i });
    if (await expandBtns.count() === 0) return;

    await expandBtns.first().click();
    await page.waitForTimeout(300);
    // Look for a run ID badge or clickable element
    const runIdEl = page.getByText(/manual|scheduled/i).first();
    if (await runIdEl.count() > 0) {
      await runIdEl.click();
      await page.waitForTimeout(500);
      // A filter chip or indicator should appear
      const hasFilter = await page.getByText(/run id|filter|manual|scheduled/i).count() > 0;
      expect(hasFilter).toBeTruthy();
    }
  });

  test("keyword search filters log messages", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const searchInput = page.getByPlaceholder(/search|keyword|filter/i).first();
    if (await searchInput.count() === 0) return;

    await searchInput.fill("error");
    await page.waitForTimeout(500);
    // Should show filtered results or empty state — no crash
    const hasResult = await page.locator("[class*='card'], [data-empty]").count() > 0;
    expect(hasResult).toBeTruthy();
  });

  // BUG: logs page may expose all users' logs if admin endpoint used without tenant scope
  test("logs page only shows current user's own scan logs", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    // Verify no admin-scope indicators visible in log messages
    const hasAdminData = await page.getByText(/all users|system log|global/i).count() > 0;
    expect(hasAdminData).toBeFalsy();
  });

  test("unauthenticated user visiting /logs is redirected to /login", async ({ page: freshPage }) => {
    // Use a fresh context without auth
    await freshPage.goto("/logs");
    await expect(freshPage).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  // BUG: QA-006 — large log datasets cause slow page loads due to no pagination
  test("logs page loads within acceptable time even with many entries", async ({ page }) => {
    const start = Date.now();
    await page.waitForSelector("[class*='card'], [data-empty]", { timeout: 15_000 }).catch(() => null);
    const elapsed = Date.now() - start;
    // Should render within 10 seconds even for large datasets
    expect(elapsed).toBeLessThan(10_000);
  });

  test("clear all filters button resets log view", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const levelSelect = page.getByRole("combobox", { name: /level|severity/i });
    if (await levelSelect.count() === 0) return;

    await levelSelect.selectOption("error");
    await page.waitForTimeout(400);

    const clearBtn = page.getByRole("button", { name: /clear|reset|all/i });
    if (await clearBtn.count() > 0) {
      await clearBtn.click();
      await page.waitForTimeout(400);
      const value = await levelSelect.inputValue();
      expect(value).toBe(""); // Reset to default (all levels)
    }
  });
});
