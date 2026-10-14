import { z } from "zod";
import { WithMessage } from "@/server/core/response";
import { handle, parseBody, requireElevated } from "@/server/http";
import {
  addInternalNote, applicationDetail, approveApplication, reinstateApplication, rejectApplication, requestInfo, startReview, suspendApplication,
} from "@/server/features/onboarding/applications.service";

const note = z.string().trim().max(500).optional();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START_REVIEW") }),
  z.object({ action: z.literal("APPROVE"), note }),
  z.object({ action: z.literal("REJECT"), note }),
  z.object({ action: z.literal("REQUEST_INFO"), note }),
  z.object({ action: z.literal("SUSPEND"), note }),
  z.object({ action: z.literal("REINSTATE"), note }),
  z.object({ action: z.literal("NOTE"), note }),
]);

/**
 * Decisions on an application. SENSITIVE: the admin must have re-entered their password in the last few minutes
 * (403 ELEVATION_REQUIRED otherwise). Every decision is written to the application history and the audit log.
 */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireElevated();
  const { id } = await ctx.params;
  const b = await parseBody(req, schema);
  switch (b.action) {
    case "START_REVIEW": startReview(u, id); break;
    case "APPROVE": approveApplication(u, id, b.note); break;
    case "REJECT": rejectApplication(u, id, b.note); break;
    case "REQUEST_INFO": requestInfo(u, id, b.note); break;
    case "SUSPEND": suspendApplication(u, id, b.note); break;
    case "REINSTATE": reinstateApplication(u, id, b.note); break;
    case "NOTE": addInternalNote(u, id, b.note); break;
  }
  return new WithMessage(applicationDetail(id), "Done");
});
