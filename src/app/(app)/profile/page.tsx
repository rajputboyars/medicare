"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LogOut, Phone, Trash2, Users } from "lucide-react";
import { api, del, patch, post } from "@/lib/api";
import { SUPPORT_PHONE, SUPPORT_WA, useMe, useT } from "@/lib/hooks";
import { usePrefs } from "@/lib/store";
import { AddressForm } from "@/components/address-form";
import { InstallCard } from "@/components/pwa/install";
import { Button, Card, EmptyState, ErrorState, LinkButton, Notice, PageTitle, QueryBoundary, SkeletonList, Success } from "@/components/ui";
import type { Address, SupportTicket } from "@/lib/types";

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-14 cursor-pointer items-center justify-between gap-4">
      <span><span className="block font-semibold">{label}</span>{hint && <span className="block text-sm text-muted">{hint}</span>}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-7 shrink-0 accent-brand-600" />
    </label>
  );
}

export default function Profile() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const prefs = usePrefs();
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);

  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/api/addresses"), enabled: !!me.data });
  const tickets = useQuery({ queryKey: ["tickets"], queryFn: () => api<SupportTicket[]>("/api/support"), enabled: !!me.data });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/addresses/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["addresses"] }) });
  const consent = useMutation({ mutationFn: (b: Record<string, unknown>) => patch("/api/me", b), onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }) });
  const ticket = useMutation({ mutationFn: () => post("/api/support", { subject: "Help needed", message: msg }), onSuccess: () => { setSent(true); setMsg(""); qc.invalidateQueries({ queryKey: ["tickets"] }); } });

  async function logout() {
    await post("/api/auth/logout", {});
    qc.clear();
    router.replace("/");
    router.refresh();
  }
  async function exportData() {
    const d = await api<unknown>("/api/me/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "my-medicare-data.json"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageTitle title={t("navProfile")} />
      <div className="mb-4 empty:hidden"><InstallCard /></div>
      {/* Accessibility & language are available even when logged out */}
      <Card className="mb-4" as="section" aria-labelledby="acc">
        <h2 id="acc" className="mb-1 text-lg font-extrabold">Display &amp; language</h2>
        <div className="divide-y divide-line">
          <Toggle label={t("largeText")} hint="Makes all text and buttons bigger" checked={prefs.large} onChange={prefs.setLarge} />
          <Toggle label="High contrast" hint="Stronger text and borders" checked={prefs.highContrast} onChange={prefs.setHighContrast} />
          <div className="flex min-h-14 items-center justify-between gap-4"><span className="font-semibold">{t("language")}</span>
            <div role="radiogroup" aria-label={t("language")} className="flex gap-2">{([["en", "English"], ["hi", "हिन्दी"]] as const).map(([l, label]) => <button key={l} role="radio" aria-checked={prefs.lang === l} onClick={() => { prefs.setLang(l); if (me.data) consent.mutate({ language: l }); }} className={`min-h-11 rounded-2xl border-2 px-4 font-semibold ${prefs.lang === l ? "border-brand-600 bg-brand-50" : "border-line"}`}>{label}</button>)}</div></div>
        </div>
      </Card>

      {me.isPending ? <SkeletonList rows={2} /> : !me.data ? (
        <EmptyState title="You are not logged in" body="Log in to see your addresses, family and orders." action={<LinkButton href="/login?next=/profile">{t("login")}</LinkButton>} />
      ) : (
        <div className="space-y-4">
          <Card as="section"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xl font-extrabold">{me.data.name}</p><p className="text-muted">{me.data.mobile}{me.data.email ? ` · ${me.data.email}` : ""}</p></div>
            <Button variant="secondary" onClick={logout}><LogOut className="size-5" aria-hidden /> {t("logout")}</Button></div></Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/family" className="flex min-h-16 items-center gap-3 rounded-[1.25rem] border border-line bg-white p-4 font-bold shadow-soft"><Users className="size-6 text-brand-600" aria-hidden /> Family profiles</Link>
            <Link href="/repeat" className="flex min-h-16 items-center gap-3 rounded-[1.25rem] border border-line bg-white p-4 font-bold shadow-soft">Monthly medicines</Link>
          </div>

          <Card as="section" aria-labelledby="addr"><div className="mb-3 flex items-center justify-between"><h2 id="addr" className="text-lg font-extrabold">My addresses</h2><Button variant="soft" onClick={() => setAdding(true)}>+ Add</Button></div>
            {adding && <div className="mb-4 rounded-2xl border border-line p-3"><AddressForm onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} /></div>}
            <QueryBoundary query={addresses} skeleton={<SkeletonList rows={1} height="h-16" />} isEmpty={(d) => d.length === 0} empty={<p className="text-muted">No saved addresses yet.</p>}>
              {(list) => <ul className="space-y-2">{list.map((a) => <li key={a.id} className="flex items-start justify-between gap-2 rounded-2xl border border-line p-3"><p><b>{a.label}</b> · {a.contactName}<br /><span className="text-sm">{a.houseDescription}, {a.area}, {a.village ? `${a.village}, ` : ""}{a.town}, {a.district} – {a.pincode}</span><br /><span className="text-sm text-muted">Landmark: {a.landmark}</span></p>
                <Button variant="ghost" className="min-w-12 px-0 text-emergency" onClick={() => remove.mutate(a.id)} aria-label={`Delete address ${a.label}`}><Trash2 className="size-5" aria-hidden /></Button></li>)}</ul>}
            </QueryBoundary></Card>

          <Card as="section" aria-labelledby="priv"><h2 id="priv" className="mb-1 text-lg font-extrabold">Privacy &amp; consent</h2>
            <p className="mb-2 text-sm text-muted">Your prescriptions and health details are private. Only the pharmacy preparing your order can see them. Delivery partners never see them.</p>
            <div className="divide-y divide-line">
              <Toggle label="Allow processing of my health information" hint="Needed to order prescription medicines" checked={me.data.consent.healthData} onChange={(v) => consent.mutate({ healthData: v })} />
              <Toggle label="Offers and health tips" hint="Optional SMS / WhatsApp promotions" checked={me.data.consent.marketing} onChange={(v) => consent.mutate({ marketing: v })} />
            </div>
            {consent.isError && <ErrorState message={(consent.error as Error).message} />}
            <Button variant="secondary" className="mt-3" onClick={exportData}><Download className="size-5" aria-hidden /> Download my data</Button></Card>

          <Card as="section" aria-labelledby="help"><h2 id="help" className="mb-2 text-lg font-extrabold">Help &amp; support</h2>
            <div className="mb-3 flex flex-wrap gap-2"><a href={`tel:${SUPPORT_PHONE}`} className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand-600 px-5 font-semibold text-white"><Phone className="size-5" aria-hidden /> {t("callSupport")}</a>
              <a href={`https://wa.me/${SUPPORT_WA}`} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-brand-600 px-5 font-semibold text-brand-800">{t("whatsappSupport")}</a></div>
            {sent ? <Success title="We got your message">Our team will get back to you soon.</Success> : (
              <form onSubmit={(e) => { e.preventDefault(); if (msg.trim().length >= 5) ticket.mutate(); }} className="space-y-2">
                <label className="block text-sm font-semibold" htmlFor="m">Tell us what you need help with</label>
                <textarea id="m" value={msg} onChange={(e) => setMsg(e.target.value)} rows={3} className="w-full rounded-2xl border-2 border-line p-3" />
                {ticket.isError && <Notice tone="red">{(ticket.error as Error).message}</Notice>}
                <Button type="submit" variant="secondary" loading={ticket.isPending} disabled={msg.trim().length < 5}>Send message</Button>
              </form>)}
            {tickets.data && tickets.data.length > 0 && <p className="mt-3 text-sm text-muted">{tickets.data.length} previous request(s). Latest: {tickets.data[0].status.toLowerCase().replace("_", " ")}.</p>}
            <p className="mt-3 text-sm text-muted">Cancellation: free before pickup. Refunds: 3–5 working days to the original payment method.</p></Card>
        </div>
      )}
    </>
  );
}
