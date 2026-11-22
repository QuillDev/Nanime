import { useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.ts";

interface RotationProps {
  readonly count: number;
  /** Move one banner back (-1) or forward (1), wrapping around. */
  readonly onStep: (step: number) => void;
}

function StepButton({ step, onStep }: { readonly step: -1 | 1; readonly onStep: (step: number) => void }): React.JSX.Element {
  const handleClick = useCallback(() => {
    onStep(step);
  }, [onStep, step]);
  const Icon = step === 1 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={step === 1 ? "Next show" : "Previous show"}
      className={cn(
        // At the screen's edges: beside the copy on wide screens, above it on narrow ones where the copy spans the width.
        "absolute top-24 grid size-10 place-items-center rounded-full bg-black/35 text-foreground hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:top-[45%] sm:size-12",
        step === 1 ? "right-3 sm:right-5" : "left-3 sm:left-5",
      )}
    >
      <Icon className="size-5 sm:size-6" />
    </button>
  );
}

/** Steps the banner through its shows by hand; nothing when there is only one. */
export function HomeHeroRotation({ count, onStep }: RotationProps): React.JSX.Element | null {
  if (count < 2) {
    return null;
  }
  return (
    <>
      <StepButton step={-1} onStep={onStep} />
      <StepButton step={1} onStep={onStep} />
    </>
  );
}
