import { type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold uppercase tracking-wide",
  {
    variants: {
      variant: {
        default: "bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))]",
        secondary: "bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
        outline: "border border-[hsl(var(--border))] text-[hsl(var(--foreground))]",
        success: "bg-emerald-500/15 text-emerald-400",
        warning: "bg-amber-500/15 text-amber-400",
        danger: "bg-rose-500/15 text-rose-400",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
