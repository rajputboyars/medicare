"use client";
import { EntityTable, when } from "@/components/admin/entity-table";

export default function AdminAudit() {
  return (
    <EntityTable title="Audit log" subtitle="Who did what to sensitive records. Newest first, last 300 events." queryKey="audit" url="/api/admin/list/audit"
      columns={[{ key: "at", label: "When", render: when }, { key: "actorRole", label: "Role" }, { key: "action", label: "Action", className: "font-semibold" }, { key: "targetType", label: "Target" }, { key: "targetId", label: "ID" }]} />
  );
}
