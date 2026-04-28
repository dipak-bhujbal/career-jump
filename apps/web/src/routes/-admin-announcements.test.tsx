import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminAnnouncementsRoute } from "./admin-announcements";

const useMeMock = vi.fn();
const useAnnouncementsMock = vi.fn();
const useCreateAnnouncementMock = vi.fn();
const useUpdateAnnouncementMock = vi.fn();
const useDeleteAnnouncementMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => () => ({ component: AdminAnnouncementsRoute }),
    useLocation: () => ({ pathname: "/admin-announcements" }),
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock("@/features/session/queries", () => ({
  useMe: () => useMeMock(),
}));

vi.mock("@/features/support/queries", () => ({
  useAnnouncements: () => useAnnouncementsMock(),
  useCreateAnnouncement: () => useCreateAnnouncementMock(),
  useUpdateAnnouncement: () => useUpdateAnnouncementMock(),
  useDeleteAnnouncement: () => useDeleteAnnouncementMock(),
}));

describe("AdminAnnouncementsRoute", () => {
  beforeEach(() => {
    useCreateAnnouncementMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useUpdateAnnouncementMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
    useDeleteAnnouncementMock.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("shows the admin gate for non-admin users", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: false } } });
    useAnnouncementsMock.mockReturnValue({ data: undefined, isLoading: false, error: null });

    render(<AdminAnnouncementsRoute />);

    expect(screen.getByText("Admin access required")).toBeInTheDocument();
  });

  it("renders the live announcement inventory and editor", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: true } } });
    useAnnouncementsMock.mockReturnValue({
      data: {
        total: 1,
        announcements: [{
          id: "ann_1",
          title: "Maintenance",
          body: "We are shipping a maintenance window.",
          severity: "warning",
          active: true,
          dismissible: false,
          activeFrom: "2026-04-28T15:00:00.000Z",
          activeTo: null,
          targetPlans: ["all"],
          targetTenantIds: null,
          updatedAt: "2026-04-28T15:00:00.000Z",
          updatedBy: "admin",
        }],
      },
      isLoading: false,
      error: null,
    });

    render(<AdminAnnouncementsRoute />);

    expect(screen.getByText("Control persistent in-product announcements")).toBeInTheDocument();
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
    expect(screen.getByText("Create announcement")).toBeInTheDocument();
  });
});

