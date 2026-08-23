import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { AuthUser, ProvisionedUser } from "../types.ts";
import {
  fetchCurrentUser,
  fetchUsers,
  cancelUserProvision,
  login,
  logout,
  provisionUser,
  setupPassword,
} from "../api.ts";
import {
  navigateAfterAuthentication,
  navigateToLogin,
} from "./useMediaRoute.ts";

const authKey = ["current-user"] as const;
const usersKey = ["users"] as const;

export function useCurrentUser(): UseQueryResult<AuthUser | null, Error> {
  return useQuery({ queryKey: authKey, queryFn: ({ signal }) => fetchCurrentUser(signal) });
}

interface PasswordCredentials {
  readonly username: string;
  readonly password: string;
}

interface SetupCredentials extends PasswordCredentials {
  readonly setupToken: string;
}

function useAuthentication(
  mutationFn: (username: string, password: string) => Promise<AuthUser>,
): UseMutationResult<AuthUser, Error, PasswordCredentials> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }) => mutationFn(username, password),
    onSuccess: (user) => {
      queryClient.setQueryData(authKey, user);
      navigateAfterAuthentication();
    },
  });
}

export function useLogin(): UseMutationResult<AuthUser, Error, PasswordCredentials> {
  return useAuthentication(login);
}

export function useSetupPassword(): UseMutationResult<AuthUser, Error, SetupCredentials> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password, setupToken }) => (
      setupPassword(username, password, setupToken)
    ),
    onSuccess: (user) => {
      queryClient.setQueryData(authKey, user);
      navigateAfterAuthentication();
    },
  });
}

export function useLogout(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      const cancellation = queryClient.cancelQueries();
      queryClient.setQueryData(authKey, null);
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== authKey[0],
      });
      navigateToLogin();
      return cancellation;
    },
  });
}

export function useUsers(enabled: boolean): UseQueryResult<readonly ProvisionedUser[], Error> {
  return useQuery({
    queryKey: usersKey,
    queryFn: ({ signal }) => fetchUsers(signal),
    enabled,
  });
}

interface ProvisionUserVariables {
  readonly username: string;
  readonly isAdmin: boolean;
}

export function useProvisionUser(): UseMutationResult<string, Error, ProvisionUserVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ username, isAdmin }) => provisionUser(username, isAdmin),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useCancelUserProvision(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelUserProvision,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
}
