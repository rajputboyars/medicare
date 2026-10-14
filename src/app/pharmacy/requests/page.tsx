"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileText, MapPin, Truck, XCircle } from "lucide-react";
import clsx from "clsx";
import { api, post } from "@/lib/api";
import { Button, Card, EmptyState, Input, Modal, PageTitle, QueryBoundary, SkeletonList, StatusBadge } from "@/components/ui";
import { useViewPrescription } from "@/components/pharmacy/order-queue";
import type { RequestResponseKind } from "@/lib/types";

interface Req {
  id: string; medicineQuery: string; strength?: string; quantity: number; pincode: string; createdAt: string; status: string;
  ageMinutes: number; distanceKm?: number; area: string; sharedFileId?: string; hasPrescription: boolean; hasPhoto: boolean; repliesFromOthers: number;
  myResponse?: { response: RequestResponseKind; alternative?: string; restockEta?: string; price?: number; availableQty?: number; prepMinutes?: number };
}
type Kind = "AVAILABLE" | "CAN_ARRANGE" | "NOT_AVAILABLE";

const age = (m: number) => (m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} day ago`);
const REPLIED: Record<RequestResponseKind, string> = { ALTERNATIVE_AVAILABLE: "You suggested another", AVAILABLE: "You said: available", CAN_ARRANGE: "You said: can arrange", NOT_AVAILABLE: "You said: not available" };

function ReplyModal({ r, kind, onClose }: { r: Req; kind: Kind | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(r.myResponse?.price?.toString() ?? "");
  const [qty, setQty] = useState(r.myResponse?.availableQty?.toString() ?? String(r.quantity));
  const [prep, setPrep] = useState(r.myResponse?.prepMinutes?.toString() ?? "15");
  const [when, setWhen] = useState(r.myResponse?.restockEta ?? "");
  const [note, setNote] = useState(r.myResponse?.alternative ?? "");
  const send = useMutation({
    mutationFn: () => post(`/api/pharmacy/requests/${r.id}`, kind === "AVAILABLE"
      ? { response: kind, price: Number(price), availableQty: Number(qty), prepMinutes: Number(prep) }
      : kind === "CAN_ARRANGE" ? { response: kind, alternative: note || "Can arrange", restockEta: when || undefined } : { response: kind }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pharmacy-requests"] }); qc.invalidateQueries({ queryKey: ["pharmacy-dashboard"] }); onClose(); },
  });
  const ready = kind === "AVAILABLE" ? Number(price) > 0 && Number(qty) > 0 && Number(prep) > 0 : kind === "CAN_ARRANGE" ? when.trim().length > 0 : true;
  const title = kind === "AVAILABLE" ? "Yes, we have it" : kind === "CAN_ARRANGE" ? "We can arrange it" : "We do not have it";
  return (
    <Modal open={!!kind} onClose={onClose} title={title} description={`${r.medicineQuery}${r.strength ? ` ${r.strength}` : ""} × ${r.quantity}`}>
      <form onSubmit={(e) => { e.preventDefault(); if (ready) send.mutate(); }} className="space-y-3">
        {kind === "AVAILABLE" && <>
          <Input label="Price for the customer (₹)" required inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} hint="Total for the quantity you can give" />
          <Input label="Quantity you have" required inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Input label="Time to get it ready (minutes)" required inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} />
          <p className="t-caption">Add it to Inventory too, so the customer can order it straight away.</p>
        </>}
        {kind === "CAN_ARRANGE" && <>
          <Input label="How soon can you get it?" required placeholder="e.g. Tomorrow morning" value={when} onChange={(e) => setWhen(e.target.value)} />
          <Input label="Note (optional)" placeholder="e.g. Same salt, other brand" value={note} onChange={(e) => setNote(e.target.value)} />
        </>}
        {kind === "NOT_AVAILABLE" && <p className="t-body">The customer will see that you do not have this medicine.</p>}
        {send.isError && <p role="alert" className="text-sm font-semibold text-emergency">{(send.error as Error).message}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="submit" loading={send.isPending} disabled={!ready} variant={kind === "NOT_AVAILABLE" ? "danger" : "primary"}>Send reply</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Go back</Button>
        </div>
      </form>
    </Modal>
  );
}

function RequestCard({ r }: { r: Req }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const { view, err } = useViewPrescription();
  const fresh = !r.myResponse;
  return (
    <Card as="article" className={clsx("space-y-3", fresh && "border-2 border-warn-line bg-warn-50")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="t-section">{r.medicineQuery}{r.strength ? <span className="font-normal"> {r.strength}</span> : null}</h3>
          <p className="t-support">Quantity: <b>{r.quantity}</b></p>
        </div>
        {fresh ? <StatusBadge tone="warning" icon={<Clock className="size-3.5" aria-hidden />}>New · needs your answer</StatusBadge>
          : <StatusBadge tone={r.myResponse!.response === "NOT_AVAILABLE" ? "neutral" : "success"}>{REPLIED[r.myResponse!.response]}</StatusBadge>}
      </div>
      <p className="t-support flex flex-wrap gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1"><MapPin className="size-4" aria-hidden />{r.area}{r.distanceKm !== undefined ? ` · ${r.distanceKm.toFixed(1)} km` : ""}</span>
        <span className="inline-flex items-center gap-1"><Clock className="size-4" aria-hidden />Asked {age(r.ageMinutes)}</span>
        {r.repliesFromOthers > 0 && <span>{r.repliesFromOthers} other pharmac{r.repliesFromOthers === 1 ? "y has" : "ies have"} replied</span>}
      </p>
      {r.sharedFileId && <Button variant="secondary" size="sm" className="min-h-11" onClick={() => view(r.sharedFileId!)}><FileText className="size-4" aria-hidden /> View {r.hasPrescription ? "prescription" : "photo"}</Button>}
      {err && <p role="alert" className="text-sm font-semibold text-emergency">{err}</p>}
      {r.myResponse?.response === "AVAILABLE" && <p className="t-support">₹{r.myResponse.price} · {r.myResponse.availableQty} available · ready in {r.myResponse.prepMinutes} min</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <Button onClick={() => setKind("AVAILABLE")}><CheckCircle2 className="size-5" aria-hidden /> Available</Button>
        <Button variant="secondary" onClick={() => setKind("CAN_ARRANGE")}><Truck className="size-5" aria-hidden /> Can arrange</Button>
        <Button variant="danger-outline" onClick={() => setKind("NOT_AVAILABLE")}><XCircle className="size-5" aria-hidden /> Not available</Button>
      </div>
      {kind && <ReplyModal r={r} kind={kind} onClose={() => setKind(null)} />}
    </Card>
  );
}

export default function Requests() {
  const q = useQuery({ queryKey: ["pharmacy-requests"], queryFn: () => api<Req[]>("/api/pharmacy/requests"), refetchInterval: 20_000 });
  return (
    <>
      <PageTitle title="Medicine requests" subtitle="Customers nearby are looking for these. A fast reply wins the order." />
      <QueryBoundary query={q} skeleton={<SkeletonList rows={2} lines={4} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No requests right now" body="When a customer nearby looks for a medicine, it shows here." />}>
        {(list) => <div className="grid gap-3 xl:grid-cols-2">{list.map((r) => <RequestCard key={r.id} r={r} />)}</div>}
      </QueryBoundary>
    </>
  );
}
