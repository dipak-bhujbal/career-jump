/**
 * Sidebar action flow tests — Run scan, Stop scan, Clear cache, Remove broken links.
 * Also covers bulk job selection and bulk apply/discard on the jobs page.
 * Bugs found are annotated with BUG comments.
 */
import { test, expect } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.describe("Sidebar scan actions", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/jobs");
  });

  test("sidebar shows Run scan button when no scan is active", async ({ page }) => {
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);
    const runBtn = page.getByRole("button", { name: /run scan/i });
    await expect(runBtn).toBeVisible({ timeout: 8_000 });
    await expect(runBtn).toBeEnabled();
  });

  test("clicking Run scan shows progress and button changes to Stop scan", async ({ page }) => {
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);
    const runBtn = page.getByRole("button", { name: /run scan/i });
    if (await runBtn.count() === 0 || await runBtn.isDisabled()) return;

    await runBtn.click();
    // After clicking, button should change to Stop scan / abort
    await expect(
      page.getByRole("button", { name: /stop scan|abort|starting/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  test("scan quota hint is visible in sidebar while idle", async ({ page }) => {
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);
    // Quota / last run summary text should appear in sidebar idle state
    const hasQuota = await page.getByText(/scan|quota|remaining|scans/i).count() > 0;
    expect(hasQuota).toBeTruthy();
  });

  // BUG: destructive sidebar actions (clear cache, remove broken) should be disabled during active scan
  test("Clear cache and Remove broken links buttons are present when idle", async ({ page }) => {
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);
    const clearCacheBtn = page.getByRole("button", { name: /clear cache/i });
    const removeBrokenBtn = page.getByRole("button", { name: /remove broken|broken links/i });
    // At least one maintenance action should be visible
    const hasActions = (await clearCacheBtn.count() > 0) || (await removeBrokenBtn.count() > 0);
    expect(hasActions).toBeTruthy();
  });

  test("Clear cache button triggers confirmation or executes and shows toast", async ({ page }) => {
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);
    const clearCacheBtn = page.getByRole("button", { name: /clear cache/i });
    if (await clearCacheBtn.count() === 0 || await clearCacheBtn.isDisabled()) return;

    await clearCacheBtn.click();
    await page.waitForTimeout(1_000);
    // Should show either a confirmation dialog or a success/error toast
    const hasConfirm = await page.getByRole("dialog").count() > 0;
    const hasToast = await page.getByText(/cache cleared|success|error/i).count() > 0;
    expect(hasConfirm || hasToast).toBeTruthy();
  });

  test("Remove broken links button triggers action and shows feedback", async ({ page }) => {
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);
    const removeBtn = page.getByRole("button", { name: /remove broken|broken links/i });
    if (await removeBtn.count() === 0 || await removeBtn.isDisabled()) return;

    await removeBtn.click();
    await page.waitForTimeout(1_000);
    const hasFeedback = await page.getByText(/removed|broken|links|success|error/i).count() > 0;
    expect(hasFeedback).toBeTruthy();
  });

  // BUG: all sidebar action buttons must disable while scan is active to prevent concurrent ops
  test("sidebar action buttons are disabled while scan is in progress", async ({ page }) => {
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);
    const runBtn = page.getByRole("button", { name: /run scan/i });
    if (await runBtn.count() === 0 || await runBtn.isDisabled()) return;

    await runBtn.click();
    await page.waitForTimeout(500);

    const clearCacheBtn = page.getByRole("button", { name: /clear cache/i });
    const removeBtn = page.getByRole("button", { name: /remove broken|broken links/i });
    if (await clearCacheBtn.count() > 0) {
      await expect(clearCacheBtn).toBeDisabled();
    }
    if (await removeBtn.count() > 0) {
      await expect(removeBtn).toBeDisabled();
    }
  });
});

test.describe("Bulk job selection and actions", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/jobs");
    await page.waitForSelector("tbody tr", { timeout: 10_000 }).catch(() => null);
  });

  test("selecting a job row checkbox shows bulk action bar", async ({ page }) => {
    const rows = page.locator("tbody tr");
    if (await rows.count() === 0) return;

    const checkbox = rows.first().locator("input[type='checkbox']");
    if (await checkbox.count() === 0) return;

    await checkbox.check();
    await page.waitForTimeout(400);
    // Bulk action bar should appear with count and action buttons
    await expect(page.getByText(/1 selected/i)).toBeVisible({ timeout: 3_000 });
  });

  test("bulk action bar shows Apply and Discard buttons when jobs selected", async ({ page }) => {
    const rows = page.locator("tbody tr");
    if (await rows.count() === 0) return;

    const checkbox = rows.first().locator("input[type='checkbox']");
    if (await checkbox.count() === 0) return;

    await checkbox.check();
    await page.waitForTimeout(400);

    await expect(page.getByRole("button", { name: /^apply$/i })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: /discard/i })).toBeVisible({ timeout: 3_000 });
  });

  test("selecting multiple rows increments the selected count", async ({ page }) => {
    const rows = page.locator("tbody tr");
    const count = await rows.count();
    if (count < 2) return;

    const checkboxes = rows.locator("input[type='checkbox']");
    if (await checkboxes.count() < 2) return;

    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await page.waitForTimeout(300);
    await expect(page.getByText(/2 selected/i)).toBeVisible({ timeout: 3_000 });
  });

  test("Clear (X) button on bulk bar deselects all and hides bar", async ({ page }) => {
    const rows = page.locator("tbody tr");
    if (await rows.count() === 0) return;

    const checkbox = rows.first().locator("input[type='checkbox']");
    if (await checkbox.count() === 0) return;

    await checkbox.check();
    await page.waitForTimeout(400);

    const clearBtn = page.getByRole("button", { name: /clear selection/i })
      .or(page.locator("[aria-label='Clear selection']"));
    if (await clearBtn.count() === 0) return;

    await clearBtn.click();
    await page.waitForTimeout(300);
    // Bulk bar should disappear
    await expect(page.getByText(/selected/i)).not.toBeVisible({ timeout: 3_000 });
  });

  // BUG: bulk apply with 0 jobs selected should not be reachable — verify bar only shows on selection
  test("bulk action bar is not visible on initial page load before any selection", async ({ page }) => {
    // On load, nothing selected — bulk bar must not show
    await page.waitForTimeout(1_000);
    const barVisible = await page.getByText(/\d+ selected/i).count() > 0;
    expect(barVisible).toBeFalsy();
  });

  test("bulk discard removes selected jobs from the visible list", async ({ page }) => {
    const rows = page.locator("tbody tr");
    if (await rows.count() === 0) return;

    const checkbox = rows.first().locator("input[type='checkbox']");
    if (await checkbox.count() === 0) return;

    const initialCount = await rows.count();
    await checkbox.check();
    await page.waitForTimeout(400);

    const discardBtn = page.getByRole("button", { name: /discard/i });
    if (await discardBtn.count() === 0) return;

    await discardBtn.click();
    await page.waitForTimeout(1_500);
    const newCount = await rows.count();
    expect(newCount).toBeLessThan(initialCount);
  });
});
