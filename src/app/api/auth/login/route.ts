import { success, WithMessage } from "@/server/core/response";
import { SESSION_COOKIE, cookieOptions, signSession } from "@/lib/auth";
import { homeFor } from "@/lib/rbac";
import { loginSchema } from "@/lib/validation";
import { handle, limit, parseBody } from "@/server/http";
import { authenticate, publicUser, toSession } from "@/server/features/accounts/accounts.service";

export const POST = handle(async (req: Request) => {
  const body = await parseBody(req, loginSchema);
  await limit("login", 8, 10 * 60_000, body.identifier.toLowerCase());
  const user = authenticate(body.identifier, body.password);
  const token = await signSession(toSession(user));
  const res = success(new WithMessage({ user: publicUser(user), redirect: homeFor(user.role) }, "Logged in"));
  res.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return res;
});
