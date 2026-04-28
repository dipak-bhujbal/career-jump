import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/support")({ component: SupportRoute });

function SupportRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    // Keep legacy /support links working while funneling every user into the
    // Profile support section, which is now the single source of truth.
    void navigate({ to: "/profile" });
  }, [navigate]);

  return null;
}
