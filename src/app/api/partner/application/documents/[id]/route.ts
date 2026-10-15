import { signFileUrl } from "@/lib/signed-url";
import { handle, requireUser } from "@/server/http";
import { applicantView, applicationOf, documentFor, documentView, removeDocument } from "@/server/features/onboarding/applications.service";
import { audit } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

/** A short-lived signed link to the file. Only the uploader and platform admins can ask; admin views are audit-logged. */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  const doc = documentFor(u, (await ctx.params).id);
  if (doc.uploadedBy !== u.id) audit(u, "PARTNER_DOCUMENT_VIEWED", "PartnerDocument", doc.id);
  return { ...documentView(doc), url: signFileUrl(doc.fileKey, u.id) };
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  removeDocument(u, (await ctx.params).id);
  return applicantView(applicationOf(u));
});
