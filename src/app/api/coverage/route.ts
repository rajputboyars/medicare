import { pincodeSchema } from "@/lib/validation";
import { handle, validate } from "@/server/http";
import { coverageFor } from "@/server/features/service-areas/service-areas.service";

export const GET = handle(async (req: Request) => coverageFor(validate(pincodeSchema, new URL(req.url).searchParams.get("pincode"))));
