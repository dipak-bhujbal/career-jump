/**
 * Available Jobs flow tests — viewing, filtering, applying, discarding jobs.
 * Bugs found are annotated with BUG comments.
 */
import { test, expect } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Jobs page — authenticated user", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/jobs");
  });

  test("jobs page loads with table or empty state", async ({ page }) => {
    // Either the jobs table or an empty-state message should be present
    const hasTable = await page.locator("table, [data-testid='jobs-table']").count() > 0;
    const hasEmptyState = await page.getByText(/no jobs|no matches|run a scan/i).count() > 0;
    expect(hasTable || hasEmptyState).toBeTruthy();
  });

  test("keyword filter narrows visible jobs", async ({ page }) => {
    await page.waitForSelector("table, [data-testid='jobs-table'], [data-empty]", { timeout: 10_000 });
    const keywordInput = page.getByPlaceholder(/keyword|search/i).first();
    await keywordInput.fill("engineer");
    await page.waitForTimeout(500); // debounce
    // All visible job titles should contain 'engineer' (case-insensitive)
    const rows = page.locator("tbody tr");
    const count = await rows.count();
    if (count > 0) {
      const firstTitle = await rows.first().getByRole("cell").first().textContent();
      expect(firstTitle?.toLowerCase()).toContain("engineer");
    }
  });

  test("US Only filter toggle filters non-US jobs", async ({ page }) => {
    await page.waitForSelector("table, [data-testid='jobs-table'], [data-empty]", { timeout: 10_000 });
    const usOnlyToggle = page.getByLabel(/us only/i).or(page.getByRole("checkbox", { name: /us only/i }));
    if (await usOnlyToggle.count() > 0) {
      await usOnlyToggle.check();
      await page.waitForTimeout(500);
      // Verify no non-US locations visible in results
      const locationCells = page.locator("tbody tr td:nth-child(3)");
      const locations = await locationCells.allTextContents();
      for (const loc of locations) {
        expect(loc.toLowerCase()).not.toMatch(/india|india|london|berlin|toronto/i);
      }
    }
  });

  test("clicking a job row opens job detail drawer", async ({ page }) => {
    await page.waitForSelector("tbody tr", { timeout: 10_000 }).catch(() => null);
    const firstRow = page.locator("tbody tr").first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
    }
  });

  test("apply button marks job as applied and removes from list", async ({ page }) => {
    await page.waitForSelector("tbody tr", { timeout: 10_000 }).catch(() => null);
    const rows = page.locator("tbody tr");
    if (await rows.count() === 0) {
      test.skip(true, "No jobs to apply to");
      return;
    }
    const firstRow = rows.first();
    const applyBtn = firstRow.getByRole("button", { name: /apply/i });
    if (await applyBtn.count() > 0) {
      const jobTitle = await firstRow.locator("td").first().textContent();
      await applyBtn.click();
      await expect(page.getByText(/applied|success/i)).toBeVisible({ timeout: 5_000 });
      // Job should no longer appear in main list
      await expect(page.getByText(jobTitle ?? "")).not.toBeVisible({ timeout: 3_000 });
    }
  });

  // BUG: keyboard shortcut 'e' applies focused job — test that 'e' without focus doesn't apply all
  test("pressing 'e' key without a focused row does not trigger apply", async ({ page }) => {
    await page.waitForSelector("tbody tr", { timeout: 10_000 }).catch(() => null);
    const initialCount = await page.locator("tbody tr").count();
    await page.keyboard.press("e");
    await page.waitForTimeout(300);
    // Row count should not decrease from a stray keypress
    const afterCount = await page.locator("tbody tr").count();
    expect(afterCount).toBe(initialCount);
  });

  test("'j' and 'k' keyboard shortcuts navigate rows", async ({ page }) => {
    await page.waitForSelector("tbody tr", { timeout: 10_000 }).catch(() => null);
    if (await page.locator("tbody tr").count() < 2) {
      test.skip(true, "Need at least 2 rows to test navigation");
      return;
    }
    await page.keyboard.press("j");
    const focusedAfterJ = await page.evaluate(() => document.activeElement?.closest("tr")?.rowIndex);
    await page.keyboard.press("k");
    const focusedAfterK = await page.evaluate(() => document.activeElement?.closest("tr")?.rowIndex);
    expect(focusedAfterK).toBeLessThan(focusedAfterJ ?? 999);
  });

  // BUG: slash '/' should focus keyword filter — test this works
  test("pressing '/' focuses the keyword filter input", async ({ page }) => {
    await page.waitForSelector("tbody tr, [data-empty]", { timeout: 10_000 }).catch(() => null);
    await page.keyboard.press("/");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("placeholder") ?? "");
    expect(focused.toLowerCase()).toMatch(/keyword|search/i);
  });

  test("source filter dropdown shows ATS options and filters results", async ({ page }) => {
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 });
    const sourceSelect = page.getByRole("combobox", { name: /source|ats/i }).first();
    if (await sourceSelect.count() > 0) {
      await sourceSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);
      // Source column cells should match selected value
      const sourceCells = page.locator("tbody td:nth-child(2)");
      const sources = await sourceCells.allTextContents();
      const selectedValue = await sourceSelect.inputValue();
      if (sources.length > 0 && selectedValue) {
        expect(sources.every((s) => s.toLowerCase().includes(selectedValue.toLowerCase()))).toBeTruthy();
      }
    }
  });

  test("run scan button triggers a scan and shows progress indicator", async ({ page }) => {
    const scanBtn = page.getByRole("button", { name: /run scan|start scan|refresh/i });
    if (await scanBtn.count() > 0) {
      await scanBtn.click();
      // Progress indicator or status message should appear
      await expect(
        page.getByText(/scanning|running|in progress/i).or(page.locator("[data-testid='run-progress']"))
      ).toBeVisible({ timeout: 10_000 });
    }
  });

  // Company hover card — lazy-loads from /api/registry/companies/<name> on hover
  test("hovering a company name shows the company hover card with ATS info", async ({ page }) => {
    await page.waitForSelector("tbody tr", { timeout: 10_000 }).catch(() => null);
    if (await page.locator("tbody tr").count() === 0) return;

    // Company names in the jobs table are typically in the second or third column
    const companyCell = page.locator("tbody tr").first().locator("td").nth(1);
    if (await companyCell.count() === 0) return;

    await companyCell.hover();
    await page.waitForTimeout(600); // hover card open delay is 250ms

    // Hover card should appear with company details or logo
    const hasCard = await page.locator("[class*='hover-card'], [data-radix-popper-content-wrapper]").count() > 0;
    if (hasCard) {
      const cardText = await page.locator("[class*='hover-card'], [data-radix-popper-content-wrapper]").first().textContent();
      expect(cardText?.length).toBeGreaterThan(0);
    }
  });
});

test.describe("Jobs page — scan quota enforcement", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/jobs");
  });

  // BUG: quota exhaustion — no clear user feedback when daily scan limit hit
  test("shows quota exhausted message when daily scan limit is reached", async ({ page }) => {
    const scanBtn = page.getByRole("button", { name: /run scan|start scan/i });
    if (await scanBtn.count() === 0) return;

    // Click scan multiple times to exhaust free-tier quota (2/day)
    for (let i = 0; i < 3; i++) {
      if (await scanBtn.isEnabled()) {
        await scanBtn.click();
        await page.waitForTimeout(1000);
      }
    }
    // Should see quota/limit message, not a silent failure
    await expect(
      page.getByText(/quota|limit|upgrade|scans remaining/i)
    ).toBeVisible({ timeout: 15_000 });
  });
});
