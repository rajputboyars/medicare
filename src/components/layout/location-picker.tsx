"use client";
import { useState } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { api, post } from "@/lib/api";
import { useLocation } from "@/lib/store";
import { useT } from "@/lib/hooks";
import { pincodeSchema, mobileSchema } from "@/lib/validation";
import { Button, Input, Notice, Success } from "@/components/ui";

/** "Delivering to: Sitapur 261001" – checks service-area coverage; if not live, offers launch notification. */
export function LocationPicker({ variant = "header" }: { variant?: "header" | "block" }) {
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
      if (r.available) {
        setLocation(pin, "Your area");
        setOpen(false);
        setUncovered(undefined);
        setValue("");
      } else setUncovered(pin);
    },
    onError: (e) => setErr((e as Error).message),
  });

  const signup = useMutation({
    mutationFn: () => post("/api/launch-signup", { mobile, pincode: uncovered }),
    onError: (e) => setErr((e as Error).message),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    setUncovered(undefined);
    signup.reset();
    const p = pincodeSchema.safeParse(value);
    if (!p.success) return setErr(p.error.issues[0].message);
    check.mutate(p.data);
  }

  function submitSignup(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    const m = mobileSchema.safeParse(mobile);
    if (!m.success) return setErr(m.error.issues[0].message);
    signup.mutate();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={variant === "header"
          ? "flex min-h-12 max-w-[40vw] items-center gap-2 rounded-2xl px-2 py-1 text-left hover:bg-brand-50 min-[420px]:max-w-[50vw] sm:max-w-none"
          : "flex min-h-12 items-center gap-2 rounded-2xl border-2 border-line bg-white px-4 py-2 text-left"}
      >
        <MapPin className="size-5 shrink-0 text-brand-600" aria-hidden />
        <span className="min-w-0">
          <span className="block text-xs text-muted">{t("deliveringTo")}</span>
          <span className="block truncate text-sm font-bold">{areaLabel && <span className="hidden min-[420px]:inline">{areaLabel} · </span>}{pincode}</span>
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[min(92vw,22rem)] rounded-2xl border border-line bg-white p-4 shadow-xl">
          <form onSubmit={submit} className="space-y-3" noValidate>
            <Input label="Your pincode" inputMode="numeric" maxLength={6} autoComplete="postal-code" placeholder="e.g. 261001" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} error={!uncovered ? err : undefined} />
            <Button type="submit" className="w-full" loading={check.isPending}>Check my area</Button>
          </form>
          {uncovered && (
            <div className="mt-4 space-y-3">
              <Notice tone="amber" title={t("comingToYourArea")}>We don&apos;t deliver to {uncovered} yet. Leave your mobile number and we&apos;ll message you when we launch.</Notice>
              {signup.isSuccess ? (
                <Success title="Thank you!">We&apos;ll SMS you on launch.</Success>
              ) : (
                <form onSubmit={submitSignup} className="space-y-3" noValidate>
                  <Input label="Mobile number" inputMode="tel" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} error={err} />
                  <Button type="submit" variant="secondary" className="w-full" loading={signup.isPending}>Notify me</Button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
