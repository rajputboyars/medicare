import { audit } from "@/server/store";
import { handle, requireUser } from "@/server/http";
import { applicationDetail } from "@/server/features/onboarding/applications.service";

/** Everything for the review screen, including internal notes. Opening it is audit-logged (it contains personal details). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser("admin:read");
  const { id } = await ctx.params;
  const detail = applicationDetail(id);
  audit(u, "APPLICATION_VIEWED", "PartnerApplication", id);
  return detail;
});
