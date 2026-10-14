import { callbackSchema } from "@/lib/validation";
import { WithMessage } from "@/server/core/response";
import { handle, limit, parseBody } from "@/server/http";
import { createCallback } from "@/server/features/support/support.service";

/** Public: someone who finds the app hard asks us to phone them. A number, an area and a reason; nothing medical. */
export const POST = handle(async (req: Request) => {
  await limit("callback", 5, 60 * 60_000);
  const b = await parseBody(req, callbackSchema);
  const row = createCallback({ mobile: b.mobile, name: b.name || undefined, area: b.area, reason: b.reason });
  return new WithMessage({ id: row.id }, "We will call you soon", 201);
});
