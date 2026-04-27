import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Hover behavior — every button gets a subtle "lift" on hover:
 *   - 1px upward translation
 *   - slightly stronger shadow
 *   - 100ms ease-out
 * This applies in modals/popups too because the styles are on the
 * primitive itself, not added per-call-site.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-100 ease-out shadow-sm hover:-translate-y-px hover:shadow-md active:translate-y-0 active:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm",
  {
    variants: {
      variant: {
        default: "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90",
        secondary: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:opacity-90",
        outline: "border border-[hsl(var(--border))] bg-transparent hover:bg-[hsl(var(--accent))]",
        ghost: "hover:bg-[hsl(var(--accent))]",
        destructive: "bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] hover:opacity-90",
        // Convention: positive / save actions read in green; negative / clear / cancel actions read in orange.
        success: "bg-emerald-600/15 text-emerald-300 border border-emerald-600/40 hover:bg-emerald-600/25 [.light_&]:text-emerald-700 [.light_&]:bg-emerald-600/10",
        warning: "bg-amber-600/15 text-amber-300 border border-amber-600/40 hover:bg-amber-600/25 [.light_&]:text-amber-700 [.light_&]:bg-amber-600/10",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = "Button";
