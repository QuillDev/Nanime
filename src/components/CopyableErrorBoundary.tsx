import { Component, type ReactNode } from "react";

interface CopyableErrorBoundaryProps {
  readonly children: ReactNode;
  readonly title: string;
  readonly onRecover?: () => void;
}

interface CopyableErrorBoundaryState {
  readonly detail: string | null;
}

function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return error.stack === undefined
    ? `${error.name}: ${error.message}`
    : error.stack;
}

export class CopyableErrorBoundary extends Component<
  CopyableErrorBoundaryProps,
  CopyableErrorBoundaryState
> {
  public constructor(props: CopyableErrorBoundaryProps) {
    super(props);
    this.state = { detail: null };
  }

  public static getDerivedStateFromError(error: unknown): CopyableErrorBoundaryState {
    return { detail: errorDetail(error) };
  }

  private readonly handleCopy = (): void => {
    void this.copyError();
  };

  private readonly handleRecover = (): void => {
    if (this.props.onRecover === undefined) {
      globalThis.location.reload();
    } else {
      this.props.onRecover();
    }
  };

  private async copyError(): Promise<void> {
    if (this.state.detail === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.state.detail);
    } catch {
      // The error remains selectable when clipboard permission is unavailable.
    }
  }

  public override render(): ReactNode {
    const { detail } = this.state;
    if (detail === null) {
      return this.props.children;
    }
    return (
      <main role="alert" className="flex min-h-64 flex-col items-center justify-center gap-4 bg-black p-6 text-center">
        <h1 className="text-lg font-semibold text-destructive">{this.props.title}</h1>
        <p className="text-sm text-muted-foreground">
          Copy the details below when reporting this problem.
        </p>
        <pre className="max-h-64 w-full max-w-3xl select-text overflow-auto rounded-md border border-border bg-card p-4 text-left text-xs text-foreground">
          {detail}
        </pre>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={this.handleCopy} className="rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground">
            Copy error
          </button>
          <button type="button" onClick={this.handleRecover} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            {this.props.onRecover === undefined ? "Reload Nanime" : "Close player"}
          </button>
        </div>
      </main>
    );
  }
}
