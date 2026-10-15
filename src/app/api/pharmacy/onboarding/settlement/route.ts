import { z } from "zod";
import { handle, parseBody, requireUser } from "@/server/http";
import { saveSettlement } from "@/server/features/pharmacy/setup.service";

const schema = z.object({
  holderName: z.string().trim().min(2).max(80),
  accountNumber: z.string().trim().regex(/^\d{9,18}$/, "Enter the account number (9 to 18 digits)").optional().or(z.literal("")),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC code").optional().or(z.literal("")),
  upiId: z.string().trim().regex(/^[\w.-]{2,}@[\w]{2,}$/, "Enter a valid UPI id, like name@bank").optional().or(z.literal("")),
}).strict();

/** Only the owner can set where settlements are paid. The account number is never returned by any endpoint (only the last 4 digits). */
export const POST = handle(async (req: Request) => {
  const u = await requireUser("pharmacy:finance");
  const b = await parseBody(req, schema);
  return saveSettlement(u, { holderName: b.holderName, accountNumber: b.accountNumber || undefined, ifsc: b.ifsc || undefined, upiId: b.upiId || undefined });
});
