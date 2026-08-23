import { useQuery, type UseQueryResult } from "@tanstack/react-query";

function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function useServiceWorkerRegistration(): UseQueryResult<ServiceWorkerRegistration | null> {
  return useQuery({
    queryKey: ["service-worker-registration"],
    queryFn: registerServiceWorker,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
