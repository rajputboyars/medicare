import { success, WithMessage } from "@/server/core/response";
import { SESSION_COOKIE, cookieOptions, signSession } from "@/lib/auth";
import { registerSchema } from "@/lib/validation";
import { handle, limit, parseBody } from "@/server/http";
import { publicUser, registerUser, toSession } from "@/server/features/accounts/accounts.service";

export const POST = handle(async (req: Request) => {
  await limit("register", 5, 60 * 60_000);
  const body = await parseBody(req, registerSchema);
  const user = registerUser(body);
  const res = success(new WithMessage({ user: publicUser(user), redirect: "/" }, "Account created", 201));
  res.cookies.set(SESSION_COOKIE, await signSession(toSession(user)), cookieOptions());
  return res;
});
