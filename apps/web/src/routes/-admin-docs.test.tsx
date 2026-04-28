import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminDocsRoute } from "./admin-docs";

const useMeMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => () => ({ component: AdminDocsRoute }),
    useLocation: () => ({ pathname: "/admin-docs" }),
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/features/session/queries", () => ({
  useMe: () => useMeMock(),
}));

describe("AdminDocsRoute", () => {
  it("shows the admin gate for non-admin users", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: false } } });

    render(<AdminDocsRoute />);

    expect(screen.getByText("Admin access required")).toBeInTheDocument();
  });

  it("renders the embedded swagger surface for admins", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: true } } });

    render(<AdminDocsRoute />);

    expect(screen.getByText("Inspect the live API contract without leaving admin")).toBeInTheDocument();
    expect(screen.getByTitle("Career Jump API Docs")).toBeInTheDocument();
    expect(screen.getByText("Open in new tab")).toBeInTheDocument();
  });
});

