import { pincodeSchema } from "@/lib/validation";
import { handle, validate } from "@/server/http";
import { nearbyPharmacies } from "@/server/features/medicines/finder.service";

export const GET = handle(async (req: Request) => nearbyPharmacies(validate(pincodeSchema, new URL(req.url).searchParams.get("pincode"))));
