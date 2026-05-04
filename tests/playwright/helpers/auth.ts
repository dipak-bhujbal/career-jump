import type { Page } from "@playwright/test";

export const TEST_USER = {
  email: process.env.TEST_USER_EMAIL ?? "testuser@example.com",
  password: process.env.TEST_USER_PASSWORD ?? "TestPassword123!",
};

export const TEST_ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL ?? "testadmin@example.com",
  password: process.env.TEST_ADMIN_PASSWORD ?? "AdminPassword123!",
};

export async function loginAs(page: Page, user: { email: string; password: string }, isAdmin = false) {
  const url = isAdmin ? "/login?admin=1" : "/login";
  await page.goto(url);
  await page.getByLabel(/email/i).fill(user.email);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("/", { timeout: 15_000 });
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: /sign out|log out/i }).click();
  await page.waitForURL("/login");
}
