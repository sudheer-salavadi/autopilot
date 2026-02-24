// Server-side fetch — Server Components and Route Handlers ONLY.
// Uses next/headers to forward the ap_session cookie to FastAPI via the
// internal Docker network URL (never goes through the public internet).

import { cookies } from "next/headers";

const INTERNAL_API = process.env.INTERNAL_API_URL ?? "http://localhost:8000";

export async function apiServer<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const cookieStore = await cookies();
  const session = cookieStore.get("ap_session")?.value;

  const res = await fetch(`${INTERNAL_API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Cookie: `ap_session=${session}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}
