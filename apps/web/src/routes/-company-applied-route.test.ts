import { createElement, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyAppliedPage } from "@/features/applied/CompanyAppliedPage";

const useCompanyAppliedJobsMock = vi.fn();
const useUpdateStatusMock = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => () => ({
      component: () => null,
      useParams: () => ({ company: "acme" }),
    }),
  };
});

vi.mock("@/features/applied/queries", () => ({
  useCompanyAppliedJobs: () => useCompanyAppliedJobsMock(),
  useUpdateStatus: () => useUpdateStatusMock(),
}));

vi.mock("@/features/applied/AppliedKanban", () => ({
  AppliedKanban: ({ jobs }: { jobs: Array<{ job: { jobTitle: string } }> }) =>
    createElement("div", null, `Kanban surface: ${jobs.map((job) => job.job.jobTitle).join(", ")}`),
}));

vi.mock("@/features/jobs/JobDetailsDrawer", () => ({
  JobDetailsDrawer: () => null,
}));

vi.mock("@/components/layout/topbar", () => ({
  Topbar: ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) =>
    createElement("div", null,
      createElement("h1", null, title),
      subtitle ? createElement("p", null, subtitle) : null,
      actions ?? null,
    ),
}));

vi.mock("@/features/companies/CompanyHoverCard", () => ({
  CompanyHoverCard: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

describe("CompanyAppliedRoute", () => {
  beforeEach(() => {
    useUpdateStatusMock.mockReturnValue({ mutate: vi.fn() });
  });

  it("renders the company board view from the company-specific envelope", () => {
    useCompanyAppliedJobsMock.mockReturnValue({
      isLoading: false,
      data: {
        ok: true,
        company: "Acme",
        total: 2,
        jobs: [
          {
            jobKey: "job-1",
            appliedAt: "2026-04-28T15:00:00.000Z",
            status: "Applied",
            job: { jobKey: "job-1", company: "Acme", jobTitle: "Frontend Engineer", source: "greenhouse", url: "https://example.com/1" },
          },
          {
            jobKey: "job-2",
            appliedAt: "2026-04-27T15:00:00.000Z",
            status: "Interview",
            job: { jobKey: "job-2", company: "Acme", jobTitle: "Platform Engineer", source: "greenhouse", url: "https://example.com/2" },
          },
        ],
      },
    });

    render(createElement(CompanyAppliedPage, { company: "acme" }));

    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.getByText("Kanban surface: Frontend Engineer, Platform Engineer")).toBeInTheDocument();
    expect(screen.getByText("Track this company's pipeline as a board or a grouped list.")).toBeInTheDocument();
  });

  it("switches to grouped list mode and shows the company jobs in status groups", () => {
    useCompanyAppliedJobsMock.mockReturnValue({
      isLoading: false,
      data: {
        ok: true,
        company: "Acme",
        total: 1,
        jobs: [
          {
            jobKey: "job-1",
            appliedAt: "2026-04-28T15:00:00.000Z",
            status: "Applied",
            job: { jobKey: "job-1", company: "Acme", jobTitle: "Frontend Engineer", source: "greenhouse", url: "https://example.com/1" },
          },
        ],
      },
    });

    render(createElement(CompanyAppliedPage, { company: "acme" }));
    fireEvent.click(screen.getByRole("button", { name: /list/i }));

    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
    expect(screen.getByText("1 application")).toBeInTheDocument();
  });

  it("shows the empty-state copy when the company has no applied jobs yet", () => {
    useCompanyAppliedJobsMock.mockReturnValue({
      isLoading: false,
      data: { ok: true, company: "Acme", total: 0, jobs: [] },
    });

    render(createElement(CompanyAppliedPage, { company: "acme" }));

    expect(screen.getByText("No applied jobs are tracked for this company yet.")).toBeInTheDocument();
  });
});
