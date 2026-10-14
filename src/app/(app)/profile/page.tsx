"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download, LogOut, MessageCircle, Phone, Plus, Repeat, Trash2, Users } from "lucide-react";
import clsx from "clsx";
import { api, del, patch, post } from "@/lib/api";
import { SUPPORT_PHONE, SUPPORT_WA, useMe, useT } from "@/lib/hooks";
import { usePrefs } from "@/lib/store";
import { AddressForm } from "@/components/address-form";
import { InstallCard } from "@/components/pwa/install";
import { Button, Card, ConfirmationDialog, EmptyState, ErrorState, IconButton, LinkButton, Modal, Notice, PageTitle, QueryBoundary, SectionHeader, SkeletonList, Success, Textarea, Toggle } from "@/components/ui";
import type { Address, SupportTicket } from "@/lib/types";

const row = "tap flex items-center gap-3 rounded-card border border-line bg-surface p-4 font-bold shadow-soft hover:bg-surface-2";

export default function Profile() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Address>();
  const [msg, setMsg] = useState("");
  const [sent, setSent] = useState(false);
  const enabled = me.data?.role === "CUSTOMER";

  const addresses = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/api/addresses"), enabled });
  const tickets = useQuery({ queryKey: ["tickets"], queryFn: () => api<SupportTicket[]>("/api/support"), enabled });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/addresses/${id}`), onSuccess: () => { setRemoving(undefined); qc.invalidateQueries({ queryKey: ["addresses"] }); } });
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
    const a = document.createElement("a"); a.href = url; a.download = "my-dawadost-data.json"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageTitle title={t("navProfile")} />
      <div className="mb-4 empty:hidden"><InstallCard /></div>

      {me.isPending ? <SkeletonList rows={2} lines={2} /> : !enabled ? (
        <div className="space-y-4">
          <EmptyState title="You are not logged in" body="Log in to see your addresses, family and orders." action={<LinkButton href="/login?next=/profile">{t("login")}</LinkButton>} />
          <DisplaySettings />
        </div>
      ) : (
        <div className="space-y-6">
          <Card className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-100 text-xl font-extrabold text-brand-800" aria-hidden>{me.data!.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0"><p className="t-section truncate">{me.data!.name}</p><p className="t-support">{me.data!.mobile}{me.data!.email ? ` · ${me.data!.email}` : ""}</p></div>
            </div>
            <Button variant="secondary" onClick={logout}><LogOut className="size-5" aria-hidden /> {t("logout")}</Button>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link href="/family" className={row}><Users className="size-6 text-brand-600" aria-hidden /><span className="flex-1">Family profiles</span><ChevronRight className="size-5 text-subtle" aria-hidden /></Link>
            <Link href="/repeat" className={row}><Repeat className="size-6 text-brand-600" aria-hidden /><span className="flex-1">Repeat &amp; saved medicines</span><ChevronRight className="size-5 text-subtle" aria-hidden /></Link>
          </div>

          <section aria-labelledby="addr"><SectionHeader id="addr" title="My addresses" action={<Button variant="soft" size="sm" className="min-h-11" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> Add</Button>} />
            <QueryBoundary query={addresses} skeleton={<SkeletonList rows={1} lines={3} />} isEmpty={(d) => d.length === 0} empty={<EmptyState title="No saved addresses yet" body="Add one with a landmark so delivery is easy to find." action={<Button onClick={() => setAdding(true)}>Add address</Button>} />}>
              {(list) => (
                <ul className="space-y-2">{list.map((a) => (
                  <Card as="li" key={a.id} className="flex items-start justify-between gap-2">
                    <p><b>{a.label}</b> · {a.contactName}<br /><span className="t-support">{a.houseDescription}, {a.area}, {a.village ? `${a.village}, ` : ""}{a.town}, {a.district} – {a.pincode}</span><br /><span className="t-caption">Landmark: {a.landmark}</span></p>
                    <IconButton label={`Delete address ${a.label}`} className="text-emergency" onClick={() => setRemoving(a)}><Trash2 className="size-5" aria-hidden /></IconButton>
                  </Card>
                ))}</ul>
              )}
            </QueryBoundary>
          </section>

          <DisplaySettings />

          <Card as="section" aria-labelledby="priv"><h2 id="priv" className="t-section mb-1">Privacy and consent</h2>
            <p className="t-support mb-2">Your prescriptions and health details are private. Only the pharmacy preparing your order can see them. Delivery partners never can.</p>
            <div className="divide-y divide-line">
              <Toggle label="Allow processing of my health information" hint="Needed to order prescription medicines" checked={me.data!.consent.healthData} onChange={(v) => consent.mutate({ healthData: v })} />
              <Toggle label="Offers and health tips" hint="Optional SMS and WhatsApp messages" checked={me.data!.consent.marketing} onChange={(v) => consent.mutate({ marketing: v })} />
            </div>
            {consent.isError && <ErrorState message={(consent.error as Error).message} />}
            <Button variant="secondary" className="mt-3" onClick={exportData}><Download className="size-5" aria-hidden /> Download my data</Button>
          </Card>

          <Card as="section" aria-labelledby="help"><h2 id="help" className="t-section mb-3">Help and support</h2>
            <div className="mb-4 flex flex-wrap gap-2">
              <a href={`tel:${SUPPORT_PHONE}`} className="tap inline-flex items-center gap-2 rounded-control bg-brand-600 px-5 font-semibold text-white hover:bg-brand-700"><Phone className="size-5" aria-hidden /> {t("callSupport")}</a>
              <a href={`https://wa.me/${SUPPORT_WA}`} className="tap inline-flex items-center gap-2 rounded-control border-2 border-brand-600 px-5 font-semibold text-brand-800 hover:bg-brand-50"><MessageCircle className="size-5" aria-hidden /> {t("whatsappSupport")}</a>
            </div>
            {sent ? <Success title="We got your message">Our team will get back to you soon.</Success> : (
              <form onSubmit={(e) => { e.preventDefault(); if (msg.trim().length >= 5) ticket.mutate(); }} className="space-y-2">
                <Textarea label="Tell us what you need help with" value={msg} onChange={(e) => setMsg(e.target.value)} />
                {ticket.isError && <Notice tone="red">{(ticket.error as Error).message}</Notice>}
                <Button type="submit" variant="secondary" loading={ticket.isPending} disabled={msg.trim().length < 5}>Send message</Button>
              </form>)}
            {tickets.data && tickets.data.length > 0 && <p className="t-caption mt-3">{tickets.data.length} earlier message(s). Latest: {tickets.data[0].status.toLowerCase().replace("_", " ")}.</p>}
            <p className="t-caption mt-3">Cancellation is free before pickup. Refunds reach you in 3–5 working days.</p>
          </Card>
        </div>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add an address"><AddressForm onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} /></Modal>
      <ConfirmationDialog open={!!removing} onClose={() => setRemoving(undefined)} tone="danger" title="Delete this address?" description={removing ? `${removing.label}, ${removing.area}. Past orders keep their address.` : undefined}
        confirmLabel="Yes, delete" cancelLabel="Keep" loading={remove.isPending} error={remove.isError ? (remove.error as Error).message : undefined} onConfirm={() => removing && remove.mutate(removing.id)} />
    </>
  );
}

