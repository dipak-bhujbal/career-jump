import { describe, it } from "vitest";

describe("e2e login flow", () => {
  it.todo("renders the login form");
  it.todo("authenticates via Cognito and stores the session on valid credentials");
  it.todo("shows an error message on invalid credentials without revealing whether the email exists");
  it.todo("redirects to the originally requested route after successful login");
  it.todo("clears the session and redirects to login on logout");
});
