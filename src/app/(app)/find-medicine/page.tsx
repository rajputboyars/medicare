"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, SearchCheck } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { useMe, useOnline } from "@/lib/hooks";
import { medicineRequestSchema } from "@/lib/validation";
import { PrescriptionPicker } from "@/components/prescription-picker";
import { RequestTracker, type TrackedRequest } from "@/components/customer/request-tracker";
import { Button, Card, EmptyState, ErrorState, Input, Notice, PageTitle, QueryBoundary, Select, SectionHeader, SkeletonList, Toggle } from "@/components/ui";
import type { Prescription } from "@/lib/types";

function Page() {
  const sp = useSearchParams();
  const qc = useQueryClient();
  const pincode = useLocation((s) => s.pincode);
  const me = useMe();
  const online = useOnline();
  const [query, setQuery] = useState(sp.get("q") ?? "");
  const [strength, setStrength] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [photo, setPhoto] = useState<File | null>(null);
  const [needsRx, setNeedsRx] = useState(false);
  const [rxId, setRxId] = useState("");
  const [mobile, setMobile] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string>();
  const [guestRequest, setGuestRequest] = useState<TrackedRequest>();

  const signedIn = me.data?.role === "CUSTOMER";
  const mine = useQuery({ queryKey: ["med-requests"], queryFn: () => api<TrackedRequest[]>("/api/medicine-requests"), enabled: signedIn, refetchInterval: 8_000 });
  const prescriptions = useQuery({ queryKey: ["prescriptions"], queryFn: () => api<Omit<Prescription, "fileKey">[]>("/api/prescriptions"), enabled: signedIn && needsRx });

  const send = useMutation({
    mutationFn: async () => {
      const fields = { medicineQuery: query, strength, quantity, mobile: mobile || me.data?.mobile, pincode, prescriptionId: needsRx ? rxId : "" };
      const parsed = medicineRequestSchema.parse(fields);
      const form = new FormData();
      Object.entries(parsed).forEach(([k, v]) => v !== undefined && v !== "" && form.set(k, String(v)));
      if (photo) form.set("photo", photo);
      return api<TrackedRequest>("/api/medicine-requests", { method: "POST", body: form });
    },
    onSuccess: (r) => { setActive(r.id); if (!signedIn) setGuestRequest(r); qc.invalidateQueries({ queryKey: ["med-requests"] }); },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = medicineRequestSchema.safeParse({ medicineQuery: query, strength, quantity, mobile: mobile || me.data?.mobile, pincode, prescriptionId: needsRx ? rxId : "" });
    if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
    if (needsRx && !rxId) return setErrors({ prescriptionId: "Choose your prescription, or upload one first" });
    setErrors({});
    send.mutate();
  }

  const tracked = mine.data?.find((r) => r.id === active) ?? guestRequest;
  const others = mine.data?.filter((r) => r.id !== active) ?? [];
  const serverError = send.error instanceof ApiClientError ? send.error.message : send.error ? "Please check the details and try again." : undefined;

  return (
    <>
      <PageTitle title="Find My Medicine" subtitle="Tell us what you need. We ask nearby verified pharmacies and tell you who has it." />

      {tracked ? (
        <div className="space-y-4">
          <RequestTracker request={tracked} />
          {!signedIn && <Notice tone="blue" title="We will message you">We will SMS {tracked.mobile} when a pharmacy replies.</Notice>}
          <Button variant="secondary" onClick={() => { setActive(undefined); setGuestRequest(undefined); send.reset(); setQuery(""); setStrength(""); setQuantity(1); setPhoto(null); }}>Ask for another medicine</Button>
        </div>
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-5" noValidate>
            {serverError && <Notice tone="red">{serverError}</Notice>}
            <Input label="Medicine name" required value={query} onChange={(e) => setQuery(e.target.value)} error={errors.medicineQuery} placeholder="e.g. Insulin Glargine pen" autoComplete="off" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Strength" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 500 mg" hint="Optional. It is written on the strip or box." />
              <div>
                <p className="t-label mb-1.5">How many?</p>
                <div className="flex items-center gap-2" role="group" aria-label="Quantity">
                  <Button type="button" variant="secondary" className="w-14 !px-0" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Decrease quantity"><Minus className="size-5" aria-hidden /></Button>
                  <span className="t-number w-12 text-center text-2xl" aria-live="polite">{quantity}</span>
                  <Button type="button" variant="secondary" className="w-14 !px-0" onClick={() => setQuantity((q) => Math.min(99, q + 1))} aria-label="Increase quantity"><Plus className="size-5" aria-hidden /></Button>
                </div>
                {errors.quantity && <p role="alert" className="mt-1 text-sm font-semibold text-emergency">{errors.quantity}</p>}
              </div>
            </div>

            <PrescriptionPicker file={photo} onChange={setPhoto} label="Photo of the medicine" required={false} allowPdf={false} hint="A photo of the strip or box helps the pharmacy find the exact one." />

            <div className="rounded-card border border-line p-1 px-4">
              <Toggle label="This medicine needs a prescription" hint="Share a prescription so the pharmacy can check it" checked={needsRx} onChange={(v) => { setNeedsRx(v); if (!v) setRxId(""); }} />
              {needsRx && (
                <div className="pb-4">
                  {signedIn ? (
                    <QueryBoundary query={prescriptions} skeleton={<SkeletonList rows={1} lines={2} />} isEmpty={(d) => d.length === 0}
                      empty={<p className="t-support">You have no prescription yet. <Link href="/upload-prescription" className="font-bold text-brand-700 underline">Upload one first</Link>, then come back.</p>}>
                      {(list) => (
                        <Select label="Choose your prescription" value={rxId} onChange={(e) => setRxId(e.target.value)} error={errors.prescriptionId}>
                          <option value="">Select…</option>
                          {list.filter((r) => r.status !== "REJECTED").map((r) => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleDateString("en-IN")} · {r.fileName}</option>)}
                        </Select>
                      )}
                    </QueryBoundary>
                  ) : <p className="t-support"><Link href="/login?next=/find-medicine" className="font-bold text-brand-700 underline">Log in</Link> to attach a prescription.</p>}
                </div>
              )}
            </div>

            {!signedIn && !me.isPending && <Input label="Your mobile number" required inputMode="tel" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} error={errors.mobile} hint="We will message you here when we find it." />}

            <p className="t-caption">Your request, photo and prescription are shared only with verified pharmacies that deliver to <b className="text-ink">{pincode}</b>.</p>
            {!online && <Notice tone="amber">You are offline. Connect to the internet to send your request.</Notice>}
            <Button type="submit" size="lg" className="w-full" loading={send.isPending} disabled={!online}><SearchCheck className="size-5" aria-hidden /> Ask nearby pharmacies</Button>
          </form>
        </Card>
      )}

      {signedIn && (
        <section className="mt-8" aria-labelledby="mine"><SectionHeader id="mine" title="Your earlier requests" />
          <QueryBoundary query={mine} skeleton={<SkeletonList rows={2} lines={2} />} isEmpty={() => others.length === 0 && !tracked} empty={<EmptyState title="No requests yet" body="When you ask for a medicine, you can follow the replies here." />}>
            {() => (others.length === 0 ? <p className="t-support">Nothing else yet.</p> : (
              <div className="space-y-3">{others.map((r) => <RequestTracker key={r.id} request={r} />)}</div>
            ))}
          </QueryBoundary>
        </section>
      )}
      {send.isError && !serverError && <div className="mt-4"><ErrorState onRetry={() => send.mutate()} /></div>}
    </>
  );
}

export default function FindMedicinePage() {
  return <Suspense fallback={<SkeletonList />}><Page /></Suspense>;
}
