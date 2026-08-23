import { AdminStorageStatus } from "./AdminStorageStatus.tsx";
import { AdminLibraryMaintenance } from "./AdminLibraryMaintenance.tsx";

export { AdminVideoManagement } from "./AdminVideoManagement.tsx";

export function AdminSystem(): React.JSX.Element {
  return (
    <div className="space-y-4">
      <AdminStorageStatus />
      <AdminLibraryMaintenance />
    </div>
  );
}