/** Large text, high contrast, language. Works without logging in. */
function DisplaySettings() {
  const t = useT();
  const me = useMe();
  const qc = useQueryClient();
  const prefs = usePrefs();
  const consent = useMutation({ mutationFn: (b: Record<string, unknown>) => patch("/api/me", b), onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }) });
  return (
    <Card as="section" aria-labelledby="acc"><h2 id="acc" className="t-section mb-1">Display and language</h2>
      <div className="divide-y divide-line">
        <Toggle label={t("largeText")} hint="Makes all text and buttons bigger" checked={prefs.large} onChange={prefs.setLarge} />
        <Toggle label="High contrast" hint="Stronger text and borders" checked={prefs.highContrast} onChange={prefs.setHighContrast} />
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2"><span className="t-body font-semibold">{t("language")}</span>
          <div role="radiogroup" aria-label={t("language")} className="flex gap-2">
            {([["en", "English"], ["hi", "हिन्दी"]] as const).map(([l, label]) => (
              <button key={l} role="radio" aria-checked={prefs.lang === l} onClick={() => { prefs.setLang(l); if (me.data) consent.mutate({ language: l }); }}
                className={clsx("tap rounded-control border-2 px-4 font-semibold", prefs.lang === l ? "border-brand-600 bg-brand-50" : "border-line-strong")}>{label}</button>
            ))}
          </div></div>
      </div>
    </Card>
  );
}
