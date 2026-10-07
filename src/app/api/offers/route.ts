import { handle } from "@/server/http";
import { db } from "@/server/store";

export const GET = handle(async () => db().offers.filter((o) => o.active));
