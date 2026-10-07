"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch } from "@/lib/api";
import { Button, Card, ErrorState, Input, PageTitle, QueryBoundary, SkeletonList, Success } from "@/components/ui";
import type { PlatformSettings } from "@/lib/types";

const NUM: [keyof PlatformSettings, string, string][] = [
  ["commissionPercent", "Platform commission (%)", "Charged on the medicine value of each delivered order"],
  ["normalDeliveryFee", "Normal delivery fee (₹)", "Charged to the customer"],
  ["priorityDeliveryFee", "Priority delivery fee (₹)", "Charged to the customer"],
  ["freeDeliveryAbove", "Free normal delivery above (₹)", "Order value that waives the normal fee"],
  ["riderPayoutNormal", "Rider payout, normal (₹)", "Paid to the rider per delivery"],
  ["riderPayoutPriority", "Rider payout, priority (₹)", "Paid to the rider per delivery"],
];

export default function AdminSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-settings"], queryFn: () => api<PlatformSettings>("/api/admin/settings") });
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setF(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, String(v)]))); }, [q.data]);
  const save = useMutation({
    mutationFn: () => patch("/api/admin/settings", { ...Object.fromEntries(NUM.map(([k]) => [k, Number(f[k])])), supportPhone: f.supportPhone }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-settings"] }),
  });
  return (
    <>
      <PageTitle title="Settings" subtitle="Pricing and payout rules. Changes apply to new orders only." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={4} height="h-16" />}>
        {() => (
          <Card className="max-w-2xl space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">{NUM.map(([k, label, hint]) => <Input key={k} label={label} hint={hint} type="number" min={0} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />)}</div>
            <Input label="Support phone" value={f.supportPhone ?? ""} onChange={(e) => setF({ ...f, supportPhone: e.target.value })} />
            {save.isError && <ErrorState message={(save.error as Error).message} />}
            {save.isSuccess && <Success title="Settings saved" />}
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save settings</Button>
          </Card>
        )}
      </QueryBoundary>
    </>
  );
}
