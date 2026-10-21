import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";
import { CopyableErrorBoundary } from "./components/CopyableErrorBoundary.tsx";
import { PwaRegistration } from "./components/PwaRegistration.tsx";
import { queryClient } from "./lib/queryClient.ts";
import { installTvRemote } from "./lib/tvRemote.ts";
import { startBootRequests } from "./lib/bootRequests.ts";
import "./styles.css";

startBootRequests();
installTvRemote();

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Root container #root is missing");
}

createRoot(container).render(
  <StrictMode>
    <CopyableErrorBoundary title="Nanime encountered an error">
      <QueryClientProvider client={queryClient}>
        <PwaRegistration />
        <App />
      </QueryClientProvider>
    </CopyableErrorBoundary>
  </StrictMode>,
);
