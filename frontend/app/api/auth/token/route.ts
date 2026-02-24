import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Expose the ap_session token to client JS if needed (e.g. for WebSocket auth).
// Returns 401 if not authenticated.
export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get("ap_session");
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ token: session.value });
}
