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
import { initAnalytics } from "./lib/analytics";
import { ApiError } from "./lib/api";

const CHUNK_RELOAD_GUARD_KEY = "career-jump:chunk-reload-once";

/**
 * Recover from stale lazy-route chunks after a frontend deploy.
 *
 * Vite fingerprints route modules, so a tab that stays open across a deploy can
 * still hold the old runtime graph in memory. The next lazy import then asks
 * CloudFront for a deleted filename and crashes with "Importing a module script
 * failed". Reloading once is enough to pick up the new entry HTML + manifest.
 */
function installChunkLoadRecovery(): void {
  if (typeof window === "undefined") return;

  const shouldRecover = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /Importing a module script failed/i.test(message)
      || /Failed to fetch dynamically imported module/i.test(message)
      || /ChunkLoadError/i.test(message);
  };

  const reloadOnce = (): void => {
    try {
      if (window.sessionStorage.getItem(CHUNK_RELOAD_GUARD_KEY) === "1") return;
      window.sessionStorage.setItem(CHUNK_RELOAD_GUARD_KEY, "1");
    } catch {
      // Storage failures should not block the recovery reload.
    }
    window.location.reload();
  };

  window.addEventListener("error", (event) => {
    if (shouldRecover(event.error)) reloadOnce();
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (shouldRecover(event.reason)) reloadOnce();
  });
}

// Demo / test data — install BEFORE the QueryClient kicks off any
// fetches so the app sees mocked responses end-to-end.
if (shouldUseMocks()) installMocks();
initAnalytics();
installChunkLoadRecovery();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retrying 4xx responses, especially Lambda/edge 429s, multiplies the
      // same burst that caused the throttle. Only retry transient 5xx/network
      // style failures once.
      retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
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
