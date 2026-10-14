import { NextResponse } from "next/server";
import { verifyFileSignature } from "@/lib/signed-url";
import { failure } from "@/server/core/response";
import { forbidden, notFound } from "@/server/errors";
import { currentUser } from "@/server/http";
import { canAccessPrescription } from "@/server/features/prescriptions/prescriptions.service";
import { canAccessDocument } from "@/server/features/onboarding/applications.service";
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
    return failure(forbidden("This link is not valid or has expired"));
  }
  const d = db();
  const file = d.files.get(key);
  const rx = d.prescriptions.find((p) => p.fileKey === key);
  const doc = rx ? undefined : d.partnerDocuments.find((p) => p.fileKey === key);
  // Prescriptions: owner / pharmacy handling it / admin. Partner documents: the applicant who uploaded it / admin. Nobody else.
  const allowed = rx ? canAccessPrescription(user, rx) : doc ? canAccessDocument(user, doc) : false;
  if (!file || !allowed) return failure(notFound("Not found"));
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
