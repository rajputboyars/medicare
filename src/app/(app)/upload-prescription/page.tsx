"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, FileSearch, XCircle } from "lucide-react";
import { api, post, upload } from "@/lib/api";
import { useCart } from "@/lib/store";
import { useMe, useOnline } from "@/lib/hooks";
import { PrescriptionPicker } from "@/components/prescription-picker";
import { FamilyPicker } from "@/components/customer/family-picker";
import { Button, Card, EmptyState, LinkButton, Notice, PageTitle, QueryBoundary, SectionHeader, SkeletonList, StatusBadge, Success, Textarea, type StatusTone } from "@/components/ui";
import type { Prescription, PrescriptionStatus } from "@/lib/types";

const STATUS: Record<PrescriptionStatus, { label: string; tone: StatusTone; icon: typeof Clock }> = {
  RECEIVED: { label: "Received", tone: "neutral", icon: Clock },
  UNDER_REVIEW: { label: "Pharmacist is checking", tone: "warning", icon: FileSearch },
  APPROVED: { label: "Approved", tone: "success", icon: CheckCircle2 },
  REJECTED: { label: "Could not be verified", tone: "danger", icon: XCircle },
  NEEDS_CLARIFICATION: { label: "Needs a clearer photo", tone: "warning", icon: FileSearch },
};

function UploadPrescription() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const cart = useCart();
  const online = useOnline();
  const forOrder = useSearchParams().get("order");
  const [file, setFile] = useState<File | null>(null);
  const [member, setMember] = useState("");
  const [meds, setMeds] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string>();

  const mine = useQuery({ queryKey: ["prescriptions"], queryFn: () => api<Omit<Prescription, "fileKey">[]>("/api/prescriptions"), enabled: me.data?.role === "CUSTOMER" });

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
        await post(`/api/orders/${forOrder}`, { action: "attach_prescription", prescriptionId: r.id }); // replaces the one the pharmacist could not read
        qc.invalidateQueries({ queryKey: ["order", forOrder] });
        router.replace(`/orders/${forOrder}`);
      } else cart.attachPrescription(r.id);
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    if (!file) return setErr("Please add a photo or PDF of your prescription.");
    if (!consent) return setErr("Please tick the box so the pharmacist can see your prescription.");
    send.mutate();
  }

  if (me.isPending) return <SkeletonList />;
  if (me.data?.role !== "CUSTOMER") {
    return (
      <>
        <PageTitle title="Upload Prescription" />
        <Card className="space-y-3"><p className="t-body font-semibold">Log in to upload and follow your prescription.</p>
          <div className="flex flex-wrap gap-2"><LinkButton href="/login?next=/upload-prescription">Log in</LinkButton><LinkButton href="/quick-order" variant="secondary">No account? Call me instead</LinkButton></div></Card>
      </>
    );
  }

  const chips = meds.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  return (
    <>
      <PageTitle title="Upload Prescription" back={forOrder ? { href: `/orders/${forOrder}`, label: "Back to order" } : undefined} />
      <div className="mb-4"><Notice tone="blue" title="A pharmacist will verify your prescription before your order is confirmed.">It is saved privately. Only the pharmacy you order from can see it, and delivery partners never can.</Notice></div>

      {send.isSuccess && !forOrder ? (
        <div className="space-y-4">
          <Success title="Prescription received">Next, choose your medicines. The pharmacist will check it when you place the order.</Success>
          {chips.length > 0 && (
            <Card><p className="t-card mb-2">Add your medicines to the order</p>
              <div className="flex flex-wrap gap-2">{chips.map((c) => <Link key={c} href={`/medicines?q=${encodeURIComponent(c)}`} className="tap inline-flex items-center rounded-pill border-2 border-brand-600 px-4 font-semibold text-brand-800 hover:bg-brand-50">{c}</Link>)}</div></Card>
          )}
          <div className="flex flex-wrap gap-2"><LinkButton href="/medicines" size="lg">Choose medicines</LinkButton><LinkButton href="/checkout" variant="secondary" size="lg">Go to cart</LinkButton></div>
        </div>
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-6" noValidate>
            {(send.isError || err) && <Notice tone="red">{err ?? (send.error as Error).message}</Notice>}
            <PrescriptionPicker file={file} onChange={setFile} />
            <FamilyPicker value={member} onChange={setMember} label="Who is this prescription for?" />
            <Textarea label="Medicines written on it" hint="Optional. One per line or separated by commas. It helps you add them to your order quickly." value={meds} onChange={(e) => setMeds(e.target.value)} />
            <label className="flex items-start gap-3 rounded-control bg-surface-2 p-3"><input type="checkbox" className="mt-0.5 size-6 shrink-0 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="t-body">I allow the pharmacist to view this prescription to prepare my order.</span></label>
            {!online && <Notice tone="amber">You are offline. Connect to the internet to upload.</Notice>}
            <Button type="submit" size="lg" className="w-full" loading={send.isPending} disabled={!online}>Upload Prescription</Button>
          </form>
        </Card>
      )}

      <section className="mt-8" aria-labelledby="mine"><SectionHeader id="mine" title="Your prescriptions" />
        <QueryBoundary query={mine} skeleton={<SkeletonList rows={2} lines={2} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No prescriptions yet" body="Upload one above to get started." />}>
          {(list) => (
            <ul className="space-y-2">{list.map((r) => {
              const s = STATUS[r.status];
              return (
                <Card as="li" key={r.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0"><p className="t-card truncate">{r.fileName}</p><p className="t-caption">{new Date(r.createdAt).toLocaleDateString("en-IN")}{r.reviewNote ? ` · ${r.reviewNote}` : ""}</p></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={s.tone} icon={<s.icon className="size-3.5" aria-hidden />}>{s.label}</StatusBadge>
                    <Button variant={cart.prescriptionId === r.id ? "soft" : "secondary"} size="sm" className="min-h-11" onClick={() => cart.attachPrescription(r.id)} disabled={r.status === "REJECTED"}>{cart.prescriptionId === r.id ? "Selected for cart" : "Use for order"}</Button>
                  </div>
                </Card>
              );
            })}</ul>
          )}
        </QueryBoundary>
      </section>
    </>
  );
}

export default function UploadPrescriptionPage() {
  return <Suspense fallback={<SkeletonList />}><UploadPrescription /></Suspense>;
}
