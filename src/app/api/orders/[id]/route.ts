import { z } from "zod";
import { badRequest, handle, parseBody, requireUser } from "@/server/http";
import { attachPrescription, cancelOrder, confirmPayment, getOrderFor, userSafeOrder } from "@/server/services/orders";
import { repeatOrder, saveFromOrder } from "@/server/services/requests";
import { db, uid } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const u = await requireUser();
  return userSafeOrder(getOrderFor(u, (await ctx.params).id), u);
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(2).max(160) }),
  z.object({ action: z.literal("pay"), providerRef: z.string().trim().min(3).max(60) }),
  z.object({ action: z.literal("repeat"), paymentMethod: z.enum(["UPI", "COD", "CARD", "WALLET"]).optional() }),
  z.object({ action: z.literal("attach_prescription"), prescriptionId: z.string().min(1) }),
  z.object({ action: z.literal("save_medicines"), everyDays: z.number().int().min(7).max(90).default(30) }),
  z.object({ action: z.literal("review"), rating: z.number().int().min(1).max(5), comment: z.string().trim().max(400).optional() }),
]);

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const u = await requireUser("order:create");
  const { id } = await ctx.params;
  const b = await parseBody(req, actionSchema);
  switch (b.action) {
    case "cancel": return userSafeOrder(cancelOrder(u, id, b.reason), u);
    case "pay": return userSafeOrder(confirmPayment(u, id, b.providerRef), u);
    case "repeat": return userSafeOrder(repeatOrder(u, id, b.paymentMethod), u);
    case "attach_prescription": return userSafeOrder(attachPrescription(u, id, b.prescriptionId), u);
    case "save_medicines": return saveFromOrder(u, id, b.everyDays);
    case "review": {
      const o = getOrderFor(u, id);
      if (o.userId !== u.id || o.status !== "DELIVERED") throw badRequest("You can review after the order is delivered");
      const d = db();
      if (d.reviews.some((r) => r.orderId === o.id && r.userId === u.id)) throw badRequest("You already reviewed this order");
      d.reviews.push({ id: uid("rv"), userId: u.id, pharmacyId: o.pharmacyId, orderId: o.id, rating: b.rating, comment: b.comment, createdAt: new Date().toISOString() });
      return { ok: true };
    }
  }
});
