"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, upload } from "@/lib/api";
import { useCart } from "@/lib/store";
import { useMe } from "@/lib/hooks";
import { PrescriptionPicker } from "@/components/prescription-picker";
import { Button, Card, LinkButton, Notice, PageTitle, Select, Success, Textarea, Badge, SkeletonList, QueryBoundary, EmptyState } from "@/components/ui";
import type { FamilyMember, Prescription } from "@/lib/types";

const STATUS: Record<string, [string, "green" | "amber" | "red" | "gray"]> = {
  RECEIVED: ["Prescription received", "gray"], UNDER_REVIEW: ["Under pharmacist review", "amber"], APPROVED: ["Approved", "green"],
  REJECTED: ["Could not be verified", "red"], NEEDS_CLARIFICATION: ["Pharmacist needs a clearer copy", "amber"],
};

function UploadPrescription() {
  const me = useMe();
  const router = useRouter();
  const forOrder = useSearchParams().get("order");
  const qc = useQueryClient();
  const cart = useCart();
  const [file, setFile] = useState<File | null>(null);
  const [member, setMember] = useState("");
  const [meds, setMeds] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string>();

  const family = useQuery({ queryKey: ["family"], queryFn: () => api<FamilyMember[]>("/api/family"), enabled: !!me.data });
  const mine = useQuery({ queryKey: ["prescriptions"], queryFn: () => api<Omit<Prescription, "fileKey">[]>("/api/prescriptions"), enabled: !!me.data });

  const send = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.set("file", file!);
      if (member) f.set("familyMemberId", member);
      f.set("requestedMedicines", meds.split(/[\n,]/).map((s) => s.trim()).filter(Boolean).join(","));
      f.set("consent", String(consent));
      return upload<{ id: string; status: string }>("/api/prescriptions", f);
    },
    onSuccess: async (r) => {
      qc.invalidateQueries({ queryKey: ["prescriptions"] });
      if (forOrder) {
        // Replacing the prescription of an order the pharmacist asked a clearer copy for
        await post(`/api/orders/${forOrder}`, { action: "attach_prescription", prescriptionId: r.id });
        qc.invalidateQueries({ queryKey: ["order", forOrder] });
        router.replace(`/orders/${forOrder}`);
      } else cart.attachPrescription(r.id);
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (!file) return setErr("Please add your prescription photo or PDF");
    if (!consent) return setErr("Please allow us to share this prescription with the pharmacist");
    send.mutate();
  }

  if (me.isPending) return <SkeletonList />;
  if (!me.data) {
    return (
      <>
        <PageTitle title="Upload Prescription" />
        <Card className="space-y-3">
          <p className="font-semibold">Log in to upload and track your prescription.</p>
          <div className="flex flex-wrap gap-2"><LinkButton href="/login?next=/upload-prescription">Log in</LinkButton><LinkButton href="/quick-order" variant="secondary">No account? Call me instead</LinkButton></div>
        </Card>
      </>
    );
  }

  const chips = meds.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  return (
    <>
      <PageTitle title="Upload Prescription" subtitle="A pharmacist checks it, then you confirm and pay. Takes 3 steps." />
      <ol className="mb-4 flex gap-2 text-sm font-semibold" aria-label="Steps">
        {["Upload", "Pharmacist checks", "You confirm"].map((s, i) => <li key={s} className="flex-1 rounded-xl bg-brand-50 px-3 py-2 text-brand-800">{i + 1}. {s}</li>)}
      </ol>

      {send.isSuccess ? (
        <div className="space-y-4">
          <Success title="Prescription received">It is saved safely and only the pharmacist you order from can see it.</Success>
          {chips.length > 0 && (
            <Card><p className="mb-2 font-bold">Add your medicines to the order</p>
              <div className="flex flex-wrap gap-2">{chips.map((c) => <Link key={c} href={`/medicines?q=${encodeURIComponent(c)}`} className="inline-flex min-h-11 items-center rounded-2xl border-2 border-brand-600 px-4 font-semibold text-brand-800">{c}</Link>)}</div></Card>
          )}
          <div className="flex flex-wrap gap-2"><LinkButton href="/medicines">Choose medicines</LinkButton><LinkButton href="/checkout" variant="secondary">Go to cart</LinkButton></div>
        </div>
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-5" noValidate>
            {(send.isError || err) && <Notice tone="red">{err ?? (send.error as Error).message}</Notice>}
            <PrescriptionPicker file={file} onChange={setFile} />
            <Select label="Who is this for?" value={member} onChange={(e) => setMember(e.target.value)}>
              <option value="">Myself</option>
              {family.data?.filter((f) => f.relationship !== "SELF").map((f) => <option key={f.id} value={f.id}>{f.name} ({f.relationship.toLowerCase()})</option>)}
            </Select>
            <Textarea label="Medicines written on it (optional)" hint="One per line or separated by commas. This helps you add them to your order quickly." value={meds} onChange={(e) => setMeds(e.target.value)} />
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-6 shrink-0 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I allow the pharmacist to view this prescription to prepare my order.</span></label>
            <Button type="submit" className="w-full" loading={send.isPending}>Upload Prescription</Button>
          </form>
        </Card>
      )}

      <section className="mt-8" aria-labelledby="mine">
        <h2 id="mine" className="mb-3 text-xl font-extrabold">Your prescriptions</h2>
        <QueryBoundary query={mine} skeleton={<SkeletonList rows={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No prescriptions yet" body="Upload one above to get started." />}>
          {(list) => <ul className="space-y-2">{list.map((r) => {
            const [label, tone] = STATUS[r.status];
            return (
              <Card as="li" key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="font-semibold">{r.fileName}</p><p className="text-sm text-muted">{new Date(r.createdAt).toLocaleDateString("en-IN")}{r.reviewNote ? ` · ${r.reviewNote}` : ""}</p></div>
                <div className="flex items-center gap-2"><Badge tone={tone}>{label}</Badge>
                  <Button variant="ghost" className="min-h-10 py-1" onClick={() => { cart.attachPrescription(r.id); }}>{cart.prescriptionId === r.id ? "Selected for cart" : "Use for order"}</Button></div>
              </Card>
            );
          })}</ul>}
        </QueryBoundary>
      </section>
    </>
  );
}

export default function UploadPrescriptionPage() {
  return <Suspense fallback={<SkeletonList />}><UploadPrescription /></Suspense>;
}
