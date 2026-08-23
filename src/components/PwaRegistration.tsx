import { useServiceWorkerRegistration } from "../hooks/useServiceWorkerRegistration.ts";

export function PwaRegistration(): React.JSX.Element | null {
  const registration = useServiceWorkerRegistration();
  if (!registration.isError) {
    return null;
  }
  const message = registration.error instanceof Error
    ? registration.error.stack ?? registration.error.message
    : String(registration.error);
  return (
    <aside className="fixed bottom-4 left-4 right-4 z-[100] max-h-48 overflow-auto rounded-md border border-destructive bg-black p-4 text-sm text-foreground" role="alert">
      <p className="font-semibold text-destructive">Nanime could not enable app installation or offline startup.</p>
      <pre className="mt-2 select-text whitespace-pre-wrap break-words font-mono text-xs">{message}</pre>
    </aside>
  );
}
