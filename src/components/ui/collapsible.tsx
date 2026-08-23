import type { ComponentProps } from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils.ts";

export function Collapsible(
  props: ComponentProps<typeof CollapsiblePrimitive.Root>,
): React.JSX.Element {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Trigger>): React.JSX.Element {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn("collapsible-trigger", className)}
      {...props}
    />
  );
}

export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Content>): React.JSX.Element {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn("collapsible-content", className)}
      {...props}
    />
  );
}

export function CollapsibleChevron({ className }: { readonly className?: string }): React.JSX.Element {
  return <ChevronDown className={cn("collapsible-chevron size-5", className)} />;
}
