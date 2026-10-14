import { NextResponse } from "next/server";
import { ApiError } from "../errors";

/**
 * One response shape for every API route:
 *   { success, data, message, errors, meta }
 *  - success  true / false
 *  - data     the payload (null on failure)
 *  - message  a short sentence a person can read
 *  - errors   null, or a list of { code, message, field? }: one per invalid field for validation problems
 *  - meta     pagination info for list endpoints ({ page, limit, total, totalPages, hasNext }), otherwise null
 */
export interface ApiErrorItem { code: string; message: string; field?: string }
export interface PageMeta { page: number; limit: number; total: number; totalPages: number; hasNext: boolean; sort?: string }
export interface Envelope<T> { success: boolean; data: T | null; message: string | null; errors: ApiErrorItem[] | null; meta: PageMeta | null }

/** Return this from a handler to send a list together with its pagination meta. */
export class Paged<T> {
  constructor(public items: T[], public meta: PageMeta) {}
}

/** Return this from a handler to attach a friendly message (e.g. "Order placed") and a status code to the payload. */
export class WithMessage<T> {
  constructor(public data: T, public message: string, public status = 200) {}
}

const CODES: Record<number, string> = { 400: "BAD_REQUEST", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE", 422: "VALIDATION_FAILED", 429: "RATE_LIMITED" };
export const codeFor = (status: number) => CODES[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "ERROR");

export function success(out: unknown): NextResponse<Envelope<unknown>> {
  if (out instanceof Paged) return NextResponse.json({ success: true, data: out.items, message: null, errors: null, meta: out.meta });
  if (out instanceof WithMessage) return NextResponse.json({ success: true, data: out.data, message: out.message, errors: null, meta: null }, { status: out.status });
  return NextResponse.json({ success: true, data: out ?? null, message: null, errors: null, meta: null });
}

export function failure(e: unknown): NextResponse<Envelope<null>> {
  if (e instanceof ApiError) {
    const code = codeFor(e.status);
    const errors: ApiErrorItem[] = e.fields && Object.keys(e.fields).length
      ? Object.entries(e.fields).map(([field, message]) => ({ code: "INVALID_FIELD", field, message }))
      : [{ code, message: e.message }];
    return NextResponse.json({ success: false, data: null, message: e.message, errors, meta: null }, { status: e.status });
  }
  // Unexpected: log it for us, tell the caller nothing technical.
  console.error("[api] unexpected error", e);
  const message = "Something went wrong. Please try again.";
  return NextResponse.json({ success: false, data: null, message, errors: [{ code: "INTERNAL_ERROR", message }], meta: null }, { status: 500 });
}
