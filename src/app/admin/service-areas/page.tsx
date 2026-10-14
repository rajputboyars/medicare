"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch, post } from "@/lib/api";
import { Button, Card, EmptyState, ErrorState, Input, PageTitle, QueryBoundary, Select, SkeletonList, StatusBadge } from "@/components/ui";
import type { ServiceArea, ServiceAreaStatus } from "@/lib/types";
import type { StatusTone } from "@/components/ui/status-badge";

type A = Omit<ServiceArea, "launchSignups"> & { launchSignups: number };
const TONE: Record<ServiceAreaStatus, StatusTone> = { ACTIVE: "success", COMING_SOON: "warning", DISABLED: "danger" };
const LABEL: Record<ServiceAreaStatus, string> = { ACTIVE: "Live", COMING_SOON: "Coming soon", DISABLED: "Paused" };

export default function ServiceAreas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["service-areas"], queryFn: () => api<A[]>("/api/admin/service-areas") });
  const [f, setF] = useState({ level: "PINCODE", name: "", state: "Uttar Pradesh", district: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["service-areas"] });
  const setStatus = useMutation({ mutationFn: (v: { id: string; status: ServiceAreaStatus }) => patch(`/api/admin/service-areas/${v.id}`, { status: v.status }), onSuccess: refresh });
  const add = useMutation({
    mutationFn: () => post("/api/admin/service-areas", { level: f.level, name: f.name, state: f.state, district: f.district || undefined, town: f.level === "TOWN" ? f.name : undefined, pincode: f.level === "PINCODE" ? f.name : undefined, status: "COMING_SOON" }),
    onSuccess: () => { setF({ ...f, name: "" }); refresh(); },
  });
  return (
    <>
      <PageTitle title="Service areas" subtitle="Switch areas on one by one. The most specific area wins: a paused pincode stays off even if its district is live." />
      <Card className="mb-4 grid gap-3 sm:grid-cols-4">
        <Select label="Level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{["STATE", "DISTRICT", "TOWN", "PINCODE"].map((l) => <option key={l}>{l}</option>)}</Select>
        <Input label={f.level === "PINCODE" ? "Pincode" : "Name"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
        <Input label="District" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} />
        <div className="sm:col-span-4"><Button loading={add.isPending} disabled={!f.name.trim()} onClick={() => add.mutate()}>Add area (coming soon)</Button></div>
        {add.isError && <div className="sm:col-span-4"><ErrorState message={(add.error as Error).message} /></div>}
      </Card>
      <QueryBoundary query={q} skeleton={<SkeletonList rows={4} lines={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No areas yet" />}>
        {(list) => <ul className="space-y-2">{list.map((a) => (
          <Card as="li" key={a.id} className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold">{a.name} <span className="t-caption">({a.level.toLowerCase()})</span></p><p className="t-support">{[a.district, a.state].filter(Boolean).join(", ")} · {a.launchSignups} waiting for launch</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={TONE[a.status]}>{LABEL[a.status]}</StatusBadge>
              <div className="w-40"><Select label="Change status" value={a.status} onChange={(e) => setStatus.mutate({ id: a.id, status: e.target.value as ServiceAreaStatus })}>
                {(Object.keys(LABEL) as ServiceAreaStatus[]).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</Select></div>
            </div>
          </Card>))}</ul>}
      </QueryBoundary>
    </>
  );
}
