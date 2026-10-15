"use client";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LocateFixed, MapPin } from "lucide-react";
import { api, post } from "@/lib/api";
import { trackEvent } from "@/lib/analytics-client";
import { useT } from "@/lib/hooks";
import { usePrefs, useLocation } from "@/lib/store";
import { LANGUAGES, isLang, type Lang } from "@/i18n";
import { Button, Card, Input, Notice, Success } from "@/components/ui";
import { StepProgress } from "./step-progress";

/**
 * The mobile-first sign-in used by customers AND partner applicants:
 *   mobile → 6-digit code → (new person) name → (customers) location → done.
 * Returning people stop after the code. Text comes from the translation keys; the code box is a single large field that
 * accepts the SMS auto-fill. In development the mock provider's code is shown on screen (the server never sends it in production).
 */
export type FlowKind = "customer" | "PHARMACY" | "RIDER";
interface Resolved { pincode: string; district?: string; town?: string; coverage: { available: boolean; message?: string } }

type Phase = "mobile" | "code" | "profile" | "location";

export function OtpFlow({ kind, onDone }: { kind: FlowKind; onDone: (redirect: string, isNew: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const setLangStore = usePrefs((s) => s.setLang);
  const setLocation = useLocation((s) => s.setLocation);
  const [phase, setPhase] = useState<Phase>("mobile");
  const [mobile, setMobile] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [devOtp, setDevOtp] = useState<string>();
  const [signupToken, setSignupToken] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<Lang>("en");
  const [pincode, setPincode] = useState("");
  const [resolved, setResolved] = useState<Resolved>();
  const [terms, setTerms] = useState(false);
  const [interestSaved, setInterestSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (kind === "customer") trackEvent("signup_started");
    else trackEvent(kind === "PHARMACY" ? "pharmacy_registration_started" : "rider_registration_started");
  }, [kind]);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const customer = kind === "customer";
  const steps = customer
    ? [{ key: "mobile", label: t("mobileLabel") }, { key: "code", label: t("codeLabel") }, { key: "profile", label: t("yourName") }, { key: "location", label: t("yourLocation") }]
    : [{ key: "mobile", label: t("mobileLabel") }, { key: "code", label: t("codeLabel") }, { key: "profile", label: t("yourName") }];
  const stepIndex = Math.max(0, steps.findIndex((s) => s.key === phase));

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(undefined);
    try { return await fn(); } catch (e) { setError((e as Error).message); return undefined; } finally { setBusy(false); }
  }

  async function sendCode() {
    if (!/^[6-9]\d{9}$/.test(mobile)) return setError(t("errMobile"));
    const r = await run(() => post<{ challengeId: string; resendAfterSec: number; devOtp?: string }>("/api/auth/otp/request", { mobile }));
    if (!r) return;
    setChallengeId(r.challengeId); setDevOtp(r.devOtp); setWait(r.resendAfterSec); setCode(""); setPhase("code");
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) return setError(t("errCode"));
    const r = await run(() => post<{ isNewUser: boolean; signupToken?: string; redirect?: string }>("/api/auth/otp/verify", { challengeId, code }));
    if (!r) return;
    if (!r.isNewUser) { await qc.invalidateQueries(); return onDone(r.redirect ?? "/", false); }
    setSignupToken(r.signupToken!); setPhase("profile");
  }

  async function profileNext() {
    if (name.trim().length < 2) return setError(t("yourNameHint"));
    if (!customer) {
      const r = await run(() => post<{ redirect: string }>("/api/partner/start", { signupToken, name: name.trim(), type: kind }));
      if (r) { await qc.invalidateQueries(); onDone(kind === "PHARMACY" ? "/partner/pharmacy" : "/partner/rider", true); }
      return;
    }
    setError(undefined); setPhase("location");
  }

  async function check(by: { pincode?: string; lat?: number; lng?: number }) {
    const qs = new URLSearchParams(Object.entries(by).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    const r = await run(() => api<Resolved>(`/api/location/resolve?${qs}`));
    if (!r) return;
    setPincode(r.pincode); setResolved(r);
    trackEvent("location_selected", { covered: r.coverage.available });
  }

  function useGps() {
    if (!navigator.geolocation) return setError(t("errPincode"));
    setBusy(true); setError(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(false); void check({ lat: +p.coords.latitude.toFixed(4), lng: +p.coords.longitude.toFixed(4) }); },
      () => { setBusy(false); setError(t("errPincode")); },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }

  async function finish() {
    if (!terms) return setError(t("termsAccept"));
    const r = await run(() => post<{ status: "CREATED" | "UNAVAILABLE"; redirect?: string }>("/api/auth/register", { signupToken, name: name.trim(), language, pincode, acceptTerms: true }));
    if (!r) return;
    if (r.status === "UNAVAILABLE") return setInterestSaved(true); // the server already saved the interest
    setLangStore(language);
    setLocation(pincode, resolved?.district ?? "");
    await qc.invalidateQueries();
    onDone(r.redirect ?? "/", true);
  }

  async function interest() {
    const r = await run(() => post("/api/service-areas/interest", { mobile, pincode }));
    if (r !== undefined) setInterestSaved(true);
  }

  return (
    <div className="space-y-4">
      <StepProgress steps={steps} current={stepIndex} compact label={t("stepOf", { n: stepIndex + 1, total: steps.length })} />
      <Card className="space-y-4">
        {error && <Notice tone="red">{error}</Notice>}

        {phase === "mobile" && (
          <form onSubmit={(e) => { e.preventDefault(); void sendCode(); }} className="space-y-4" noValidate>
            <Input label={t("mobileLabel")} hint={t("mobileHint")} inputMode="tel" autoComplete="tel-national" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))} />
            <Button type="submit" size="lg" className="w-full" loading={busy}>{t("sendCode")}</Button>
          </form>
        )}

        {phase === "code" && (
          <form onSubmit={(e) => { e.preventDefault(); void verify(); }} className="space-y-4" noValidate>
            <p className="t-body">{t("codeSentTo", { mobile: `${mobile.slice(0, 2)}••••••${mobile.slice(-2)}` })}</p>
            {devOtp && <Notice tone="amber">{t("devCodeNotice", { code: devOtp })}</Notice>}
            <Input label={t("codeLabel")} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="text-center text-2xl font-extrabold tracking-[0.5em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.length !== 6}>{t("verifyCode")}</Button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => { setPhase("mobile"); setError(undefined); }}>{t("changeNumber")}</Button>
              <Button type="button" variant="ghost" disabled={wait > 0 || busy} onClick={() => void sendCode()}>{wait > 0 ? t("resendIn", { s: wait }) : t("resendCode")}</Button>
            </div>
          </form>
        )}

        {phase === "profile" && (
          <form onSubmit={(e) => { e.preventDefault(); void profileNext(); }} className="space-y-4" noValidate>
            <Input label={t("yourName")} hint={t("yourNameHint")} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            {customer && (
              <fieldset>
                <legend className="t-label mb-2">{t("preferredLanguage")}</legend>
                <div role="radiogroup" className="flex flex-wrap gap-2">
                  {LANGUAGES.map((l) => (
                    <button key={l.code} type="button" role="radio" aria-checked={language === l.code} onClick={() => { if (isLang(l.code)) { setLanguage(l.code); setLangStore(l.code); } }}
                      className={`tap rounded-control border-2 px-5 font-bold ${language === l.code ? "border-brand-600 bg-brand-50" : "border-line-strong"}`}>{l.native}</button>
                  ))}
                </div>
              </fieldset>
            )}
            <Button type="submit" size="lg" className="w-full" loading={busy}>{customer ? t("nextStep") : t("startApplication")}</Button>
          </form>
        )}

        {phase === "location" && (
          <div className="space-y-4">
            <div><h2 className="t-section">{t("yourLocation")}</h2><p className="t-support">{t("yourLocationHint")}</p></div>
            <Button type="button" variant="soft" size="lg" className="w-full" onClick={useGps} loading={busy && !resolved}><LocateFixed className="size-5" aria-hidden /> {t("useMyLocation")}</Button>
            <form onSubmit={(e) => { e.preventDefault(); if (/^[1-9]\d{5}$/.test(pincode)) void check({ pincode }); else setError(t("errPincode")); }} className="flex items-end gap-2" noValidate>
              <div className="flex-1"><Input label={t("orEnterPincode")} inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => { setPincode(e.target.value.replace(/\D/g, "")); setResolved(undefined); }} /></div>
              <Button type="submit" variant="secondary" loading={busy}>{t("checkArea")}</Button>
            </form>
            {resolved?.coverage.available && (
              <>
                <Success title={t("areaFound", { area: resolved.district ?? resolved.pincode })}>{resolved.town ? `${resolved.town} · ` : ""}{resolved.pincode}</Success>
                <label className="flex min-h-12 items-start gap-3 font-semibold"><input type="checkbox" className="mt-1 size-6 accent-brand-600" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> <span>{t("termsAccept")}</span></label>
                <Button size="lg" className="w-full" loading={busy} onClick={() => void finish()}>{t("startShopping")}</Button>
              </>
            )}
            {resolved && !resolved.coverage.available && (
              <div className="space-y-3 rounded-card border border-warn-line bg-warn-50 p-4 text-center">
                <MapPin className="mx-auto size-8 text-warn" aria-hidden />
                <h2 className="t-section">{t("notAvailableYet")}</h2>
                <p className="t-support">{t("notAvailableHelp")}</p>
                {interestSaved ? <Success title={t("interestSaved", { pincode })} /> : <Button size="lg" className="w-full" loading={busy} onClick={() => void interest()}>{t("tellMeWhenReady")}</Button>}
              </div>
            )}
          </div>
        )}

      </Card>
    </div>
  );
}
