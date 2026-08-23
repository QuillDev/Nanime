interface DialogActionsProps {
  readonly actionLabel: string;
  readonly cancelLabel?: string;
  readonly disabled?: boolean;
  readonly onAction?: (() => void) | undefined;
  readonly onCancel: () => void;
  readonly pending: boolean;
  readonly pendingLabel: string;
  readonly tone?: "primary" | "destructive";
}

export function DialogActions({
  actionLabel,
  cancelLabel = "Cancel",
  disabled = false,
  onAction,
  onCancel,
  pending,
  pendingLabel,
  tone = "destructive",
}: DialogActionsProps): React.JSX.Element {
  const actionColor = tone === "primary"
    ? "bg-primary text-primary-foreground"
    : "bg-destructive text-destructive-foreground";
  return (
    <div className="flex justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="h-10 rounded-md border border-border bg-background px-4 text-sm font-semibold hover:bg-accent disabled:text-muted-foreground"
      >
        {cancelLabel}
      </button>
      <button
        type={onAction === undefined ? "submit" : "button"}
        onClick={onAction}
        disabled={disabled || pending}
        className={`h-10 rounded-md px-4 text-sm font-semibold disabled:bg-muted disabled:text-muted-foreground ${actionColor}`}
      >
        {pending ? pendingLabel : actionLabel}
      </button>
    </div>
  );
}
