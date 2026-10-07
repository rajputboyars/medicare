"use client";

export class ApiClientError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string>) {
    super(message);
  }
}

/** Thin fetch wrapper: JSON in/out, friendly errors, `{data}` envelope unwrapped. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiClientError("No internet connection. Please check your network and try again.", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(body.error ?? "Something went wrong", res.status, body.fields);
  return body.data as T;
}

export const post = <T,>(path: string, json: unknown) => api<T>(path, { method: "POST", json });
export const patch = <T,>(path: string, json: unknown) => api<T>(path, { method: "PATCH", json });
export const put = <T,>(path: string, json: unknown) => api<T>(path, { method: "PUT", json });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
export const upload = <T,>(path: string, form: FormData) => api<T>(path, { method: "POST", body: form });
