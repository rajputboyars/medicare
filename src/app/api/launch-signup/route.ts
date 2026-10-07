import { launchSignupSchema } from "@/lib/validation";
import { handle, limit, parseBody } from "@/server/http";
import { launchSignup } from "@/server/services/admin";

export const POST = handle(async (req: Request) => {
  await limit("launch", 5, 60 * 60_000);
  const b = await parseBody(req, launchSignupSchema);
  return launchSignup(b.mobile, b.pincode);
});
