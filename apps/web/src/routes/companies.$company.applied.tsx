import { createFileRoute } from "@tanstack/react-router";
import { CompanyAppliedPage } from "@/features/applied/CompanyAppliedPage";

export const Route = createFileRoute("/companies/$company/applied")({
  component: CompanyAppliedRoute,
});

function CompanyAppliedRoute() {
  const { company } = Route.useParams();
  return <CompanyAppliedPage company={company} />;
}
