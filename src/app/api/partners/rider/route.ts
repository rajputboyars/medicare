import { riderRegistrationSchema } from "@/lib/validation";
import { handle, limit, parseBody } from "@/server/http";
import { registerRider } from "@/server/services/admin";

export const POST = handle(async (req: Request) => {
  await limit("partner-register", 3, 60 * 60_000);
  return registerRider(await parseBody(req, riderRegistrationSchema));
});
