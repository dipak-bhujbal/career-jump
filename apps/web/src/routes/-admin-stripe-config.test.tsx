import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminStripeConfigRoute } from "./admin-stripe-config";

const useMeMock = vi.fn();
const useStripeConfigMock = vi.fn();
const useSaveStripeConfigMock = vi.fn();

vi.mock("@/features/session/queries", () => ({
  useMe: () => useMeMock(),
}));

vi.mock("@/features/billing/queries", () => ({
  useStripeConfig: () => useStripeConfigMock(),
  useSaveStripeConfig: () => useSaveStripeConfigMock(),
}));

describe("AdminStripeConfigRoute", () => {
  beforeEach(() => {
    useSaveStripeConfigMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
  });

  it("shows the admin gate for non-admin users", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: false } } });
    useStripeConfigMock.mockReturnValue({ data: undefined, isLoading: false, error: null });

    render(<AdminStripeConfigRoute />);

    expect(screen.getByText("Admin access required")).toBeInTheDocument();
  });

  it("renders the live stripe config contract fields", () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: true } } });
    useStripeConfigMock.mockReturnValue({
      data: {
        configured: true,
        config: {
          publishableKey: "pk_live_123",
          webhookConfigured: true,
          priceIds: {
            starter: "price_starter",
            pro: "price_pro",
            power: "price_power",
          },
          updatedAt: "2026-04-28T00:00:00.000Z",
          updatedBy: "system",
        },
      },
      isLoading: false,
      error: null,
    });

    render(<AdminStripeConfigRoute />);

    expect(screen.getByText("Stripe checkout")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pk_live_123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("price_starter")).toBeInTheDocument();
    expect(screen.getByDisplayValue("price_pro")).toBeInTheDocument();
    expect(screen.getByDisplayValue("price_power")).toBeInTheDocument();
    expect(screen.getByText(/Webhook: configured/i)).toBeInTheDocument();
  });
});
