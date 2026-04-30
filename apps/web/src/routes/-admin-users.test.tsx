import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminUsersRoute } from "./admin-users";

const useMeMock = vi.fn();
const useAdminUsersMock = vi.fn();
const useAdminUserMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => () => ({ component: () => null }),
    useLocation: () => ({ pathname: "/admin-users" }),
  };
});

vi.mock("@/features/session/queries", () => ({
  useMe: () => useMeMock(),
}));

vi.mock("@/components/layout/topbar", () => ({
  Topbar: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <div>{title}</div>
      <div>{subtitle}</div>
    </div>
  ),
}));

vi.mock("@/components/admin/admin-shell", () => ({
  AdminPageFrame: ({ children, title, description }: { children: React.ReactNode; title: string; description: string }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {children}
    </div>
  ),
}));

vi.mock("@/features/support/queries", () => ({
  useAdminUsers: (...args: unknown[]) => useAdminUsersMock(...args),
  useAdminUser: (...args: unknown[]) => useAdminUserMock(...args),
  useSetAdminUserPlan: () => ({ isPending: false, mutate: vi.fn() }),
  useSetAdminUserStatus: () => ({ isPending: false, mutate: vi.fn() }),
}));

describe("AdminUsersRoute", () => {
  it("keeps admin queries disabled for non-admin viewers", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: false } } });
    useAdminUsersMock.mockReturnValue({ data: { total: 0, users: [] } });
    useAdminUserMock.mockReturnValue({ data: null });

    render(<AdminUsersRoute />);

    expect(useAdminUsersMock).toHaveBeenCalledWith("", false);
    expect(useAdminUserMock).toHaveBeenCalledWith(null, false);
    expect(screen.getByText("Admin access required")).toBeInTheDocument();
  });

  it("enables admin queries once the session is confirmed as admin", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: true } } });
    useAdminUsersMock.mockReturnValue({ data: { total: 0, users: [] } });
    useAdminUserMock.mockReturnValue({ data: null });

    render(<AdminUsersRoute />);

    expect(useAdminUsersMock).toHaveBeenCalledWith("", true);
    expect(useAdminUserMock).toHaveBeenCalledWith(null, true);
    expect(screen.getByText("Inspect account health and user state quickly")).toBeInTheDocument();
  });
});
