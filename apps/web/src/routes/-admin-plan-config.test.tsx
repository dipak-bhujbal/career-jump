import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminPlanConfigRoute } from "./admin-plan-config";

const useMeMock = vi.fn();
const usePlanConfigsMock = vi.fn();
const useSavePlanConfigMock = vi.fn();

vi.mock("@/features/session/queries", () => ({
  useMe: () => useMeMock(),
}));

vi.mock("@/features/support/queries", () => ({
  usePlanConfigs: () => usePlanConfigsMock(),
  useSavePlanConfig: () => useSavePlanConfigMock(),
}));

describe("AdminPlanConfigRoute", () => {
  beforeEach(() => {
    useSavePlanConfigMock.mockReturnValue({
      mutate: vi.fn(),
      variables: undefined,
    });
  });

  it("shows the admin access gate for non-admin users", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: false } } });
    usePlanConfigsMock.mockReturnValue({ data: undefined, isLoading: false, error: null });

    render(<AdminPlanConfigRoute />);

    expect(screen.getByText("Admin access required")).toBeInTheDocument();
    expect(screen.getByText("This workspace is only available to admin accounts.")).toBeInTheDocument();
  });

  it("renders all four plan cards from the live plan-config contract", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: true } } });
    usePlanConfigsMock.mockReturnValue({
      data: {
        configs: [
          makePlan("free", "Free"),
          makePlan("starter", "Starter"),
          makePlan("pro", "Pro"),
          makePlan("power", "Power"),
        ],
      },
      isLoading: false,
      error: null,
    });

    render(<AdminPlanConfigRoute />);

    expect(screen.getByText("Admin-controlled pricing, scan freshness, and entitlement policy.")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Power")).toBeInTheDocument();
    expect(screen.getAllByText("Save plan")).toHaveLength(4);
  });
});

function makePlan(plan: "free" | "starter" | "pro" | "power", displayName: string) {
  return {
    plan,
    displayName,
    scanCacheAgeHours: 4,
    canTriggerLiveScan: plan !== "free",
    maxCompanies: plan === "power" ? null : 10,
    maxSessions: 1,
    maxVisibleJobs: plan === "power" ? null : 40,
    maxAppliedJobs: plan === "power" ? null : 150,
    emailNotificationsEnabled: plan !== "free",
    weeklyDigestEnabled: plan !== "free",
    maxEmailsPerWeek: 3,
    enabledFeatures: [],
    updatedAt: "2026-04-28T00:00:00.000Z",
    updatedBy: "system",
  };
}
