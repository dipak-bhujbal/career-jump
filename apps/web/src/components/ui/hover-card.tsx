/**
 * Thin wrapper around Radix HoverCard with our theme tokens applied.
 * Re-exports Root / Trigger / Content under shorter names.
 */
import * as RadixHoverCard from "@radix-ui/react-hover-card";
import { type ComponentPropsWithoutRef, forwardRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

export const HoverCard = RadixHoverCard.Root;
export const HoverCardTrigger = RadixHoverCard.Trigger;

export const HoverCardContent = forwardRef<
  ElementRef<typeof RadixHoverCard.Content>,
  ComponentPropsWithoutRef<typeof RadixHoverCard.Content>
>(({ className, align = "center", sideOffset = 8, ...props }, ref) => (
  <RadixHoverCard.Portal>
    <RadixHoverCard.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] p-4 shadow-md outline-none animate-in fade-in-80 zoom-in-95",
        className,
      )}
      {...props}
    />
  </RadixHoverCard.Portal>
));
HoverCardContent.displayName = "HoverCardContent";
