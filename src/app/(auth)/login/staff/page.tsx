"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { post } from "@/lib/api";
import { useT } from "@/lib/hooks";
import { Button, Card, Input, Notice } from "@/components/ui";

interface LoginResult { redirect?: string; mfaRequired?: boolean; mfaToken?: string; mobileHint?: string; devOtp?: string }

/** Staff, pharmacists and admins: password first; admins then enter a code sent to their mobile. Desktop-friendly, no clutter. */
function StaffLogin() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const next = useSearchParams().get("next");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState<{ token: string; hint?: string; dev?: string }>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function done(redirect?: string) {
    await qc.invalidateQueries();
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : redirect ?? "/");
    router.refresh();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try {
      if (!mfa) {
        const r = await post<LoginResult>("/api/auth/login", { identifier, password });
        if (r.mfaRequired) setMfa({ token: r.mfaToken!, hint: r.mobileHint, dev: r.devOtp });
        else await done(r.redirect);
      } else {
        const r = await post<LoginResult>("/api/auth/mfa/verify", { mfaToken: mfa.token, code });
        await done(r.redirect);
      }
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <h1 className="mb-1 text-3xl font-extrabold">{t("staffLogin")}</h1>
      <p className="mb-5 text-muted">For pharmacists, pharmacy staff and the DawaDost team.</p>
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Notice tone="red">{error}</Notice>}
          {!mfa ? (
            <>
              <Input label="Mobile number or email" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
              <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!identifier || !password}>Log in</Button>
            </>
          ) : (
            <>
              <p className="flex items-center gap-2 font-bold"><ShieldCheck className="size-5 text-brand-600" aria-hidden /> One more step</p>
              <p className="t-support">We sent a 6-digit code to {mfa.hint}. Enter it to finish.</p>
              {mfa.dev && <Notice tone="amber">{t("devCodeNotice", { code: mfa.dev })}</Notice>}
              <Input label={t("codeLabel")} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center text-2xl font-extrabold tracking-[0.5em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
              <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>{t("verifyCode")}</Button>
              <Button type="button" variant="ghost" onClick={() => { setMfa(undefined); setCode(""); setError(undefined); }}>Start again</Button>
            </>
          )}
        </form>
      </Card>
      <p className="mt-4 text-center text-sm"><Link href="/login" className="text-brand-700 underline">Customer or partner? Sign in with your mobile number</Link></p>
      {process.env.NODE_ENV !== "production" && <p className="mt-4 text-center text-xs text-muted">Development: pharmacy@example.com · pharmacist@example.com · admin@example.com, password Demo@1234.</p>}
    </>
  );
}

export default function StaffLoginPage() {
  return <Suspense><StaffLogin /></Suspense>;
}
