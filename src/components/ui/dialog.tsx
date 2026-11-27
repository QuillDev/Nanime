import type { ComponentProps } from "react";
import { DialogClose, DialogContent as BaseDialogContent, DialogHeader as BaseDialogHeader } from "nakomponents";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils.ts";

export { Dialog, DialogDescription, DialogTitle } from "nakomponents";

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseDialogContent>): React.JSX.Element {
  return (
    <BaseDialogContent className={cn("sm:max-w-4xl", className)} {...props} showCloseButton={false}>
      {children}
      <DialogClose className="player-safe-close absolute z-40 rounded-md bg-black p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <XIcon className="size-5" />
        <span className="sr-only">Close</span>
      </DialogClose>
    </BaseDialogContent>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<typeof BaseDialogHeader>): React.JSX.Element {
  return <BaseDialogHeader className={cn("text-left", className)} {...props} />;
}
