import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  approveDeviceLogin,
  fetchDeviceLogin,
  pollDeviceLogin,
  startDeviceLogin,
} from "../deviceLoginApi.ts";

const CODE_KEY = ["device-login-code"] as const;

/**
 * The TV side: get a code, check every couple of seconds whether a phone
 * approved it, and get a fresh code when it runs out. An approval sets the
 * session cookie, so the current-user query is refetched and the app opens.
 */
export function useTvSignIn() {
  const queryClient = useQueryClient();
  const code = useQuery({
    queryKey: CODE_KEY,
    queryFn: startDeviceLogin,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const deviceCode = code.data?.deviceCode ?? null;
  const poll = useQuery({
    queryKey: ["device-login-poll", deviceCode],
    queryFn: ({ signal }) => pollDeviceLogin(deviceCode ?? "", signal),
    enabled: deviceCode !== null,
    refetchInterval: (code.data?.interval ?? 2) * 1000,
    refetchIntervalInBackground: true,
    gcTime: 0,
  });
  const status = poll.data?.status;
  useEffect(() => {
    if (status === "approved") {
      void queryClient.invalidateQueries({ queryKey: ["current-user"] });
    } else if (status === "expired") {
      void queryClient.refetchQueries({ queryKey: CODE_KEY });
    }
  }, [queryClient, status]);
  return { code };
}

/** The phone side: what is asking to sign in, and the approval. */
export function useDeviceApproval(userCode: string | null) {
  const request = useQuery({
    queryKey: ["device-login-request", userCode],
    queryFn: ({ signal }) => fetchDeviceLogin(userCode ?? "", signal),
    enabled: userCode !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const queryClient = useQueryClient();
  const approve = useMutation({
    mutationFn: approveDeviceLogin,
    // The request is used up once approved.
    onSuccess: () => queryClient.removeQueries({ queryKey: ["device-login-request", userCode] }),
  });
  return { request, approve };
}
