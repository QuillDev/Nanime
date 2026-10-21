import { useCallback } from "react";
import type { PlayerStreamChoice } from "../types.ts";

function choiceClass(active: boolean): string {
  return active
    ? "rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
    : "rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground hover:bg-accent";
}

export function PlayerStreamSetting({ choice }: { readonly choice: PlayerStreamChoice }): React.JSX.Element {
  const { converted, onConverted } = choice;
  const handleOriginal = useCallback(() => {
    onConverted(false);
  }, [onConverted]);
  const handleConverted = useCallback(() => {
    onConverted(true);
  }, [onConverted]);
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold">Stream</h3>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" aria-pressed={!converted} className={choiceClass(!converted)} onClick={handleOriginal}>Original</button>
        <button type="button" aria-pressed={converted} className={choiceClass(converted)} onClick={handleConverted}>Converted</button>
      </div>
    </div>
  );
}
