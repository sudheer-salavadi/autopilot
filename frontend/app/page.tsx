import Link from "next/link";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const BENEFITS = [
  {
    title: "See what's hurting users",
    body: "Events from Stripe, Sentry, FullStory, and Zendesk are grouped automatically — no manual triage.",
  },
  {
    title: "Know what matters most",
    body: "Every issue is scored by revenue impact, how many users are affected, and UX friction — so the right thing is always at the top.",
  },
  {
    title: "Act without the noise",
    body: "Autopilot explains the root cause, suggests who should own it, and files the GitHub issue for you.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-20 gap-16">

      {/* Hero */}
      <div className="text-center space-y-5 max-w-lg">
        <h1 className="text-5xl font-bold tracking-tight">Autopilot</h1>
        <p className="text-muted-foreground text-xl leading-relaxed">
          Surface your most important user problems — automatically.
          No dashboards to build, no alerts to tune.
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <Button asChild size="lg">
            <a href={`${API_URL}/api/auth/login`}>Get started</a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>

      {/* Benefits */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl w-full">
        {BENEFITS.map((b) => (
          <div key={b.title} className="rounded-lg border bg-card p-5 space-y-2">
            <p className="font-semibold">{b.title}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{b.body}</p>
          </div>
        ))}
      </div>

    </main>
  );
}
