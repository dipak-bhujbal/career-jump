import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useMeMock = vi.fn();
const useStripeConfigMock = vi.fn();
const useSaveStripeConfigMock = vi.fn();
const useAdminEmailWebhookSettingsMock = vi.fn();
const useSaveAdminEmailWebhookMock = vi.fn();

vi.mock("@/features/session/queries", () => ({
  useMe: () => useMeMock(),
}));

vi.mock("@/features/billing/queries", () => ({
  useStripeConfig: () => useStripeConfigMock(),
  useSaveStripeConfig: () => useSaveStripeConfigMock(),
}));

vi.mock("@/features/support/queries", () => ({
  useAdminEmailWebhookSettings: () => useAdminEmailWebhookSettingsMock(),
  useSaveAdminEmailWebhook: () => useSaveAdminEmailWebhookMock(),
}));

// Route tests only need stable shells for layout-heavy components. Mocking
// them keeps the test focused on the admin contract fields we render.
vi.mock("@/components/admin/admin-shell", () => ({
  AdminPageFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/layout/topbar", () => ({
  Topbar: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div>
      <div>{title}</div>
      {subtitle ? <div>{subtitle}</div> : null}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => ({ component }: { component: unknown }) => component,
  useLocation: () => ({ pathname: "/admin-stripe-config" }),
}));

vi.mock("@/features/billing/plan-display", () => ({
  planIntervalLabel: "/mo",
  planPricePlaceholders: {
    starter: "$19",
    pro: "$49",
    power: "$99",
  },
}));

describe("AdminStripeConfigRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSaveStripeConfigMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useSaveAdminEmailWebhookMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    useAdminEmailWebhookSettingsMock.mockReturnValue({
      data: { webhookUrl: "https://apps-script.example/exec", sharedSecretConfigured: true },
      isLoading: false,
      error: null,
    });
  });

  it("shows the admin gate for non-admin users", async () => {
    useMeMock.mockReturnValue({ data: { actor: { isAdmin: false } } });
    useStripeConfigMock.mockReturnValue({ data: undefined, isLoading: false, error: null });
    const { AdminStripeConfigRoute } = await import("./admin-stripe-config");

    render(<AdminStripeConfigRoute />);

    expect(screen.getByText("Admin access required")).toBeInTheDocument();
  });

  it("renders the live stripe and webhook config fields", async () => {
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
    const { AdminStripeConfigRoute } = await import("./admin-stripe-config");

    render(<AdminStripeConfigRoute />);

    expect(screen.getByText("Stripe checkout")).toBeInTheDocument();
    expect(screen.getByDisplayValue("pk_live_123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("price_starter")).toBeInTheDocument();
    expect(screen.getByDisplayValue("price_pro")).toBeInTheDocument();
    expect(screen.getByDisplayValue("price_power")).toBeInTheDocument();
    expect(screen.getByText(/Webhook: configured/i)).toBeInTheDocument();
    expect(screen.getByText("Notification email webhook")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://apps-script.example/exec")).toBeInTheDocument();
    expect(screen.getByText(/Shared secret: configured/i)).toBeInTheDocument();
  });
});
