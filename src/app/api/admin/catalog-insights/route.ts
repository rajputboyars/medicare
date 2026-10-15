import { handle, requireUser } from "@/server/http";
import { catalogInsights } from "@/server/features/catalog/insights.service";

export const GET = handle(async (req: Request) => {
  await requireUser("admin:read");
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  return catalogInsights(Number.isFinite(days) ? Math.min(180, Math.max(1, Math.round(days))) : 30);
});
