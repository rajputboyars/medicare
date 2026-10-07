import { pharmacyRegistrationSchema } from "@/lib/validation";
import { handle, limit, parseBody } from "@/server/http";
import { registerPharmacy } from "@/server/services/admin";

export const POST = handle(async (req: Request) => {
  await limit("partner-register", 3, 60 * 60_000);
  const { consent: _c, ...input } = await parseBody(req, pharmacyRegistrationSchema);
  void _c;
  return registerPharmacy(input);
});
