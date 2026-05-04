/**
 * Functional user coverage for profile, settings, and support-entry flows.
 *
 * These tests stay at the user-behavior layer and avoid app-code assumptions
 * beyond visible route structure and control labels.
 */
import { expect, test } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.describe("Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/settings");
  });

  test("settings page shows notification preferences and save action", async ({ page }) => {
    await expect(page.getByText(/email notifications/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/new jobs alert/i)).toBeVisible();
    await expect(page.getByText(/weekly digest/i)).toBeVisible();
    await expect(page.getByText(/application status updates/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /save preferences/i })).toBeVisible();
  });

  test("saving notification preferences surfaces success feedback", async ({ page }) => {
    const weeklyDigestSwitch = page.getByRole("switch").nth(1);
    await weeklyDigestSwitch.click();
    await page.getByRole("button", { name: /save preferences/i }).click();

    await expect(page.getByText(/notification preferences saved/i)).toBeVisible({ timeout: 10_000 });
  });

  test("saved notification preferences persist across page reload", async ({ page }) => {
    const weeklyDigestSwitch = page.getByRole("switch").nth(1);
    const before = await weeklyDigestSwitch.getAttribute("aria-checked");

    await weeklyDigestSwitch.click();
    await page.getByRole("button", { name: /save preferences/i }).click();
    await expect(page.getByText(/notification preferences saved/i)).toBeVisible({ timeout: 10_000 });

    await page.reload();

    // Settings are written to localStorage, so a saved preference should come
    // back with the same switch state after a full reload.
    await expect(weeklyDigestSwitch).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  });

  test("privacy link is available from settings about card", async ({ page }) => {
    const privacyLink = page.getByRole("link", { name: /privacy policy/i });
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveAttribute("href", "/privacy");
  });

  test("settings about card shows shipped version and infrastructure details", async ({ page }) => {
    await expect(page.getByText(/version/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/aws lambda/i)).toBeVisible();
    await expect(page.getByText(/log retention/i)).toBeVisible();
  });
});

test.describe("Profile page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/profile");
  });

  test("profile page exposes core sections", async ({ page }) => {
    await expect(page.getByText(/account/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/subscription/i).first()).toBeVisible();
    await expect(page.getByText(/password/i).first()).toBeVisible();
    await expect(page.getByText(/support/i).first()).toBeVisible();
    await expect(page.getByText(/danger zone/i).first()).toBeVisible();
  });

  test("profile export section is reachable and shows export action", async ({ page }) => {
    await page.getByText(/danger zone/i).first().click();

    await expect(page.getByText(/export my data/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /export data/i })).toBeVisible();
  });

  test("account section save action stays disabled until profile data changes", async ({ page }) => {
    const saveButton = page.getByRole("button", { name: /save changes/i });
    await expect(saveButton).toBeDisabled();

    const usernameInput = page.getByPlaceholder(/your display name/i);
    const original = await usernameInput.inputValue();
    await usernameInput.fill(`${original} updated`);

    // The profile form should only become actionable once there is an actual
    // user edit, otherwise the page encourages no-op saves.
    await expect(saveButton).toBeEnabled();
  });

  test("password tab deep-link lands on the password section", async ({ page }) => {
    await page.goto("/profile?tab=password");

    await expect(page.getByText(/change password/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /update password/i })).toBeVisible();
  });

  test("password section shows mismatch feedback before submit", async ({ page }) => {
    await page.goto("/profile?tab=password");

    await page.getByPlaceholder(/min 8 characters/i).fill("StrongPass123!");
    await page.getByPlaceholder(/repeat/i).fill("DifferentPass123!");

    await expect(page.getByText(/passwords don't match/i)).toBeVisible({ timeout: 10_000 });
  });

  test("support deep-link lands on support section", async ({ page }) => {
    await page.goto("/profile?tab=support");

    await expect(page.getByText(/support tickets|support/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /new ticket|create ticket/i })).toBeVisible();
  });

  test("subscription tab deep-link lands on billing content", async ({ page }) => {
    await page.goto("/profile?tab=subscription");

    await expect(page.getByText(/current subscription/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/upgrade options/i)).toBeVisible();
  });

  test("successful checkout return surfaces subscription updated feedback", async ({ page }) => {
    await page.goto("/profile?tab=subscription&upgraded=true");

    // Post-checkout return paths should give the user explicit status
    // confirmation instead of silently dropping them back into profile.
    await expect(page.getByText(/subscription updated/i)).toBeVisible({ timeout: 10_000 });
  });

  test("canceled checkout return surfaces cancellation feedback", async ({ page }) => {
    await page.goto("/profile?tab=subscription&canceled=true");

    await expect(page.getByText(/checkout canceled/i)).toBeVisible({ timeout: 10_000 });
  });

  test("support ticket create action stays disabled until required fields are filled", async ({ page }) => {
    await page.goto("/profile?tab=support");

    const createButton = page.getByRole("button", { name: /create support ticket/i });
    await expect(createButton).toBeDisabled({ timeout: 10_000 });

    await page.getByPlaceholder(/short summary of the issue/i).fill("Playwright support test");
    await page.getByPlaceholder(/tell us what happened/i).fill("Repro details for the support workflow.");

    // Support creation should only unlock once the required subject/details
    // fields are populated.
    await expect(createButton).toBeEnabled();
  });

  test("danger tab exposes sign-out and destructive account actions", async ({ page }) => {
    await page.goto("/profile?tab=danger");

    await expect(page.getByText(/sign out/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
    await expect(page.getByText(/clear job data/i)).toBeVisible();
    await expect(page.getByText(/delete account/i).first()).toBeVisible();
  });

  test("clear data action stays disabled until acknowledgment is checked", async ({ page }) => {
    await page.goto("/profile?tab=danger");

    await page.getByRole("button", { name: /clear data/i }).click();
    const confirmButton = page.getByRole("button", { name: /yes, clear all data/i });
    await expect(confirmButton).toBeDisabled({ timeout: 10_000 });

    await page.getByLabel(/i understand this will permanently delete all job data/i).check();

    // Destructive data wipes should require an explicit acknowledgment before
    // the final action button becomes available.
    await expect(confirmButton).toBeEnabled();
  });

  test("delete account action requires both irreversible-delete acknowledgments", async ({ page }) => {
    await page.goto("/profile?tab=danger");

    await page.getByRole("button", { name: /^delete account$/i }).click();
    const deleteButton = page.getByRole("button", { name: /yes, delete my account/i });
    await expect(deleteButton).toBeDisabled({ timeout: 10_000 });

    await page.getByLabel(/i agree and understand career jump will permanently delete my account/i).check();
    await expect(deleteButton).toBeDisabled();

    await page.getByLabel(/i acknowledge deleted data cannot be recovered/i).check();

    // Account deletion should stay gated until both irreversible-action
    // acknowledgments are complete.
    await expect(deleteButton).toBeEnabled();
  });
});

test.describe("Legacy support route", () => {
  test("legacy /support route forwards user into the profile support tab", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/support");

    // Legacy support links should preserve the user's support intent instead
    // of dropping them on the generic profile landing tab.
    await expect(page).toHaveURL(/\/profile\?tab=support/, { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /new ticket|create ticket/i })).toBeVisible();
  });
});
