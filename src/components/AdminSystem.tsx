import { AdminStorageStatus } from "./AdminStorageStatus.tsx";

export { AdminVideoManagement } from "./AdminVideoManagement.tsx";

export function AdminSystem(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <AdminStorageStatus />
    </div>
  );
}
