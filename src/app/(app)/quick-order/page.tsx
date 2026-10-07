"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { upload } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { SUPPORT_PHONE } from "@/lib/hooks";
import { quickOrderSchema } from "@/lib/validation";
import { PrescriptionPicker } from "@/components/prescription-picker";
import { Button, Card, Input, Notice, PageTitle, Success, Textarea } from "@/components/ui";
import { Phone } from "lucide-react";

export default function QuickOrder() {
  const pincode = useLocation((s) => s.pincode);
  const [mobile, setMobile] = useState("");
  const [addressText, setAddress] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const send = useMutation({
    mutationFn: () => {
      const f = new FormData();
      f.set("file", file!); f.set("mobile", mobile); f.set("pincode", pincode); f.set("addressText", addressText);
      return upload("/api/quick-order", f);
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = quickOrderSchema.safeParse({ mobile, pincode, addressText });
    const errs: Record<string, string> = r.success ? {} : Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message]));
    if (!file) errs.file = "Please add a photo of your prescription";
    setErrors(errs);
    if (Object.keys(errs).length === 0) send.mutate();
  }

  return (
    <>
      <PageTitle title="Upload Prescription & Call Me" subtitle="Only 3 things needed. Our team calls you and completes the order." />
      {send.isSuccess ? (
        <div className="space-y-4">
          <Success title="Thank you! We will call you soon">Please keep your phone nearby. A local pharmacy will confirm the medicines and price with you before anything is delivered.</Success>
          <a href={`tel:${SUPPORT_PHONE}`} className="inline-flex min-h-12 items-center gap-2 rounded-2xl border-2 border-brand-600 px-5 font-semibold text-brand-800"><Phone className="size-5" aria-hidden /> Call support now</a>
        </div>
      ) : (
        <Card>
          <form onSubmit={submit} className="space-y-5" noValidate>
            {send.isError && <Notice tone="red">{(send.error as Error).message}</Notice>}
            <Input label="1. Your mobile number" required inputMode="tel" maxLength={10} autoComplete="tel-national" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} error={errors.mobile} />
            <Textarea label="2. Where should we deliver?" required hint={`Area, landmark and house details (pincode ${pincode}). Example: Near Hanuman Mandir, opposite Government School`} value={addressText} onChange={(e) => setAddress(e.target.value)} error={errors.addressText} />
            <div><PrescriptionPicker file={file} onChange={setFile} error={errors.file} /></div>
            <Button type="submit" className="w-full" loading={send.isPending}>Send &amp; Call Me</Button>
            <p className="text-center text-sm text-muted">By sending, you allow the pharmacy team to view your prescription and call you.</p>
          </form>
        </Card>
      )}
    </>
  );
}
