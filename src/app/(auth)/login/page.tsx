"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { post } from "@/lib/api";
import { loginSchema } from "@/lib/validation";
import { Button, Card, Input, Notice } from "@/components/ui";

type Form = z.infer<typeof loginSchema>;

const DEMO = [
  ["Customer", "9876543210"], ["Pharmacy owner", "pharmacy@example.com"], ["Pharmacist", "pharmacist@example.com"],
  ["Rider", "rider@example.com"], ["Rider (2nd)", "rider4@example.com"], ["Platform admin", "admin@example.com"],
];

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const qc = useQueryClient();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<Form>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(v: Form) {
    setError(undefined);
    setBusy(true);
    try {
      const r = await post<{ redirect: string }>("/api/auth/login", v);
      await qc.invalidateQueries();
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : r.redirect);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-3xl font-extrabold">Welcome back</h1>
      <p className="mb-5 text-muted">Log in with your mobile number or email.</p>
      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && <Notice tone="red">{error}</Notice>}
          <Input label="Mobile number or email" autoComplete="username" inputMode="email" error={errors.identifier?.message} {...register("identifier")} />
          <Input label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register("password")} />
          <Button type="submit" className="w-full" loading={busy}>Log in</Button>
        </form>
      </Card>
      <p className="mt-4 text-center">New here? <Link href="/register" className="font-bold text-brand-700 underline">Create an account</Link></p>
      <p className="mt-2 text-center text-sm"><Link href="/quick-order" className="text-brand-700 underline">Order without an account: upload prescription &amp; call me</Link></p>
      <p className="mt-2 text-center text-sm text-muted">Partners: <Link href="/partner/pharmacy" className="text-brand-700 underline">register your pharmacy</Link> · <Link href="/partner/rider" className="text-brand-700 underline">become a delivery partner</Link></p>

      {process.env.NODE_ENV !== "production" && (
        <details className="mt-6 rounded-2xl border border-dashed border-line p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Demo accounts (development only)</summary>
          <p className="mt-2 text-muted">Password for all: <code>Demo@1234</code></p>
          <div className="mt-2 flex flex-wrap gap-2">
            {DEMO.map(([label, id]) => (
              <button key={id} type="button" className="min-h-10 rounded-xl border border-line bg-white px-3" onClick={() => { setValue("identifier", id); setValue("password", "Demo@1234"); }}>{label}</button>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
