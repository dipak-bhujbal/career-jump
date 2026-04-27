/**
 * Select — Radix-powered dropdown with consistent open direction.
 *
 * Always opens BELOW the trigger (`side="bottom" position="popper"`)
 * so the menu placement never depends on which value is selected or
 * where on screen the trigger sits. Native HTML `<select>` flips
 * direction when near the bottom of the viewport — Radix lets us
 * pin it.
 *
 * Usage matches shadcn/ui's Select wrapper:
 *
 *   <Select value={v} onValueChange={setV}>
 *     <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
 *     <SelectContent>
 *       <SelectItem value="a">Apple</SelectItem>
 *       <SelectItem value="b">Banana</SelectItem>
 *     </SelectContent>
 *   </Select>
 *
 * For backwards-compat with code written against native <select>,
 * the file also exports a `Select` shim that takes children of plain
 * <option> elements; it converts them internally. Existing pages do
 * not need to change.
 */
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, Children, isValidElement } from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Root = RadixSelect.Root;
const Group = RadixSelect.Group;
const Value = RadixSelect.Value;

const Trigger = forwardRef<ElementRef<typeof RadixSelect.Trigger>, ComponentPropsWithoutRef<typeof RadixSelect.Trigger>>(
  ({ className, children, ...props }, ref) => (
    <RadixSelect.Trigger
      ref={ref}
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <RadixSelect.Icon asChild>
        <ChevronDown size={14} className="opacity-50 ml-2 shrink-0" />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  ),
);
Trigger.displayName = "SelectTrigger";

const Content = forwardRef<ElementRef<typeof RadixSelect.Content>, ComponentPropsWithoutRef<typeof RadixSelect.Content>>(
  ({ className, children, ...props }, ref) => (
    <RadixSelect.Portal>
      <RadixSelect.Content
        ref={ref}
        position="popper"
        side="bottom"
        align="start"
        sideOffset={4}
        avoidCollisions={false}
        className={cn(
          "relative z-50 max-h-[60vh] min-w-[--radix-select-trigger-width] w-[--radix-select-trigger-width] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--popover))] text-[hsl(var(--popover-foreground))] shadow-md animate-in fade-in-80 zoom-in-95",
          className,
        )}
        {...props}
      >
        <RadixSelect.Viewport className="p-1 max-h-[300px] overflow-y-auto">
          {children}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  ),
);
Content.displayName = "SelectContent";

const Item = forwardRef<ElementRef<typeof RadixSelect.Item>, ComponentPropsWithoutRef<typeof RadixSelect.Item>>(
  ({ className, children, ...props }, ref) => (
    <RadixSelect.Item
      ref={ref}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-[hsl(var(--accent))] data-[state=checked]:font-medium data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <RadixSelect.ItemIndicator>
          <Check size={14} />
        </RadixSelect.ItemIndicator>
      </span>
    </RadixSelect.Item>
  ),
);
Item.displayName = "SelectItem";

export { Root as SelectRoot, Group as SelectGroup, Value as SelectValue, Trigger as SelectTrigger, Content as SelectContent, Item as SelectItem };

/* ---------- Backwards-compat <select>-style API ---------- */

interface NativeStyleSelectProps {
  value?: string;
  defaultValue?: string;
  onChange?: (e: { target: { value: string } }) => void;
  className?: string;
  disabled?: boolean;
  multiple?: boolean;
  children?: React.ReactNode;
}

/**
 * Drop-in replacement for native <select> using a flat children pattern:
 *   <Select value={v} onChange={(e) => setV(e.target.value)}>
 *     <option value="a">Apple</option>
 *     <option value="b">Banana</option>
 *   </Select>
 *
 * The shim converts <option> children into Radix SelectItems so existing
 * pages compile without edits. Multi-select falls back to native (Radix
 * Select is single-only by design).
 */
export function Select({ value, defaultValue, onChange, className, disabled, multiple, children }: NativeStyleSelectProps) {
  if (multiple) {
    // Native fallback for multi-select.
    return (
      <select
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => onChange?.(e)}
        className={cn(
          "flex w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-2 py-1 text-sm shadow-sm",
          className,
        )}
        disabled={disabled}
        multiple
      >
        {children}
      </select>
    );
  }

  // Convert <option> children to Radix items.
  const items: { value: string; label: React.ReactNode; disabled?: boolean }[] = [];
  let placeholder: React.ReactNode = "Select…";
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string; children?: React.ReactNode; disabled?: boolean }>(child)) return;
    const v = child.props.value ?? "";
    const label = child.props.children;
    // The empty-string option becomes the placeholder text.
    if (v === "") {
      placeholder = label ?? placeholder;
      return;
    }
    items.push({ value: String(v), label, disabled: child.props.disabled });
  });

  return (
    <Root
      value={value || undefined}
      defaultValue={defaultValue || undefined}
      onValueChange={(v) => onChange?.({ target: { value: v } })}
      disabled={disabled}
    >
      <Trigger className={className}>
        <Value placeholder={placeholder as string}>
          {value ? items.find((i) => i.value === value)?.label : placeholder}
        </Value>
      </Trigger>
      <Content>
        {items.map((it) => (
          <Item key={it.value} value={it.value} disabled={it.disabled}>
            {it.label}
          </Item>
        ))}
      </Content>
    </Root>
  );
}
