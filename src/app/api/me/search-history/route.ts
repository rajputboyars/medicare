import { handle, requireUser } from "@/server/http";
import { clearSearchHistory, recentSearches } from "@/server/features/catalog/catalog.service";

/** My recent searches. Private: only I can read or clear them. (Guests keep theirs in their own browser.) */
export const GET = handle(async () => recentSearches(await requireUser()));

/** Clear all (or ?id= one entry). */
export const DELETE = handle(async (req: Request) => {
  const u = await requireUser();
  return { removed: clearSearchHistory(u, new URL(req.url).searchParams.get("id") ?? undefined) };
});
