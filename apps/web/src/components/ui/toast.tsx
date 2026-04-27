/**
 * Thin wrapper around `sonner` so call sites stay short and the
 * styling lives in one place.
 *   toast("Saved")              // success (default)
 *   toast("Save failed", "error")
 *   toast("Already tracked", "info")
 */
import { Toaster, toast as sonnerToast } from "sonner";
import { useTheme } from "@/lib/theme";

type Tone = "success" | "error" | "info";

export function toast(message: string, tone: Tone = "success") {
  if (tone === "error") sonnerToast.error(message);
  else if (tone === "info") sonnerToast.message(message);
  else sonnerToast.success(message);
}

export function ToastViewport() {
  const { theme } = useTheme();
  return (
    <Toaster
      position="bottom-right"
      richColors
      closeButton
      theme={theme}
      toastOptions={{
        style: {
          fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif",
          fontSize: "13.5px",
        },
      }}
    />
  );
}
