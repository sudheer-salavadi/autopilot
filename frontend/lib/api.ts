// Browser-side fetch — safe to import in Client Components and hooks.
// Uses credentials: 'include' so the browser automatically sends the
// ap_session cookie with every request.

const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function apiClient() {
  return {
    async get<T>(path: string): Promise<T> {
      const res = await fetch(`${PUBLIC_API}${path}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      return res.json();
    },

    async post<T>(path: string, body?: unknown): Promise<T> {
      const res = await fetch(`${PUBLIC_API}${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? `API ${res.status}`);
      }
      return res.json();
    },

    async put<T>(path: string, body?: unknown): Promise<T> {
      const res = await fetch(`${PUBLIC_API}${path}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      return res.json();
    },

    async patch<T>(path: string, body?: unknown): Promise<T> {
      const res = await fetch(`${PUBLIC_API}${path}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? `API ${res.status}`);
      }
      return res.json();
    },

    async del(path: string): Promise<void> {
      const res = await fetch(`${PUBLIC_API}${path}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
    },
  };
}
