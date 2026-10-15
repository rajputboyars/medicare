"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";
import { EntityTable, money, status, when, type Row } from "@/components/admin/entity-table";
import { Button, ErrorState } from "@/components/ui";

const REASON: Record<string, string> = {
  CUSTOMER_UNAVAILABLE: "Customer not at home", WRONG_ADDRESS: "Wrong address", CUSTOMER_REFUSED: "Customer refused", UNABLE_TO_CONTACT: "Could not reach customer",
  UNSAFE_LOCATION: "Unsafe place", RIDER_ISSUE: "Rider problem", OTHER: "Other",
};

/** What support must act on: failed or returned deliveries, and refunds that did not go through. One clear button per case. */
export default function DeliveryIssues() {
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin", "issues"] }); qc.invalidateQueries({ queryKey: ["admin-stats"] }); qc.invalidateQueries({ queryKey: ["admin", "orders"] }); };
  const run = useMutation({
    mutationFn: (v: { id: string; path: string; body: Record<string, unknown>; key?: string }) => {
      // The admin refund route needs an Idempotency-Key; the same key retries the same refund instead of making a new one
      return post(v.path, v.body, v.key ? { "Idempotency-Key": v.key } : undefined);
    },
    onSuccess: refresh,
  });
  const busy = (id: unknown) => run.isPending && run.variables?.id === id;
  return (
    <>
      <EntityTable title="Delivery problems" subtitle="Parcels that could not be delivered, and refunds that need another try." queryKey="issues" url="/api/admin/list/issues" emptyText="No problems right now"
        columns={[
          { key: "orderCode", label: "Order", className: "font-semibold" },
          { key: "kind", label: "What", render: (v) => (v === "REFUND" ? "Refund" : "Delivery") },
          { key: "status", label: "Status", render: status },
          { key: "detail", label: "Why", render: (v) => REASON[String(v)] ?? String(v || "—") },
          { key: "attemptNo", label: "Try", render: (v) => (v ? String(v) : "—") },
          { key: "pharmacy", label: "Pharmacy" }, { key: "rider", label: "Rider" },
          { key: "total", label: "Amount", render: money }, { key: "createdAt", label: "When", render: when },
        ]}
        rowAction={(r: Row) => {
          const id = String(r.id);
          if (r.kind === "REFUND") {
            return <Button className="min-h-10 py-1" loading={busy(id)} onClick={() => run.mutate({ id, path: `/api/admin/payments/${r.paymentId}/refund`, key: String(r.refundKey), body: { reason: "Retry failed refund" } })}>Try refund again</Button>;
          }
          if (r.status === "DELIVERY_FAILED") {
            return (
              <div className="flex flex-wrap gap-2">
                <Button className="min-h-10 py-1" loading={busy(id)} onClick={() => run.mutate({ id, path: `/api/admin/deliveries/${id}/retry`, body: {} })}>Try again</Button>
                <Button variant="secondary" className="min-h-10 py-1" onClick={() => run.mutate({ id, path: `/api/admin/deliveries/${id}/return`, body: {} })}>Bring it back</Button>
              </div>
            );
          }
          if (r.status === "RETURNED_TO_PHARMACY") {
            return <Button variant="danger-outline" className="min-h-10 py-1" loading={busy(id)} onClick={() => run.mutate({ id, path: `/api/admin/orders/${r.orderId}/cancel`, body: { reasonCode: "DELIVERY_FAILED" } })}>Cancel and refund</Button>;
          }
          return <span className="t-caption">Parcel is on its way back</span>;
        }} />
      {run.isError && <div className="mt-3"><ErrorState message={(run.error as Error).message} /></div>}
    </>
  );
}
