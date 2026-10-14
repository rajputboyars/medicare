"use client";
import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { ChevronDown, MapPin } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { api, post } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { useT } from "@/lib/hooks";
import { mobileSchema, pincodeSchema } from "@/lib/validation";
import { Button, Input, Modal, Notice, Success } from "@/components/ui";

/**
 * "Delivering to: Sitapur · 261001". Opens a sheet where the customer types a pincode.
 * We check the service area; if we are not there yet the sheet says so and offers a launch SMS.
 * `bar` is the large version at the top of Home; `compact` fits the header on other screens.
 */
export function LocationSelector({ variant = "compact" }: { variant?: "bar" | "compact" }) {
  const t = useT();
  const { pincode, areaLabel, setLocation } = useLocation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [mobile, setMobile] = useState("");
  const [err, setErr] = useState<string>();
  const [uncovered, setUncovered] = useState<string>();

  const check = useMutation({
    mutationFn: (pin: string) => api<{ available: boolean; message?: string }>(`/api/coverage?pincode=${pin}`),
    onSuccess: (r, pin) => {
      if (r.available) { setLocation(pin, "Your area"); setOpen(false); setUncovered(undefined); setValue(""); }
      else setUncovered(pin);
    },
    onError: (e) => setErr((e as Error).message),
  });
  const signup = useMutation({ mutationFn: () => post("/api/launch-signup", { mobile, pincode: uncovered }), onError: (e) => setErr((e as Error).message) });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(undefined); setUncovered(undefined); signup.reset();
    const p = pincodeSchema.safeParse(value);
    if (!p.success) return setErr(p.error.issues[0].message);
    check.mutate(p.data);
  }
  function submitSignup(e: FormEvent) {
    e.preventDefault();
    setErr(undefined);
    const m = mobileSchema.safeParse(mobile);
    if (!m.success) return setErr(m.error.issues[0].message);
    signup.mutate();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Delivering to ${areaLabel ? areaLabel + " " : ""}${pincode}. Change area`}
        className={clsx("flex items-center gap-3 text-left", variant === "bar"
          ? "tap w-full rounded-card border border-line bg-surface px-4 py-3 shadow-soft hover:bg-brand-50"
          : "tap max-w-[44vw] rounded-control px-2 py-1 hover:bg-brand-50 phone:max-w-[50vw] sm:max-w-none")}
      >
        <span className={clsx("grid shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700", variant === "bar" ? "size-10" : "size-8")}><MapPin className="size-5" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="t-caption block">{t("deliveringTo")}</span>
          <span className={clsx("block truncate font-bold", variant === "bar" ? "text-lg" : "text-sm")}>
            {areaLabel && <span className={variant === "bar" ? "" : "hidden phablet:inline"}>{areaLabel} · </span>}{pincode}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand-700">{variant === "bar" && t("changeArea")}<ChevronDown className="size-4" aria-hidden /></span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Where should we deliver?" description="Enter your 6-digit pincode. We will check if we deliver there.">
        <form onSubmit={submit} className="space-y-3" noValidate>
          <Input label="Pincode" inputMode="numeric" maxLength={6} autoComplete="postal-code" placeholder="e.g. 261001" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} error={!uncovered ? err : undefined} />
          <Button type="submit" size="lg" className="w-full" loading={check.isPending}>Check my area</Button>
        </form>
        {uncovered && (
          <div className="mt-4 space-y-3">
            <Notice tone="amber" title={t("comingToYourArea")}>We do not deliver to {uncovered} yet. Leave your mobile number and we will message you when we launch.</Notice>
            {signup.isSuccess ? <Success title="Thank you!">We will message you when we launch.</Success> : (
              <form onSubmit={submitSignup} className="space-y-3" noValidate>
                <Input label="Mobile number" inputMode="tel" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} error={err} />
                <Button type="submit" variant="secondary" className="w-full" loading={signup.isPending}>Tell me when you launch</Button>
              </form>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
