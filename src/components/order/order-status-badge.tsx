import { Bike, CheckCircle2, ClipboardCheck, Clock, FileSearch, Package, PackageCheck, PackageOpen, XCircle, type LucideIcon } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/order-machine";
import type { OrderStatus } from "@/lib/types";

const TONE: Record<OrderStatus, StatusTone> = {
  PENDING: "warning", PRESCRIPTION_REVIEW: "warning", PRESCRIPTION_APPROVED: "info", CONFIRMED: "info", PREPARING: "info", READY_FOR_PICKUP: "info",
  RIDER_ASSIGNED: "info", PICKED_UP: "info", OUT_FOR_DELIVERY: "info", DELIVERED: "success", CANCELLED: "danger",
};
export const STATUS_ICON: Record<OrderStatus, LucideIcon> = {
  PENDING: Clock, PRESCRIPTION_REVIEW: FileSearch, PRESCRIPTION_APPROVED: ClipboardCheck, CONFIRMED: CheckCircle2, PREPARING: PackageOpen, READY_FOR_PICKUP: Package,
  RIDER_ASSIGNED: Bike, PICKED_UP: PackageCheck, OUT_FOR_DELIVERY: Bike, DELIVERED: CheckCircle2, CANCELLED: XCircle,
};

/** The single badge for an order's status, used in customer, pharmacy and admin screens. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const Icon = STATUS_ICON[status];
  return <StatusBadge tone={TONE[status]} icon={<Icon className="size-3.5 shrink-0" aria-hidden />}>{STATUS_LABEL[status]}</StatusBadge>;
}
