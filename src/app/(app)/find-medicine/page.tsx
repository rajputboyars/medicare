"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, post } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { useMe } from "@/lib/hooks";
import { medicineRequestSchema } from "@/lib/validation";
import { Badge, Button, Card, EmptyState, Input, Notice, PageTitle, QueryBoundary, SkeletonList, Success } from "@/components/ui";
import type { MedicineRequest, MedicineRequestResponse } from "@/lib/types";

type Req = MedicineRequest & { responses: (MedicineRequestResponse & { pharmacyName?: string })[]; pharmaciesNotified?: number };

function Page() {
  const sp = useSearchParams();
  const pincode = useLocation((s) => s.pincode);
  const me = useMe();
  const [query, setQuery] = useState(sp.get("q") ?? "");
  const [mobile, setMobile] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mine = useQuery({ queryKey: ["med-requests"], queryFn: () => api<Req[]>("/api/medicine-requests"), enabled: !!me.data, refetchInterval: 20_000 });

  const send = useMutation({
    mutationFn: (v: { medicineQuery: string; mobile: string; pincode: string }) => post<Req>("/api/medicine-requests", v),
    onSuccess: () => mine.refetch(),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = medicineRequestSchema.safeParse({ medicineQuery: query, mobile: mobile || me.data?.mobile, pincode });
    if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    send.mutate(r.data);
  }

  return (
    <>
      <PageTitle title="Find this medicine for me" subtitle="We ask nearby verified pharmacies and message you when someone has it." />
      <Card>
        {send.isSuccess ? (
          <Success title="Request sent">We asked {send.data.pharmaciesNotified} nearby pharmacies about <b>{send.data.medicineQuery}</b>. You will get an SMS when one has it.</Success>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            {send.isError && <Notice tone="red">{(send.error as Error).message}</Notice>}
            <Input label="Medicine name" required value={query} onChange={(e) => setQuery(e.target.value)} error={errors.medicineQuery} placeholder="e.g. Insulin Glargine pen" />
            {!me.data && <Input label="Your mobile number" required inputMode="tel" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} error={errors.mobile} hint="We will call or message you here." />}
            <p className="text-sm text-muted">Delivery area pincode: <b>{pincode}</b></p>
            <Notice tone="blue">Pharmacies reply with: Available, Alternative available, Out of stock, or expected restock time. Prescription medicines still need a valid prescription.</Notice>
            <Button type="submit" className="w-full" loading={send.isPending}>Ask nearby pharmacies</Button>
          </form>
        )}
      </Card>

      {me.data && (
        <section className="mt-8" aria-labelledby="mine">
          <h2 id="mine" className="mb-3 text-xl font-extrabold">Your requests</h2>
          <QueryBoundary query={mine} skeleton={<SkeletonList rows={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No requests yet" />}>
            {(list) => (
              <ul className="space-y-3">
                {list.map((r) => (
                  <Card as="li" key={r.id}>
                    <div className="flex items-center justify-between gap-2"><p className="font-bold">{r.medicineQuery}</p>
                      <Badge tone={r.status === "FOUND" ? "green" : "amber"}>{r.status === "FOUND" ? "Found!" : "Waiting for replies"}</Badge></div>
                    {r.responses.length === 0 ? <p className="text-sm text-muted">No replies yet.</p> : (
                      <ul className="mt-2 space-y-1 text-sm">{r.responses.map((x) => (
                        <li key={x.pharmacyId}><b>{x.pharmacyName}</b>: {x.response === "AVAILABLE" ? "Available" : x.response === "ALTERNATIVE" ? `Alternative available${x.alternative ? ` (${x.alternative})` : ""}` : `Out of stock${x.restockEta ? `, expected ${x.restockEta}` : ""}`}</li>
                      ))}</ul>
                    )}
                  </Card>
                ))}
              </ul>
            )}
          </QueryBoundary>
        </section>
      )}
    </>
  );
}

export default function FindMedicinePage() {
  return <Suspense fallback={<SkeletonList />}><Page /></Suspense>;
}
