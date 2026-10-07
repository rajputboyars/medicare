"use client";
import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { post } from "@/lib/api";
import { pharmacyRegistrationSchema } from "@/lib/validation";
import { Button, Card, Input, Notice, Success } from "@/components/ui";

type Form = z.input<typeof pharmacyRegistrationSchema> & { pincodes?: string };

export default function PharmacyRegister() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Form>({ resolver: zodResolver(pharmacyRegistrationSchema.extend({ servicePincodes: pharmacyRegistrationSchema.shape.servicePincodes.optional() })) as never, defaultValues: { district: "Sitapur", openTime: "09:00", closeTime: "21:00" } });

  async function onSubmit(v: Form) {
    setError(undefined);
    try {
      const servicePincodes = (v.pincodes ?? v.pincode).split(/[ ,]+/).filter(Boolean);
      await post("/api/partners/pharmacy", { ...v, servicePincodes, pincodes: undefined });
      setDone(true);
    } catch (e) { setError((e as Error).message); }
  }

  if (done) return (<><Success title="Application received">Our team will verify your drug licence. You can log in meanwhile to set up your inventory. You will start receiving orders after verification.</Success><Link href="/login" className="mt-4 inline-block font-bold text-brand-700 underline">Go to login</Link></>);
  return (
    <>
      <h1 className="mb-1 text-3xl font-extrabold">Become a partner pharmacy</h1>
      <p className="mb-5 text-muted">Reach customers in your town. Verification is required before you can take orders.</p>
      <Card>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {error && <Notice tone="red">{error}</Notice>}
          <Input label="Pharmacy name" required error={errors.name?.message} {...register("name")} />
          <Input label="Owner / pharmacist name" required error={errors.ownerName?.message} {...register("ownerName")} />
          <Input label="Mobile" inputMode="tel" maxLength={10} required error={errors.mobile?.message} {...register("mobile")} />
          <Input label="Email" type="email" required error={errors.email?.message} {...register("email")} />
          <Input label="Password" type="password" autoComplete="new-password" required error={errors.password?.message} {...register("password")} />
          <Input label="Drug licence number" required error={errors.drugLicense?.message} {...register("drugLicense")} />
          <Input label="GSTIN (optional)" error={errors.gstin?.message} {...register("gstin")} />
          <Input label="Shop address" required error={errors.address?.message} {...register("address")} />
          <div className="grid gap-4 sm:grid-cols-2"><Input label="Pincode" inputMode="numeric" maxLength={6} required error={errors.pincode?.message} {...register("pincode")} /><Input label="District" required error={errors.district?.message} {...register("district")} /></div>
          <Input label="Pincodes you deliver to" hint="Separate with commas. Defaults to your own pincode." {...register("pincodes")} />
          <div className="grid gap-4 sm:grid-cols-2"><Input label="Opens" type="time" {...register("openTime")} /><Input label="Closes" type="time" {...register("closeTime")} /></div>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-6 shrink-0 accent-brand-600" {...register("consent")} /><span>I declare that the licence details are correct, a registered pharmacist supervises dispensing, and I will follow all applicable pharmacy laws.</span></label>
          {errors.consent && <p role="alert" className="text-sm font-medium text-emergency">{errors.consent.message}</p>}
          <Button type="submit" className="w-full" loading={isSubmitting}>Submit for verification</Button>
        </form>
      </Card>
    </>
  );
}
