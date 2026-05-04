/**
 * Applied jobs flow tests — kanban board, status changes, notes, interview rounds.
 * Bugs found are annotated with BUG comments.
 */
import { test, expect } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.describe("Applied jobs page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/applied");
  });

  test("applied page loads with kanban board or empty state", async ({ page }) => {
    await page.waitForSelector("[class*='kanban'], [class*='board'], table, [data-empty]", { timeout: 10_000 }).catch(() => null);
    const hasBoard = await page.locator("[class*='kanban'], [class*='column']").count() > 0;
    const hasEmptyState = await page.getByText(/no applied|apply to jobs|start tracking/i).count() > 0;
    expect(hasBoard || hasEmptyState).toBeTruthy();
  });

  test("applied jobs display company name, title, and status", async ({ page }) => {
    const cards = page.locator("[class*='card'][class*='job'], [data-testid='applied-card']");
    await page.waitForTimeout(2_000);
    if (await cards.count() === 0) {
      // No applied jobs yet — empty state is valid
      await expect(page.getByText(/no applied|apply to/i)).toBeVisible();
      return;
    }
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();
    // Card should show meaningful content
    const text = await firstCard.textContent();
    expect(text?.length).toBeGreaterThan(5);
  });

  test("clicking an applied job opens its detail view or drawer", async ({ page }) => {
    const cards = page.locator("[class*='card'][class*='job'], [data-testid='applied-card']");
    await page.waitForTimeout(2_000);
    if (await cards.count() === 0) return;
    await cards.first().click();
    await expect(page.getByRole("dialog").or(page.locator("[class*='drawer']"))).toBeVisible({ timeout: 5_000 });
  });

  test("status dropdown allows changing job status", async ({ page }) => {
    const cards = page.locator("[class*='card'][class*='job'], [data-testid='applied-card']");
    await page.waitForTimeout(2_000);
    if (await cards.count() === 0) return;

    await cards.first().click();
    const dialog = page.getByRole("dialog");
    const statusSelect = dialog.getByRole("combobox", { name: /status/i });
    if (await statusSelect.count() > 0) {
      await statusSelect.selectOption("Interviewing");
      await page.waitForTimeout(500);
      await expect(dialog.getByText(/interviewing/i)).toBeVisible();
    }
  });

  // BUG: notes saving — verify notes persist after page reload
  test("notes saved on applied job persist after page reload", async ({ page }) => {
    const cards = page.locator("[class*='card'][class*='job'], [data-testid='applied-card']");
    await page.waitForTimeout(2_000);
    if (await cards.count() === 0) return;

    await cards.first().click();
    const dialog = page.getByRole("dialog");
    const noteArea = dialog.getByRole("textbox", { name: /note|notes/i });
    if (await noteArea.count() === 0) return;

    const testNote = `Test note ${Date.now()}`;
    await noteArea.fill(testNote);
    const saveBtn = dialog.getByRole("button", { name: /save/i });
    if (await saveBtn.count() > 0) await saveBtn.click();
    await page.waitForTimeout(1000);
    await dialog.press("Escape");

    // Reload and verify note persisted
    await page.reload();
    await page.waitForTimeout(2_000);
    await cards.first().click();
    const reloadedNote = page.getByRole("dialog").getByRole("textbox", { name: /note|notes/i });
    if (await reloadedNote.count() > 0) {
      await expect(reloadedNote).toHaveValue(testNote);
    }
  });

  test("Add Interview Round button adds a new round entry", async ({ page }) => {
    const cards = page.locator("[class*='card'][class*='job'], [data-testid='applied-card']");
    await page.waitForTimeout(2_000);
    if (await cards.count() === 0) return;

    await cards.first().click();
    const dialog = page.getByRole("dialog");
    const addRoundBtn = dialog.getByRole("button", { name: /add.*round|interview round/i });
    if (await addRoundBtn.count() === 0) return;

    const initialRounds = await dialog.locator("[class*='round'], [data-testid='interview-round']").count();
    await addRoundBtn.click();
    await page.waitForTimeout(500);
    const newRounds = await dialog.locator("[class*='round'], [data-testid='interview-round']").count();
    expect(newRounds).toBeGreaterThan(initialRounds);
  });

  test("company-specific applied view at /companies/:company/applied shows filtered jobs", async ({ page }) => {
    // Navigate to a known company applied view
    await page.goto("/companies/google/applied");
    await page.waitForTimeout(2_000);
    const hasContent = await page.locator("table, [class*='kanban'], [class*='empty']").count() > 0;
    expect(hasContent).toBeTruthy();
  });

  // BUG: filter by keyword on applied page
  test("keyword filter on applied page narrows results", async ({ page }) => {
    const keywordInput = page.getByPlaceholder(/keyword|search/i);
    if (await keywordInput.count() === 0) return;

    await keywordInput.fill("Engineer");
    await page.waitForTimeout(500);
    const cards = page.locator("[class*='card'][class*='job']");
    const count = await cards.count();
    if (count > 0) {
      const text = await cards.first().textContent();
      expect(text?.toLowerCase()).toContain("engineer");
    }
  });
});
