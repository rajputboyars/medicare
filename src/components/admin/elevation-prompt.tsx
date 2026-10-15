"use client";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { post, setElevationHandler } from "@/lib/api";
import { Button, Input, Modal, Notice } from "@/components/ui";

/**
 * "Please confirm your password": shown when an admin starts a sensitive action (approving partners, changing money
 * settings, creating settlements, suspending people). Confirming unlocks sensitive actions for a few minutes and the
 * action that was blocked is retried automatically. Cancelling leaves things exactly as they were.
 */
export function ElevationPrompt() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const waiting = useRef<((ok: boolean) => void) | undefined>(undefined);

  useEffect(() => {
    setElevationHandler(() => new Promise<boolean>((resolve) => { waiting.current?.(false); waiting.current = resolve; setPassword(""); setError(undefined); setOpen(true); }));
    return () => setElevationHandler(undefined);
  }, []);

  const finish = (ok: boolean) => { setOpen(false); waiting.current?.(ok); waiting.current = undefined; };

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(undefined);
    try { await post("/api/auth/elevate", { password }); finish(true); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={() => finish(false)} title="Confirm your password" description="This action is sensitive. Please confirm it is you.">
      <form onSubmit={confirm} className="space-y-3">
        <p className="flex items-center gap-2 t-support"><ShieldCheck className="size-5 text-brand-600" aria-hidden /> You will not be asked again for a few minutes.</p>
        {error && <Notice tone="red">{error}</Notice>}
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        <div className="flex gap-2"><Button type="submit" loading={busy} disabled={!password}>Confirm</Button><Button type="button" variant="secondary" onClick={() => finish(false)}>Cancel</Button></div>
      </form>
    </Modal>
  );
}
