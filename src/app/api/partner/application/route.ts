import { z } from "zod";
import { WithMessage } from "@/server/core/response";
import { handle, parseBody, requireRole } from "@/server/http";
import { applicantView, applicationOf, saveStep } from "@/server/features/onboarding/applications.service";

/** My application: answers so far, progress, documents, and what to do next. Applicants (pharmacy owner, rider) only. */
export const GET = handle(async () => {
  const u = await requireRole("PHARMACY_ADMIN", "DELIVERY_PARTNER");
  return applicantView(applicationOf(u));
});

const schema = z.object({ step: z.string().min(1).max(30), data: z.record(z.string(), z.unknown()) }).strict();

/** Autosave one step. Partial answers are fine; the full check happens on submit. */
export const PATCH = handle(async (req: Request) => {
  const u = await requireRole("PHARMACY_ADMIN", "DELIVERY_PARTNER");
  const { step, data } = await parseBody(req, schema);
  return new WithMessage(applicantView(saveStep(u, step, data)), "Saved");
});
