import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";
import { queryClient } from "./lib/queryClient.ts";
import "./styles.css";

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Root container #root is missing");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
