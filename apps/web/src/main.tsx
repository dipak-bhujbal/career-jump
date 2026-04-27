/**
 * App entry point.
 *
 * Wires together:
 *   - TanStack Router (file-based — see vite.config.ts plugin and src/routes)
 *   - TanStack Query (single QueryClient instance for the whole app)
 *   - Theme: dark by default; flip with the `light` class on <html>.
 *
 * The generated route tree (routeTree.gen.ts) is regenerated on every
 * `npm run dev` / `npm run build` by @tanstack/router-plugin.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./index.css";
import { routeTree } from "./routeTree.gen";
import { installMocks, shouldUseMocks } from "./mocks/install";

// Demo / test data — install BEFORE the QueryClient kicks off any
// fetches so the app sees mocked responses end-to-end.
if (shouldUseMocks()) installMocks();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
