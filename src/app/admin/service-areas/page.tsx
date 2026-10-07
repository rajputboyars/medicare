"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch, post } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageTitle, QueryBoundary, Select, SkeletonList } from "@/components/ui";
import type { ServiceArea } from "@/lib/types";

type A = Omit<ServiceArea, "launchSignups"> & { launchSignups: number };

export default function ServiceAreas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["service-areas"], queryFn: () => api<A[]>("/api/admin/service-areas") });
  const [f, setF] = useState({ level: "PINCODE", name: "", state: "Uttar Pradesh", district: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["service-areas"] });
  const toggle = useMutation({ mutationFn: (v: { id: string; active: boolean }) => patch(`/api/admin/service-areas/${v.id}`, { active: v.active }), onSuccess: refresh });
  const add = useMutation({
    mutationFn: () => post("/api/admin/service-areas", { level: f.level, name: f.name, state: f.state, district: f.district || undefined, pincode: f.level === "PINCODE" ? f.name : undefined, active: false }),
    onSuccess: () => { setF({ ...f, name: "" }); refresh(); },
  });
  return (
    <>
      <PageTitle title="Service areas" subtitle="Activate location by location. Customers outside active areas see “We're coming to your area” and can leave their mobile number." />
      <Card className="mb-4 grid gap-3 sm:grid-cols-4">
        <Select label="Level" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{["STATE", "DISTRICT", "TOWN", "PINCODE"].map((l) => <option key={l}>{l}</option>)}</Select>
        <Input label={f.level === "PINCODE" ? "Pincode" : "Name"} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Input label="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
        <Input label="District" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} />
        <div className="sm:col-span-4"><Button loading={add.isPending} disabled={!f.name.trim()} onClick={() => add.mutate()}>Add area (inactive)</Button></div>
        {add.isError && <div className="sm:col-span-4"><ErrorState message={(add.error as Error).message} /></div>}
      </Card>
      <QueryBoundary query={q} skeleton={<SkeletonList rows={4} height="h-16" />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No areas yet" />}>
        {(list) => <ul className="space-y-2">{list.map((a) => (
          <Card as="li" key={a.id} className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold">{a.name} <Badge tone="gray">{a.level.toLowerCase()}</Badge></p><p className="text-sm text-muted">{[a.district, a.state].filter(Boolean).join(", ")} · {a.launchSignups} waiting for launch</p></div>
            <Button variant={a.active ? "secondary" : "primary"} loading={toggle.isPending && toggle.variables?.id === a.id} onClick={() => toggle.mutate({ id: a.id, active: !a.active })}>{a.active ? "Deactivate" : "Activate"}</Button>
          </Card>))}</ul>}
      </QueryBoundary>
    </>
  );
}
