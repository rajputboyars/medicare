"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { post } from "@/lib/api";
import { registerSchema } from "@/lib/validation";
import { Button, Card, Input, Notice } from "@/components/ui";

type Form = z.input<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Form>({ resolver: zodResolver(registerSchema) });

  async function onSubmit(v: Form) {
    setError(undefined);
    setBusy(true);
    try {
      await post("/api/auth/register", v);
      await qc.invalidateQueries();
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mb-1 text-3xl font-extrabold">Create your account</h1>
      <p className="mb-5 text-muted">Takes less than a minute.</p>
      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && <Notice tone="red">{error}</Notice>}
          <Input label="Your name" autoComplete="name" required error={errors.name?.message} {...register("name")} />
          <Input label="Mobile number" inputMode="tel" maxLength={10} autoComplete="tel-national" required hint="10 digits. We send order updates here." error={errors.mobile?.message} {...register("mobile")} />
          <Input label="Email (optional)" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
          <Input label="Password" type="password" autoComplete="new-password" required hint="At least 8 characters with a letter and a number." error={errors.password?.message} {...register("password")} />
          <div>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 size-6 shrink-0 accent-brand-600" {...register("consentHealthData")} />
              <span>I agree that DawaDost may process my health information (prescriptions, orders) to fulfil my requests, and share only what is needed with the pharmacy. I can withdraw this anytime in Profile → Privacy.</span>
            </label>
            {errors.consentHealthData && <p role="alert" className="mt-1 text-sm font-medium text-emergency">{errors.consentHealthData.message}</p>}
          </div>
          <Button type="submit" className="w-full" loading={busy}>Create account</Button>
        </form>
      </Card>
      <p className="mt-4 text-center">Already registered? <Link href="/login" className="font-bold text-brand-700 underline">Log in</Link></p>
    </>
  );
}
