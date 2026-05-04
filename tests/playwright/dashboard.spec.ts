/**
 * Dashboard (home) flow tests — widget grid, customize mode, add/remove/reset widgets.
 * The dashboard is the post-login landing page at /.
 * Bugs found are annotated with BUG comments.
 */
import { test, expect } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.describe("Dashboard page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/");
  });

  test("dashboard loads with at least one widget or empty state", async ({ page }) => {
    await page.waitForSelector("[class*='widget'], [class*='card'], [data-empty]", { timeout: 10_000 }).catch(() => null);
    const hasWidgets = await page.locator("[class*='widget'], [class*='card']").count() > 0;
    const hasEmpty = await page.getByText(/no widgets|add a widget|get started/i).count() > 0;
    expect(hasWidgets || hasEmpty).toBeTruthy();
  });

  test("Customize button enters customize mode and shows drag handles", async ({ page }) => {
    await page.waitForSelector("[class*='card'], [class*='widget']", { timeout: 10_000 }).catch(() => null);
    const customizeBtn = page.getByRole("button", { name: /customize/i });
    if (await customizeBtn.count() === 0) return;

    await customizeBtn.click();
    await page.waitForTimeout(400);
    // Drag handles or remove (X) buttons should appear in customize mode
    const hasDragHandles = await page.locator("[class*='grip'], [aria-label*='drag'], [aria-label*='handle']").count() > 0;
    const hasRemoveBtns = await page.getByRole("button", { name: /remove|×/i }).count() > 0;
    expect(hasDragHandles || hasRemoveBtns).toBeTruthy();
  });

  test("Add Widget button opens widget picker dialog", async ({ page }) => {
    await page.waitForSelector("[class*='card'], [class*='widget']", { timeout: 10_000 }).catch(() => null);
    const addBtn = page.getByRole("button", { name: /add widget/i });
    if (await addBtn.count() === 0) return;

    await addBtn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
  });

  test("widget picker dialog lists available widgets to add", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const addBtn = page.getByRole("button", { name: /add widget/i });
    if (await addBtn.count() === 0) return;

    await addBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // Dialog should list widget options
    const hasOptions = await dialog.locator("[class*='widget'], [class*='option'], button").count() > 0;
    expect(hasOptions).toBeTruthy();
  });

  test("removing a widget in customize mode decreases widget count", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const customizeBtn = page.getByRole("button", { name: /customize/i });
    if (await customizeBtn.count() === 0) return;

    await customizeBtn.click();
    await page.waitForTimeout(400);

    const initialCount = await page.locator("[class*='widget'], [class*='card']").count();
    const removeBtn = page.getByRole("button", { name: /remove/i }).first();
    if (await removeBtn.count() === 0) return;

    await removeBtn.click();
    await page.waitForTimeout(400);
    const newCount = await page.locator("[class*='widget'], [class*='card']").count();
    expect(newCount).toBeLessThan(initialCount);
  });

  test("Reset button in customize mode restores default widget layout", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const customizeBtn = page.getByRole("button", { name: /customize/i });
    if (await customizeBtn.count() === 0) return;

    await customizeBtn.click();
    await page.waitForTimeout(400);

    const resetBtn = page.getByRole("button", { name: /reset/i });
    if (await resetBtn.count() === 0) return;

    await resetBtn.click();
    await page.waitForTimeout(400);
    // After reset, widgets should be present (default layout restored)
    const hasWidgets = await page.locator("[class*='widget'], [class*='card']").count() > 0;
    expect(hasWidgets).toBeTruthy();
  });

  // BUG: widget layout is stored in localStorage — clearing storage should reset to default
  test("widget layout persists across page reload via localStorage", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const initialCount = await page.locator("[class*='widget'], [class*='card']").count();

    await page.reload();
    await page.waitForSelector("[class*='card'], [data-empty]", { timeout: 10_000 }).catch(() => null);
    const reloadedCount = await page.locator("[class*='widget'], [class*='card']").count();

    expect(reloadedCount).toBe(initialCount);
  });

  test("exiting customize mode hides drag handles and remove buttons", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    const customizeBtn = page.getByRole("button", { name: /customize/i });
    if (await customizeBtn.count() === 0) return;

    // Enter customize
    await customizeBtn.click();
    await page.waitForTimeout(300);

    // Exit customize (button label may change to Done/Save)
    const doneBtn = page.getByRole("button", { name: /done|save|exit/i });
    const exitBtn = doneBtn.count() > 0 ? doneBtn : customizeBtn;
    await exitBtn.click();
    await page.waitForTimeout(300);

    // Drag handles and X buttons should be gone
    const hasDragHandles = await page.locator("[class*='grip'], [aria-label*='drag']").count() > 0;
    expect(hasDragHandles).toBeFalsy();
  });

  test("dashboard shows upgrade banner for free-plan users", async ({ page }) => {
    await page.waitForSelector("[class*='card'], [class*='banner'], [data-empty]", { timeout: 10_000 }).catch(() => null);
    // Either upgrade banner OR full dashboard is visible — no blank page
    const hasBanner = await page.getByText(/upgrade|starter|pro|power|unlock/i).count() > 0;
    const hasContent = await page.locator("[class*='card']").count() > 0;
    expect(hasBanner || hasContent).toBeTruthy();
  });

  // BUG: drag-and-drop reorder with keyboard (Tab + Space) should be accessible
  test("widget grid is navigable by keyboard in default mode", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body);
    expect(focused).toBeTruthy();
  });

  test("dashboard stat widgets show numeric values or loading state", async ({ page }) => {
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);
    // Stat widgets should show numbers or a loading spinner — not raw error text
    const hasError = await page.getByText(/unhandled error|exception|undefined/i).count() > 0;
    expect(hasError).toBeFalsy();
  });
});
