import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../apiError.ts";

function retryQuery(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) {
    return false;
  }
  if (!(error instanceof ApiError)) {
    return true;
  }
  return error.source !== "anilist" && error.status !== null && error.status >= 500;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: retryQuery,
    },
  },
});
