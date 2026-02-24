// WorkOS redirects the browser to FastAPI's /api/auth/callback, not here.
// This route exists only if you want to handle the WorkOS redirect on the
// Next.js side instead (alternative pattern). Currently unused.
export async function GET() {
  return new Response("Auth is handled by FastAPI /api/auth/callback", {
    status: 200,
  });
}
