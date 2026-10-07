import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { riderSummary, setAvailability } from "@/server/services/delivery";

export const GET = handle(async () => riderSummary(await requireUser("delivery:execute")));

export const PATCH = handle(async (req: Request) => {
  const u = await requireUser("delivery:execute");
  const { available } = await parseBody(req, z.object({ available: z.boolean() }));
  setAvailability(u, available);
  return riderSummary(u);
});
