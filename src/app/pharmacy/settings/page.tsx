"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch } from "@/lib/api";
import { Button, Card, ErrorState, Input, Notice, PageTitle, QueryBoundary, SkeletonList, Success } from "@/components/ui";
import type { Pharmacy } from "@/lib/types";

export default function Settings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pharmacy-settings"], queryFn: () => api<Pharmacy>("/api/pharmacy/settings") });
  const [f, setF] = useState({ openTime: "", closeTime: "", pincodes: "", radius: "", priority: false, accepting: false });
  useEffect(() => {
    if (q.data) setF({ openTime: q.data.openTime, closeTime: q.data.closeTime, pincodes: q.data.servicePincodes.join(", "), radius: String(q.data.deliveryRadiusKm), priority: q.data.priorityDelivery, accepting: q.data.acceptingOrders });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => patch("/api/pharmacy/settings", { openTime: f.openTime, closeTime: f.closeTime, servicePincodes: f.pincodes.split(/[ ,]+/).filter(Boolean), deliveryRadiusKm: Number(f.radius), priorityDelivery: f.priority, acceptingOrders: f.accepting }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pharmacy-settings"] }),
  });
  return (
    <>
      <PageTitle title="Store settings" />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={3} height="h-16" />}>
        {(p) => (
          <Card className="max-w-2xl space-y-4">
            <Notice tone="blue">Licence: {p.drugLicense} · Status: {p.verification.toLowerCase()}. Only the pharmacy owner can change these settings.</Notice>
            <div className="grid gap-4 sm:grid-cols-2"><Input label="Opens at" type="time" value={f.openTime} onChange={(e) => setF({ ...f, openTime: e.target.value })} /><Input label="Closes at" type="time" value={f.closeTime} onChange={(e) => setF({ ...f, closeTime: e.target.value })} /></div>
            <Input label="Service pincodes" hint="Separate with commas" value={f.pincodes} onChange={(e) => setF({ ...f, pincodes: e.target.value })} />
            <Input label="Delivery radius (km)" type="number" min={1} max={30} value={f.radius} onChange={(e) => setF({ ...f, radius: e.target.value })} />
            <label className="flex min-h-12 items-center gap-3 font-semibold"><input type="checkbox" className="size-6 accent-brand-600" checked={f.priority} onChange={(e) => setF({ ...f, priority: e.target.checked })} /> Offer priority delivery</label>
            <label className="flex min-h-12 items-center gap-3 font-semibold"><input type="checkbox" className="size-6 accent-brand-600" checked={f.accepting} onChange={(e) => setF({ ...f, accepting: e.target.checked })} disabled={p.verification !== "VERIFIED"} /> Accepting orders</label>
            {save.isError && <ErrorState message={(save.error as Error).message} />}
            {save.isSuccess && <Success title="Saved" />}
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
          </Card>
        )}
      </QueryBoundary>
    </>
  );
}
