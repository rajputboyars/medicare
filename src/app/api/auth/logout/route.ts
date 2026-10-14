import { success, WithMessage } from "@/server/core/response";
import { SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  const res = success(new WithMessage({ ok: true }, "Logged out"));
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
