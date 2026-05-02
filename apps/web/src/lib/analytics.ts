import { envValue, runtimeValue } from "./runtime-config";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GA_SCRIPT_ID = "career-jump-ga4";

function measurementId(): string {
  return runtimeValue("gaMeasurementId") || envValue("VITE_GA_MEASUREMENT_ID");
}

export function analyticsEnabled(): boolean {
  return Boolean(measurementId());
}

function ensureDataLayer(): void {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = window.gtag ?? function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
}

export function initAnalytics(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const id = measurementId();
  if (!id || document.getElementById(GA_SCRIPT_ID)) return;

  // Initialize the GA4 global before the script finishes loading so early
  // pageviews and app events are queued instead of getting dropped.
  ensureDataLayer();
  window.gtag?.("js", new Date());
  window.gtag?.("config", id, {
    send_page_view: false,
    anonymize_ip: true,
  });

  const script = document.createElement("script");
  script.id = GA_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

export function trackPageView(path: string): void {
  if (typeof window === "undefined") return;
  const id = measurementId();
  if (!id) return;
  ensureDataLayer();
  window.gtag?.("event", "page_view", {
    page_location: window.location.href,
    page_path: path,
    page_title: document.title,
    send_to: id,
  });
}

export function trackEvent(eventName: string, params: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  if (!measurementId()) return;
  ensureDataLayer();
  window.gtag?.("event", eventName, params);
}
