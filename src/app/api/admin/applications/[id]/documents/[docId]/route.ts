import { z } from "zod";
import { signFileUrl } from "@/lib/signed-url";
import { audit } from "@/server/store";
import { handle, parseBody, requireElevated, requireUser } from "@/server/http";
import { documentFor, documentView, reviewDocument } from "@/server/features/onboarding/applications.service";

type Ctx = { params: Promise<{ id: string; docId: string }> };

/** A short-lived signed link so an admin can look at a document. Logged. */
export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser("admin:read");
  const { docId } = await ctx.params;
  const doc = documentFor(u, docId);
  audit(u, "PARTNER_DOCUMENT_VIEWED", "PartnerDocument", doc.id);
  return { ...documentView(doc), url: signFileUrl(doc.fileKey, u.id) };
});

const schema = z.object({ status: z.enum(["APPROVED", "REJECTED", "REUPLOAD_REQUESTED"]), note: z.string().trim().max(300).optional() }).strict();

/** Approve a document, reject it, or ask for a better one. Rejecting or asking for a better copy needs a note the applicant can read. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireElevated();
  const { id, docId } = await ctx.params;
  const b = await parseBody(req, schema);
  return documentView(reviewDocument(u, id, docId, b.status, b.note));
});
