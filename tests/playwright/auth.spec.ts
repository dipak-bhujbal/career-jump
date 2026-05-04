/**
 * Auth flow tests — login, signup, forgot password, email verification.
 * Bugs found during authoring are annotated with BUG comments.
 */
import { test, expect } from "@playwright/test";
import { TEST_USER, loginAs } from "./helpers/auth";

test.describe("Login page", () => {
  test("renders login form with email, password, and sign-in button", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /forgot/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign up/i })).toBeVisible();
  });

  test("shows validation error when submitting empty email", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/email is required/i)).toBeVisible();
  });

  test("shows validation error when email filled but password empty", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("user@example.com");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/password is required/i)).toBeVisible();
  });

  test("shows error message for invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("nonexistent@example.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/sign in failed|invalid|incorrect/i)).toBeVisible({ timeout: 10_000 });
  });

  // BUG: admin=1 param is lost on redirect — codex-2 CA-001
  test("admin login mode is activated by ?admin=1 query param", async ({ page }) => {
    await page.goto("/login?admin=1");
    // Admin mode toggle should be visible or indicated in UI
    await expect(page.getByText(/admin/i)).toBeVisible();
  });

  test("password toggle shows/hides password text", async ({ page }) => {
    await page.goto("/login");
    const passwordInput = page.getByLabel(/password/i);
    await passwordInput.fill("mysecret");
    await expect(passwordInput).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: /show|toggle/i }).click();
    await expect(passwordInput).toHaveAttribute("type", "text");
  });

  test("redirects to / after successful login", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await expect(page).toHaveURL("/");
  });

  test("already-authenticated user visiting /login is redirected to /", async ({ page }) => {
    await loginAs(page, TEST_USER);
    await page.goto("/login");
    await expect(page).toHaveURL("/", { timeout: 5_000 });
  });
});

test.describe("Signup page", () => {
  test("renders signup form", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /create|sign up|register/i })).toBeVisible();
  });

  test("shows error for invalid email format", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel(/email/i).fill("notanemail");
    await page.getByLabel(/password/i).first().fill("Password123!");
    await page.getByRole("button", { name: /create|sign up|register/i }).click();
    await expect(page.getByText(/valid email|invalid email/i)).toBeVisible({ timeout: 5_000 });
  });

  test("link to login page is present on signup page", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("link", { name: /sign in|log in/i })).toBeVisible();
  });
});

test.describe("Forgot password flow", () => {
  test("renders forgot password form", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send|reset|submit/i })).toBeVisible();
  });

  test("shows success message even for non-existent email (no enumeration)", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel(/email/i).fill("definitelynotreal@nowhere.example");
    await page.getByRole("button", { name: /send|reset|submit/i }).click();
    // Should NOT reveal whether email exists — show generic success
    await expect(page.getByText(/check your email|code sent|if.*account/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/no account|not found|does not exist/i)).not.toBeVisible();
  });

  // BUG QA-002/QA-003: no rate limiting UI feedback — can submit repeatedly
  test("submit button is disabled while request is in flight", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel(/email/i).fill("anyuser@example.com");
    const btn = page.getByRole("button", { name: /send|reset|submit/i });
    await btn.click();
    // Button should be disabled during loading to prevent double-submit
    await expect(btn).toBeDisabled();
  });
});

test.describe("Protected route guard", () => {
  test("unauthenticated user visiting /jobs is redirected to /login", async ({ page }) => {
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test("unauthenticated user visiting /configuration is redirected to /login", async ({ page }) => {
    await page.goto("/configuration");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test("unauthenticated user visiting /applied is redirected to /login", async ({ page }) => {
    await page.goto("/applied");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test("unauthenticated user visiting /admin is redirected to /login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });
});
