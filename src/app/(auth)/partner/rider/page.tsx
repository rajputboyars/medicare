"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { post } from "@/lib/api";
import { riderRegistrationSchema } from "@/lib/validation";
import { Button, Card, Input, Notice, Success } from "@/components/ui";

type Form = z.input<typeof riderRegistrationSchema>;

export default function RiderRegister() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(riderRegistrationSchema) });

  async function onSubmit(v: Form) {
    setError(undefined);
    try { await post("/api/partners/rider", v); setDone(true); } catch (e) { setError((e as Error).message); }
  }

  if (done) return (<><Success title="Application received">Our team will verify your details. You can go online and accept deliveries once you are approved.</Success><Link href="/login" className="mt-4 inline-block font-bold text-brand-700 underline">Go to login</Link></>);
  return (
    <>
      <h1 className="mb-1 text-3xl font-extrabold">Become a delivery partner</h1>
      <p className="mb-5 text-muted">Deliver medicines in your town and earn per delivery.</p>
      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && <Notice tone="red">{error}</Notice>}
          <Input label="Your name" required error={errors.name?.message} {...register("name")} />
          <Input label="Mobile" inputMode="tel" maxLength={10} required error={errors.mobile?.message} {...register("mobile")} />
          <Input label="Email" type="email" required error={errors.email?.message} {...register("email")} />
          <Input label="Password" type="password" autoComplete="new-password" required error={errors.password?.message} {...register("password")} />
          <Input label="Vehicle" required hint="Example: Motorcycle UP34 AB 1234" error={errors.vehicle?.message} {...register("vehicle")} />
          <Button type="submit" className="w-full" loading={isSubmitting}>Apply</Button>
        </form>
      </Card>
    </>
  );
}
