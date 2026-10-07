import { NextResponse } from "next/server";
import { verifyFileSignature } from "@/lib/signed-url";
import { currentUser } from "@/server/http";
import { canAccessPrescription } from "@/server/services/prescriptions";
import { db } from "@/server/store";

/**
 * Private file delivery. Requires BOTH a valid unexpired signature AND the same logged-in user the URL
 * was issued to, AND current access rights. Responses are never cached.
 */
export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const user = await currentUser();
  const uid = sp.get("uid") ?? "";
  if (!user || user.id !== uid || !verifyFileSignature(key, Number(sp.get("exp")), uid, sp.get("sig") ?? "")) {
    return NextResponse.json({ error: "This link is not valid or has expired" }, { status: 403 });
  }
  const d = db();
  const file = d.files.get(key);
  const rx = d.prescriptions.find((p) => p.fileKey === key);
  if (!file || !rx || !canAccessPrescription(user, rx)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    },
  });
}
