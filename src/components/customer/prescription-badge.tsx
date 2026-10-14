import { CheckCircle2, FileText, Lock } from "lucide-react";
import { StatusBadge } from "@/components/ui";

/** Says in words (and an icon) whether a medicine needs a prescription. Restricted medicines are called out separately. */
export function PrescriptionBadge({ required, restricted }: { required: boolean; restricted?: boolean }) {
  if (restricted) return <StatusBadge tone="danger" icon={<Lock className="size-3.5 shrink-0" aria-hidden />}>Restricted: approved prescription only</StatusBadge>;
  if (required) return <StatusBadge tone="warning" icon={<FileText className="size-3.5 shrink-0" aria-hidden />}>Prescription needed</StatusBadge>;
  return <StatusBadge tone="neutral" icon={<CheckCircle2 className="size-3.5 shrink-0" aria-hidden />}>No prescription needed</StatusBadge>;
}
