import { z } from "zod";
import { badRequest } from "../errors";
import { Paged } from "./response";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface ListOptions<T> {
  /** Fields a caller may sort by, and how to read each one. */
  sortable: Record<string, (row: T) => string | number | undefined>;
  /** Equality filters a caller may use, e.g. { status: (r) => r.status } gives ?status=PENDING (comma-separated for several). */
  filters?: Record<string, (row: T) => string | undefined>;
  /** Free-text search (?q=...) matches against this text. */
  search?: (row: T) => string;
  defaultSort: string; // "createdAt:desc"
  /** Page size when the caller does not say (default ${DEFAULT_LIMIT}). */
  defaultLimit?: number;
}

const baseQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  sort: z.string().max(40).optional(),
  q: z.string().trim().max(80).optional(),
});

/** Reads ?page, ?limit, ?sort=field:asc|desc, ?q and the allowed filters from a request URL; then filters, sorts and slices. */
export function paginate<T>(rows: readonly T[], url: string | URL, opts: ListOptions<T>): Paged<T> {
  const sp = new URL(url, "http://local").searchParams;
  const parsed = baseQuery.safeParse(Object.fromEntries(sp.entries()));
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid page or limit", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])));
  const { page, q } = parsed.data;
  const limit = parsed.data.limit ?? opts.defaultLimit ?? DEFAULT_LIMIT;

  const [field, dirRaw = "asc"] = (parsed.data.sort ?? opts.defaultSort).split(":");
  const read = opts.sortable[field];
  if (!read || (dirRaw !== "asc" && dirRaw !== "desc")) throw badRequest(`You can sort by: ${Object.keys(opts.sortable).join(", ")}`);

  let out = [...rows];
  for (const [name, get] of Object.entries(opts.filters ?? {})) {
    const wanted = sp.get(name);
    if (!wanted) continue;
    const set = new Set(wanted.split(",").map((s) => s.trim()).filter(Boolean));
    out = out.filter((r) => set.has(get(r) ?? ""));
  }
  if (q && opts.search) {
    const needle = q.toLowerCase();
    out = out.filter((r) => opts.search!(r).toLowerCase().includes(needle));
  }
  const dir = dirRaw === "desc" ? -1 : 1;
  out.sort((a, b) => {
    const x = read(a), y = read(b);
    if (x === y) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (x < y ? -1 : 1) * dir;
  });

  const total = out.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  return new Paged(out.slice(start, start + limit), { page, limit, total, totalPages, hasNext: page < totalPages, sort: `${field}:${dirRaw}` });
}
