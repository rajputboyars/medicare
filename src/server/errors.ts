export class ApiError extends Error {
  /** `code` is a stable machine-readable reason (e.g. ELEVATION_REQUIRED); when omitted it is derived from the status */
  constructor(public status: number, message: string, public fields?: Record<string, string>, public code?: string) {
    super(message);
  }
}

export const badRequest = (m: string, fields?: Record<string, string>) => new ApiError(400, m, fields);
export const forbidden = (m = "You do not have access to this") => new ApiError(403, m);
export const notFound = (m = "Not found") => new ApiError(404, m);
export const conflict = (m: string) => new ApiError(409, m);
export const unauthenticated = (m = "Please log in to continue") => new ApiError(401, m);
