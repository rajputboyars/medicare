import { WithMessage } from "@/server/core/response";
import { elevateSchema } from "@/lib/validation";
import { handle, limit, parseBody, requireUser } from "@/server/http";
import { elevateSession } from "@/server/features/auth/auth.service";

/** Admin re-enters their password to unlock sensitive actions for a few minutes. Wrong passwords count toward the lock-out. */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("admin:write");
  await limit("elevate", 10, 10 * 60_000, u.id);
  const { password } = await parseBody(req, elevateSchema);
  return new WithMessage({ elevatedUntil: elevateSession(u, password) }, "Confirmed");
});
