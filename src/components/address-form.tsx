"use client";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LocateFixed } from "lucide-react";
import type { z } from "zod";
import { post } from "@/lib/api";
import { addressSchema } from "@/lib/validation";
import { useLocation } from "@/lib/store";
import { Button, Input, Notice } from "@/components/ui";
import type { Address } from "@/lib/types";

type Form = z.input<typeof addressSchema>;

/** Small-town friendly: landmark is a required, first-class field; village & map pin are optional. */
export function AddressForm({ defaults, onSaved, onCancel }: { defaults?: Partial<Form>; onSaved?: (a: Address) => void; onCancel?: () => void }) {
  const qc = useQueryClient();
  const pincode = useLocation((s) => s.pincode);
  const [geoMsg, setGeoMsg] = useState<string>();
  const { register, handleSubmit, setValue, control, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(addressSchema),
    defaultValues: { label: "Home", state: "Uttar Pradesh", district: "Sitapur", pincode, ...defaults },
  });
  const loc = useWatch({ control, name: "location" });

  const save = useMutation({
    mutationFn: (v: Form) => post<Address>("/api/addresses", v),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ["addresses"] }); onSaved?.(a); },
  });

  function locate() {
    setGeoMsg(undefined);
    if (!navigator.geolocation) return setGeoMsg("Your phone does not support location.");
    navigator.geolocation.getCurrentPosition(
      (p) => { setValue("location", { lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) }); setGeoMsg("Map pin saved."); },
      () => setGeoMsg("Could not get location. You can skip this."),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
      {save.isError && <Notice tone="red">{(save.error as Error).message}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name for this address" required error={errors.label?.message} {...register("label")} hint="Home, Shop, Village house…" />
        <Input label="Receiver's name" required error={errors.contactName?.message} {...register("contactName")} />
        <Input label="Receiver's mobile" required inputMode="tel" maxLength={10} error={errors.contactMobile?.message} {...register("contactMobile")} />
        <Input label="Pincode" required inputMode="numeric" maxLength={6} error={errors.pincode?.message} {...register("pincode")} />
        <Input label="State" required error={errors.state?.message} {...register("state")} />
        <Input label="District" required error={errors.district?.message} {...register("district")} />
        <Input label="Town" required error={errors.town?.message} {...register("town")} />
        <Input label="Village (if any)" error={errors.village?.message} {...register("village")} />
      </div>
      <Input label="Area / Mohalla" required error={errors.area?.message} {...register("area")} />
      <Input label="Landmark" required hint="Example: Near Hanuman Mandir, opposite Government School" error={errors.landmark?.message} {...register("landmark")} />
      <Input label="House description" required hint="Example: Blue gate, 2nd house after the tea stall" error={errors.houseDescription?.message} {...register("houseDescription")} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="soft" onClick={locate}><LocateFixed className="size-5" aria-hidden /> {loc ? "Update map pin" : "Add map pin (optional)"}</Button>
        {(geoMsg || loc) && <span className="text-sm text-muted" role="status">{geoMsg ?? "Map pin saved."}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={save.isPending}>Save address</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
