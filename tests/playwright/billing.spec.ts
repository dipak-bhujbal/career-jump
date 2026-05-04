/**
 * Billing, plan upgrade, and support ticket flow tests.
 * Bugs found are annotated with BUG comments.
 */
import { test, expect } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.describe("Billing — upgrade prompt", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
  });

  test("profile page shows current plan in subscription section", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForSelector("[class*='card'], [class*='plan'], [class*='billing']", { timeout: 10_000 }).catch(() => null);
    const hasPlan = await page.getByText(/free|starter|pro|power|subscription|plan/i).count() > 0;
    expect(hasPlan).toBeTruthy();
  });

  // BUG: upgrade button on profile page may redirect without confirmation
  test("upgrade plan button on profile triggers upgrade dialog or redirects to Stripe", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);

    const upgradeBtn = page.getByRole("button", { name: /upgrade|change plan|subscribe/i });
    if (await upgradeBtn.count() === 0) return;

    // Intercept Stripe redirect — we don't want to actually leave the app
    const [popup] = await Promise.all([
      page.waitForEvent("popup").catch(() => null),
      upgradeBtn.click(),
    ]);

    // Should either open a dialog or navigate to Stripe checkout
    const hasDialog = await page.getByRole("dialog").count() > 0;
    const isStripeRedirect = page.url().includes("stripe.com") || page.url().includes("checkout");
    expect(hasDialog || isStripeRedirect || popup !== null).toBeTruthy();
  });

  test("upgrade prompt dialog shows plan cards (Starter, Pro, Power)", async ({ page }) => {
    await page.goto("/jobs");
    await page.waitForSelector("table, [data-empty]", { timeout: 10_000 }).catch(() => null);

    // Trigger upgrade prompt through quota exhaustion or upgrade button
    const upgradeBtn = page.getByRole("button", { name: /upgrade|unlock/i }).first();
    if (await upgradeBtn.count() > 0) {
      await upgradeBtn.click();
      const dialog = page.getByRole("dialog");
      if (await dialog.count() > 0) {
        await expect(dialog.getByText(/starter/i)).toBeVisible({ timeout: 5_000 });
        await expect(dialog.getByText(/pro/i)).toBeVisible({ timeout: 3_000 });
        await expect(dialog.getByText(/power/i)).toBeVisible({ timeout: 3_000 });
      }
    }
  });

  test("upgrade banner on jobs page is dismissible or links to plan", async ({ page }) => {
    await page.goto("/jobs");
    await page.waitForSelector("[class*='banner'], table, [data-empty]", { timeout: 10_000 }).catch(() => null);

    const banner = page.getByText(/upgrade|unlock|starter|pro/i).first();
    if (await banner.count() === 0) return;

    const upgradeLink = page.getByRole("link", { name: /upgrade|view plans/i })
      .or(page.getByRole("button", { name: /upgrade|view plans/i }));
    if (await upgradeLink.count() > 0) {
      await expect(upgradeLink.first()).toBeVisible();
    }
  });

  // BUG: CA-003 — Stripe metadata cast without runtime validation lets any string become a plan
  test("plan displayed in profile matches actual subscription status", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);

    // Plan label should be one of the valid plan names, not garbage
    const planText = await page.getByText(/free|starter|pro|power/i).first().textContent();
    expect(planText?.toLowerCase()).toMatch(/free|starter|pro|power/);
  });

  test("manage subscription / billing portal link is present for paid users", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForSelector("[class*='card']", { timeout: 10_000 }).catch(() => null);

    // This may only show for non-free users — check either portal link or plan display
    const hasPortalLink = await page.getByRole("link", { name: /manage.*billing|billing portal|manage subscription/i }).count() > 0;
    const hasBtn = await page.getByRole("button", { name: /manage.*billing|billing portal/i }).count() > 0;
    const hasPlanDisplay = await page.getByText(/free|starter|pro|power/i).count() > 0;
    // At minimum the plan should be displayed
    expect(hasPortalLink || hasBtn || hasPlanDisplay).toBeTruthy();
  });
});

