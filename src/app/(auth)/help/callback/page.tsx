"use client";
import { useState } from "react";
import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { post } from "@/lib/api";
import { useT } from "@/lib/hooks";
import { Button, Card, Input, Notice, Success, Textarea } from "@/components/ui";

/** For people who find the app hard: leave a number, our team calls back. No account, no medical details. */
export default function CallbackPage() {
  const t = useT();
  const [f, setF] = useState({ mobile: "", name: "", area: "", reason: "" });
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string>();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("busy"); setError(undefined);
    try { await post("/api/support/callback", { mobile: f.mobile, name: f.name || undefined, area: f.area, reason: f.reason }); setState("done"); }
    catch (err) { setError((err as Error).message); setState("idle"); }
  }

  return (
    <>
      <h1 className="mb-1 flex items-center gap-2 text-3xl font-extrabold"><PhoneCall className="size-7 text-brand-600" aria-hidden /> {t("callbackTitle")}</h1>
      <p className="mb-5 text-muted">{t("callbackIntro")}</p>
      {state === "done" ? <Success title={t("callbackThanks")} /> : (
        <Card>
          <form onSubmit={send} className="space-y-4" noValidate>
            {error && <Notice tone="red">{error}</Notice>}
            <Input label={t("mobileLabel")} inputMode="tel" maxLength={10} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, "") })} />
            <Input label={t("callbackName")} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Input label={t("callbackArea")} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />
            <Textarea label={t("callbackReason")} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            <Button type="submit" size="lg" className="w-full" loading={state === "busy"} disabled={!/^[6-9]\d{9}$/.test(f.mobile) || f.area.trim().length < 2 || f.reason.trim().length < 3}>{t("callbackSend")}</Button>
          </form>
        </Card>
      )}
      <p className="mt-4 text-center"><Link href="/login" className="text-brand-700 underline">← {t("login")}</Link></p>
    </>
  );
}
