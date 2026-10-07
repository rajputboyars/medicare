import { signFileUrl } from "@/lib/signed-url";
import { handle, requireUser } from "@/server/http";
import { prescriptionFor } from "@/server/services/prescriptions";
import { audit } from "@/server/store";

/** Returns metadata and a short-lived signed URL. The URL contains no medical information. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const u = await requireUser();
  const { id } = await ctx.params;
  const rx = prescriptionFor(u, id);
  if (rx.userId !== u.id) audit(u, "PRESCRIPTION_VIEWED", "Prescription", rx.id);
  const { fileKey, ...meta } = rx;
  return { ...meta, url: signFileUrl(fileKey, u.id) };
});
