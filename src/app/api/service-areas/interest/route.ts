import { launchSignupSchema } from "@/lib/validation";
import { WithMessage } from "@/server/core/response";
import { handle, limit, parseBody } from "@/server/http";
import { registerInterest } from "@/server/features/service-areas/service-areas.service";

/** "Tell me when you arrive." One row per mobile + pincode; sending it twice is harmless. */
export const POST = handle(async (req: Request) => {
  await limit("interest", 8, 60 * 60_000);
  return new WithMessage(registerInterest(await parseBody(req, launchSignupSchema)), "We will tell you when we arrive", 201);
});
