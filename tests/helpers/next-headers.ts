/** Stand-in for `next/headers` in tests: a cookie jar and request headers we control. Import via vi.mock in each test file. */
export const jar: { token?: string; headers: Record<string, string> } = { headers: {} };

export const cookies = async () => ({ get: (name: string) => (jar.token ? { name, value: jar.token } : undefined) });
export const headers = async () => new Headers(jar.headers);
