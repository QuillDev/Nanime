import type { ComponentProps } from "react";
import {
  CollapsibleChevron as BaseCollapsibleChevron,
  CollapsibleContent as BaseCollapsibleContent,
  CollapsibleTrigger as BaseCollapsibleTrigger,
} from "nakomponents";
import { cn } from "@/lib/utils.ts";

export { Collapsible } from "nakomponents";

export function CollapsibleTrigger({
  className,
  ...props
}: ComponentProps<typeof BaseCollapsibleTrigger>): React.JSX.Element {
  return <BaseCollapsibleTrigger className={cn("collapsible-trigger", className)} {...props} />;
}

export function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof BaseCollapsibleContent>): React.JSX.Element {
  return <BaseCollapsibleContent className={cn("collapsible-content", className)} {...props} />;
}

export function CollapsibleChevron({ className }: { readonly className?: string }): React.JSX.Element {
  return <BaseCollapsibleChevron className={cn("collapsible-chevron size-5", className)} />;
}
