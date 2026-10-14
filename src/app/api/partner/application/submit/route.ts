import { z } from "zod";
import { WithMessage } from "@/server/core/response";
import { handle, parseBody, requireRole } from "@/server/http";
import { applicantView, submitApplication } from "@/server/features/onboarding/applications.service";

/** Sends the application for review. Every step and every required document must be complete. */
export const POST = handle(async (req: Request) => {
  const u = await requireRole("PHARMACY_ADMIN", "DELIVERY_PARTNER");
  const { consent } = await parseBody(req, z.object({ consent: z.boolean() }).strict());
  return new WithMessage(applicantView(submitApplication(u, consent)), "Application sent for review");
});