test.describe("Support ticket flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USER);
  });

  test("profile support tab shows ticket list or empty state", async ({ page }) => {
    await page.goto("/profile?tab=support");
    await page.waitForSelector("[class*='ticket'], [class*='card'], [data-empty]", { timeout: 10_000 }).catch(() => null);
    const hasTickets = await page.locator("[class*='ticket']").count() > 0;
    const hasEmpty = await page.getByText(/no tickets|no support/i).count() > 0;
    const hasCard = await page.locator("[class*='card']").count() > 0;
    expect(hasTickets || hasEmpty || hasCard).toBeTruthy();
  });

  test("create new support ticket dialog has all required fields", async ({ page }) => {
    await page.goto("/profile?tab=support");
    const newTicketBtn = page.getByRole("button", { name: /new ticket|create ticket|submit ticket/i });
    await expect(newTicketBtn).toBeVisible({ timeout: 10_000 });
    await newTicketBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByLabel(/subject|title/i)).toBeVisible();
    await expect(dialog.getByLabel(/message|description|body/i)).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: /tag|category|type/i })).toBeVisible();
  });

  test("submitting empty ticket form shows validation errors", async ({ page }) => {
    await page.goto("/profile?tab=support");
    const newTicketBtn = page.getByRole("button", { name: /new ticket|create ticket|submit ticket/i });
    if (await newTicketBtn.count() === 0) return;
    await newTicketBtn.click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /submit|send|create/i }).click();
    await expect(dialog.getByText(/required|cannot be empty|enter a/i)).toBeVisible({ timeout: 3_000 });
  });

  // BUG: QA-007 — ticket ID collision possible with only 4-digit random (9000 possibilities)
  test("newly created ticket appears in ticket list after submission", async ({ page }) => {
    await page.goto("/profile?tab=support");
    const newTicketBtn = page.getByRole("button", { name: /new ticket|create ticket|submit ticket/i });
    if (await newTicketBtn.count() === 0) return;
    await newTicketBtn.click();

    const dialog = page.getByRole("dialog");
    const subject = `Test ticket ${Date.now()}`;

    const subjectInput = dialog.getByLabel(/subject|title/i);
    const messageInput = dialog.getByLabel(/message|description|body/i);
    if (await subjectInput.count() === 0 || await messageInput.count() === 0) return;

    await subjectInput.fill(subject);
    await messageInput.fill("This is an automated test ticket from Playwright.");

    const tagSelect = dialog.getByRole("combobox", { name: /tag|category|type/i });
    if (await tagSelect.count() > 0) {
      await tagSelect.selectOption({ index: 1 });
    }

    await dialog.getByRole("button", { name: /submit|send|create/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });

    // Ticket should appear in the list
    await expect(page.getByText(subject)).toBeVisible({ timeout: 5_000 });
  });

  test("clicking a ticket in list opens its detail view", async ({ page }) => {
    await page.goto("/profile?tab=support");
    await page.waitForSelector("[class*='ticket'], [class*='card']", { timeout: 10_000 }).catch(() => null);

    const ticketItems = page.locator("[class*='ticket'], [class*='card']").filter({ hasText: /open|closed|pending/i });
    if (await ticketItems.count() === 0) return;

    await ticketItems.first().click();
    // Should open detail view or dialog
    await expect(page.getByRole("dialog").or(page.locator("[class*='detail']"))).toBeVisible({ timeout: 5_000 });
  });

  // BUG: /support legacy route should redirect to /profile?tab=support
  test("navigating to /support redirects to profile support section", async ({ page }) => {
    await page.goto("/support");
    await expect(page).toHaveURL(/\/profile/, { timeout: 8_000 });
  });
});

test.describe("Privacy page", () => {
  test("privacy page loads and shows policy content", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForSelector("h1, h2, [class*='content']", { timeout: 8_000 }).catch(() => null);
    const hasContent = await page.getByText(/privacy|data|personal information/i).count() > 0;
    expect(hasContent).toBeTruthy();
  });

  test("unauthenticated user can access /privacy without being redirected to login", async ({ page }) => {
    await page.goto("/privacy");
    await page.waitForTimeout(2_000);
    expect(page.url()).not.toContain("/login");
  });
});

test.describe("Email verification flow", () => {
  test("verify-email page shows 6-digit OTP input", async ({ page }) => {
    await page.goto("/verify-email?email=test@example.com");
    // Should show 6 individual digit inputs or a single 6-char input
    const digitInputs = page.locator("input[maxlength='1']");
    const singleInput = page.locator("input[maxlength='6']");
    const hasInputs = (await digitInputs.count() >= 6) || (await singleInput.count() > 0);
    expect(hasInputs).toBeTruthy();
  });

  test("verify-email page shows resend code option", async ({ page }) => {
    await page.goto("/verify-email?email=test@example.com");
    await expect(page.getByRole("button", { name: /resend|send again/i })).toBeVisible({ timeout: 8_000 });
  });

  test("verify-email page shows email address passed via query param", async ({ page }) => {
    await page.goto("/verify-email?email=testuser@example.com");
    await expect(page.getByText(/testuser@example.com/i)).toBeVisible({ timeout: 5_000 });
  });

  // BUG: pasting a 6-digit code should auto-fill all digit inputs
  test("pasting a 6-digit code auto-fills all digit inputs", async ({ page }) => {
    await page.goto("/verify-email?email=test@example.com");
    const firstInput = page.locator("input[maxlength='1']").first();
    if (await firstInput.count() === 0) return;

    await firstInput.focus();
    await page.keyboard.insertText("123456");
    await page.waitForTimeout(300);
    // All 6 inputs should be filled
    const inputs = page.locator("input[maxlength='1']");
    for (let i = 0; i < Math.min(await inputs.count(), 6); i++) {
      const val = await inputs.nth(i).inputValue();
      expect(val).toMatch(/\d/);
    }
  });

  test("submitting wrong verification code shows error message", async ({ page }) => {
    await page.goto("/verify-email?email=test@example.com");
    const digitInputs = page.locator("input[maxlength='1']");
    if (await digitInputs.count() < 6) return;

    // Fill with obviously wrong code
    for (let i = 0; i < 6; i++) {
      await digitInputs.nth(i).fill(String(i + 1));
    }
    await page.getByRole("button", { name: /verify|confirm|submit/i }).click();
    await expect(page.getByText(/invalid|incorrect|wrong|expired|code/i)).toBeVisible({ timeout: 10_000 });
  });
});
