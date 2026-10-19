import { QueryClientProvider } from "@tanstack/react-query";
import { ProfileApp } from "../components/ProfileApp.tsx";
import { previewUser } from "./fixtures.ts";
import { profileQueryClient } from "./profileFixtures.ts";

const client = profileQueryClient();

export function ProfilePreview(): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <ProfileApp user={previewUser} />
    </QueryClientProvider>
  );
}
