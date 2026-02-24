import Link from "next/link";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 px-4">
      <div className="text-center space-y-3 max-w-md">
        <h1 className="text-4xl font-bold tracking-tight">Autopilot</h1>
        <p className="text-muted-foreground text-lg">
          Multi-tenant webhook ingestion. Connect Stripe and Sentry, inspect
          every event per project.
        </p>
      </div>

      <div className="flex gap-3">
        <Button asChild size="lg">
          <a href={`${API_URL}/api/auth/login`}>Sign in</a>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
