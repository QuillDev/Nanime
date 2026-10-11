import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminNyaaSearchDialog } from "../../src/components/AdminNyaaSearch.tsx";

function Fixture(): React.JSX.Element {
  const [open, setOpen] = useState(true);
  const handleOpen = useCallback(() => setOpen(true), []);
  return <><button type="button" onClick={handleOpen}>Open results</button><AdminNyaaSearchDialog open={open} onOpenChange={setOpen} search="Fixture" category="1_0" trusted={false} showFolder="Fixture Show" /></>;
}

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Missing fixture root");
}
createRoot(container).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Fixture /></QueryClientProvider>);
