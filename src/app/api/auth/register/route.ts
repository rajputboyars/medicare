import { NextResponse } from "next/server";
import { SESSION_COOKIE, cookieOptions, signSession } from "@/lib/auth";
import { registerSchema } from "@/lib/validation";
import { handle, limit, parseBody } from "@/server/http";
import { publicUser, registerUser, toSession } from "@/server/services/accounts";

export const POST = handle(async (req: Request) => {
  await limit("register", 5, 60 * 60_000);
  const body = await parseBody(req, registerSchema);
  const user = registerUser(body);
  const res = NextResponse.json({ data: { user: publicUser(user), redirect: "/" } }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, await signSession(toSession(user)), cookieOptions());
  return res;
});
