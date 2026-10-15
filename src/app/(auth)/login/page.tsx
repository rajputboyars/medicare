"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PhoneCall } from "lucide-react";
import { useT } from "@/lib/hooks";
import { OtpFlow } from "@/components/onboarding/otp-flow";

const DEMO = [
  ["Customer", "9876543210"], ["Pharmacy owner", "9811100001"], ["Rider", "9822200001"],
];

function LoginInner() {
  const t = useT();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  return (
    <>
      <h1 className="mb-1 text-3xl font-extrabold">{t("authTitle")}</h1>
      <p className="mb-5 text-muted">{t("authSubtitle")}</p>
      <OtpFlow kind="customer" onDone={(redirect) => { router.replace(safeNext ?? redirect); router.refresh(); }} />

      <p className="mt-5 text-center text-sm text-muted">{t("guestNote")}</p>
      <p className="mt-3 text-center"><Link href="/help/callback" className="tap inline-flex items-center gap-2 font-bold text-brand-700 underline"><PhoneCall className="size-4" aria-hidden /> {t("callbackTitle")}</Link></p>
      <p className="mt-2 text-center text-sm text-muted">{t("loginPartnerHint")}<br />
        <Link href="/partner/pharmacy" className="text-brand-700 underline">Register your pharmacy</Link> · <Link href="/partner/rider" className="text-brand-700 underline">Become a delivery partner</Link> · <Link href="/login/staff" className="text-brand-700 underline">{t("staffLogin")}</Link>
      </p>

      {process.env.NODE_ENV !== "production" && (
        <details className="mt-6 rounded-card border border-dashed border-line p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Demo accounts (development only)</summary>
          <p className="mt-2 text-muted">Enter one of these mobile numbers. The code is shown on screen because the mock SMS provider is on. Staff and admin use the staff login (password <code>Demo@1234</code>).</p>
          <ul className="mt-2 space-y-1">{DEMO.map(([l, m]) => <li key={m}><b>{l}:</b> <code>{m}</code></li>)}</ul>
        </details>
      )}
    </>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
