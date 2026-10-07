export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

export const badRequest = (m: string, fields?: Record<string, string>) => new ApiError(400, m, fields);
export const forbidden = (m = "You do not have access to this") => new ApiError(403, m);
export const notFound = (m = "Not found") => new ApiError(404, m);
export const conflict = (m: string) => new ApiError(409, m);
