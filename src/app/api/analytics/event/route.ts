import { z } from "zod";
import { CLIENT_EVENTS, track } from "@/server/analytics";
import { currentUser, handle, limit, parseBody } from "@/server/http";

const schema = z.object({
  name: z.string().refine((n) => (CLIENT_EVENTS as readonly string[]).includes(n), "Unknown event"),
  anonId: z.string().regex(/^[a-z0-9-]{8,40}$/).optional(),
  props: z.record(z.string().regex(/^[a-z_]{1,30}$/), z.union([z.string().max(40), z.number(), z.boolean()])).optional(),
}).strict();

/** The browser may report only a few harmless events (the rest are recorded by the server and cannot be forged from here). */
export const POST = handle(async (req: Request) => {
  await limit("analytics", 60, 10 * 60_000);
  const b = await parseBody(req, schema);
  const u = await currentUser();
  track(b.name as Parameters<typeof track>[0], { userId: u?.id, anonId: u ? undefined : b.anonId }, b.props);
  return { ok: true };
});
