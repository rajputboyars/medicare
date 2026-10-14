import type { CallbackRequest, SessionUser } from "@/lib/types";
import { notFound } from "@/server/errors";
import { audit, db, uid } from "@/server/store";

/**
 * "Please call me." For people who find the app hard. No account, no medical details: a number, an area and a reason.
 * Support staff (platform admins in V1) see the queue and mark requests as contacted or closed.
 */
export function createCallback(input: { mobile: string; name?: string; area: string; reason: string }): CallbackRequest {
  const d = db();
  // The same number asking again while a request is still open updates it rather than flooding the queue
  const open = d.callbackRequests.find((c) => c.mobile === input.mobile && c.status === "OPEN");
  if (open) { open.area = input.area; open.reason = input.reason; if (input.name) open.name = input.name; return open; }
  const row: CallbackRequest = { id: uid("cb"), mobile: input.mobile, name: input.name || undefined, area: input.area, reason: input.reason, status: "OPEN", createdAt: new Date().toISOString() };
  d.callbackRequests.unshift(row);
  return row;
}

export function listCallbacks() {
  return db().callbackRequests;
}

export function updateCallback(actor: SessionUser, id: string, patch: { status: CallbackRequest["status"]; note?: string }) {
  const c = db().callbackRequests.find((x) => x.id === id);
  if (!c) throw notFound("Request not found");
  c.status = patch.status;
  if (patch.note !== undefined) c.note = patch.note;
  c.handledBy = actor.id;
  audit(actor, "CALLBACK_UPDATED", "CallbackRequest", id, { status: patch.status });
  return c;
}
