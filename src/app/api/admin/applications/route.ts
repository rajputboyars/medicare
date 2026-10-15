import { handle, paginate, requireUser } from "@/server/http";
import { listApplications } from "@/server/features/onboarding/applications.service";

/** Pharmacy and rider applications. ?type=PHARMACY|RIDER · ?status=SUBMITTED,UNDER_REVIEW · ?q= · ?sort=submittedAt:desc */
export const GET = handle(async (req: Request) => {
  await requireUser("admin:read");
  return paginate(listApplications(), req.url, {
    sortable: { updatedAt: (a) => a.updatedAt, submittedAt: (a) => a.submittedAt, name: (a) => a.name.toLowerCase(), percent: (a) => a.percent },
    filters: { type: (a) => a.type, status: (a) => a.status },
    search: (a) => `${a.name} ${a.mobile ?? ""} ${a.district ?? ""}`,
    defaultSort: "updatedAt:desc",
  });
});
